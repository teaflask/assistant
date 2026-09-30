import type {
  MintVisitorTokenRequest,
  MintVisitorTokenResponse,
} from "../contract/identity.js";
import { getMintVisitorTokenUrl } from "../generated/serving.js";
import { parseServingError, ServingApiError } from "./serving-error.js";

// Re-mint at 80% of the token's lifetime: early enough that a healthy tab
// never sends with an expired token, late enough to keep mints rare.
const PROACTIVE_REMINT_FRACTION = 0.8;

export interface TokenSessionConfig {
  publishableKey: string;
  baseUrl: string;
  // Identity enters as an async callback, never a static token: the
  // visitor token is short-lived, so every re-mint must be able to fetch
  // a fresh end-user token from the host.
  getEndUserToken?: () => string | null | Promise<string | null>;
  // The stored anonymous thread to offer for adoption, read fresh on
  // every mint (claim-at-mint; a losing claim is silent by contract).
  claimThreadId?: () => string | null;
  onMinted?: (response: MintVisitorTokenResponse) => void;
  // Mint failures are loud by contract — a broken key, origin, or signer
  // must surface during development, never degrade silently.
  onMintFailed?: (error: ServingApiError) => void;
}

/**
 * The visitor-token lifecycle in one place: mint on first need, re-mint
 * proactively before expiry, retry any 401 exactly once after a forced
 * re-mint, and retry the sign-in-required 403 exactly once when the
 * forced re-mint comes back identified (the visitor signed in after the
 * cached token was minted; without this the widget would keep serving
 * the stale anonymous token until the proactive re-mint). Every other
 * transport call goes through `authorizedFetch`, so streams and REST
 * calls share the same lifecycle.
 */
export class TokenSession {
  readonly baseUrl: string;
  private readonly config: TokenSessionConfig;
  private visitorToken: string | null = null;
  private mintInFlight: Promise<MintVisitorTokenResponse> | null = null;
  private remintTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: TokenSessionConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl;
  }

  // Bound so it can be handed to HttpAgent's `fetch` option directly.
  readonly authorizedFetch = async (
    url: string,
    requestInit: RequestInit = {},
  ): Promise<Response> => {
    const token = await this._currentToken();
    const response = await fetch(url, _withBearer(requestInit, token));
    if (response.status === 401) {
      const minted = await this._remintAfterRejection();
      return fetch(url, _withBearer(requestInit, minted.visitor_token));
    }
    if (response.status === 403 && (await _saysSignInRequired(response))) {
      // A re-mint can only help if the host can vouch NOW: ask the
      // identity callback first. Unwired hosts, signed-out visitors, and
      // a callback that fails (their token endpoint down) alike surface
      // the sentence — the actionable copy — without burning a mint
      // against the shared mint windows or dropping a still-valid
      // cached token.
      let vouch: string | null;
      try {
        vouch = (await this.config.getEndUserToken?.()) ?? null;
      } catch {
        vouch = null;
      }
      if (vouch === null) {
        return response;
      }
      // The visitor signed in after this token was minted: one forced
      // re-mint picks the vouch up now. A mint that fails (it already
      // notified onMintFailed) or comes back still anonymous means
      // there is nothing to retry with — surface the sentence, never a
      // mint error, never a loop.
      let minted: MintVisitorTokenResponse;
      try {
        minted = await this._remintAfterRejection(vouch);
      } catch {
        return response;
      }
      if (minted.tier !== "identified") {
        return response;
      }
      return fetch(url, _withBearer(requestInit, minted.visitor_token));
    }
    return response;
  };

  dispose(): void {
    this._clearRemintTimer();
  }

  private async _currentToken(): Promise<string> {
    if (this.visitorToken !== null) {
      return this.visitorToken;
    }
    const minted = await this._mintSingleFlight();
    return minted.visitor_token;
  }

  // The token was rejected, so it must not be served again; the single
  // retry rides the fresh mint (which re-invokes getEndUserToken, so a
  // rotated customer JWT — or a sign-in since the last mint — is picked
  // up; a vouch the caller already probed threads through instead of a
  // second host round-trip). Answers the whole mint so the caller can
  // read the tier.
  private async _remintAfterRejection(
    vouch?: string,
  ): Promise<MintVisitorTokenResponse> {
    this.visitorToken = null;
    return this._mintSingleFlight(vouch);
  }

  private _mintSingleFlight(vouch?: string): Promise<MintVisitorTokenResponse> {
    this.mintInFlight ??= this._mint(vouch).finally(() => {
      this.mintInFlight = null;
    });
    return this.mintInFlight;
  }

  // Raw fetch on purpose: the mint IS the session bootstrap, so it cannot
  // ride the generated client (whose mutator requires a minted session).
  private async _mint(vouch?: string): Promise<MintVisitorTokenResponse> {
    const response = await fetch(
      `${this.config.baseUrl}${getMintVisitorTokenUrl()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(await this._buildMintRequest(vouch)),
      },
    );
    if (!response.ok) {
      const error = await parseServingError(response);
      this.config.onMintFailed?.(error);
      throw error;
    }
    const minted = (await response.json()) as MintVisitorTokenResponse;
    this.visitorToken = minted.visitor_token;
    this._scheduleProactiveRemint(minted.expires_in);
    this.config.onMinted?.(minted);
    return minted;
  }

  private async _buildMintRequest(
    vouch?: string,
  ): Promise<MintVisitorTokenRequest> {
    const endUserToken =
      vouch ?? (await this.config.getEndUserToken?.()) ?? null;
    const request: MintVisitorTokenRequest = {
      publishable_key: this.config.publishableKey,
    };
    if (endUserToken !== null) {
      request.end_user_token = endUserToken;
      const claimThreadId = this.config.claimThreadId?.() ?? null;
      if (claimThreadId !== null) {
        request.claim_thread_id = claimThreadId;
      }
    }
    return request;
  }

  private _scheduleProactiveRemint(expiresInSeconds: number): void {
    if (typeof window === "undefined") {
      return;
    }
    this._clearRemintTimer();
    const delayMs = expiresInSeconds * PROACTIVE_REMINT_FRACTION * 1000;
    this.remintTimer = setTimeout(() => {
      // The old token keeps serving until the fresh one lands — it is
      // still valid for the remaining ~20% of its lifetime. A failed
      // proactive mint already notified onMintFailed; the next request
      // mints again.
      this._mintSingleFlight().catch(() => undefined);
    }, delayMs);
  }

  private _clearRemintTimer(): void {
    if (this.remintTimer !== null) {
      clearTimeout(this.remintTimer);
      this.remintTimer = null;
    }
  }
}

function _withBearer(requestInit: RequestInit, token: string): RequestInit {
  const headers = new Headers(requestInit.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...requestInit, headers };
}

// Reads a clone, so the caller can still hand the original response (and
// its unread body) up to the surface's error copy.
async function _saysSignInRequired(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as {
      error?: { code?: string };
    };
    return body.error?.code === "ASSISTANT_SIGN_IN_REQUIRED";
  } catch {
    return false;
  }
}
