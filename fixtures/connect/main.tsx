// The connect-flow bench: the identified widget against a LOCAL api,
// for driving the Sign in with ChatGPT connect flow end to end. Run `npm run
// fixture:connect` and open http://127.0.0.1:8791/fixtures/connect/
// with:
//   ?pk=<publishable key>   — a key whose allowlist carries this origin
//   &base=<api base url>    — defaults to http://127.0.0.1:8000, the only
//                              host a local sign-in redirect may name; the
//                              callback page posts from that origin, and the
//                              widget accepts messages from its base origin alone
// The end-user JWT — signed with the org's serving identity secret; the
// identified tier is the whole point, and without it the chip never
// shows — is pasted into the token field on the page, NEVER the URL: a
// query string lands in browser history, server logs and referrers, and
// a member's token must not. The page keeps it in sessionStorage under
// a key scoped to this (base, pk) pair (token-context.ts), so a reload
// keeps the identity, switching endpoint or key in the same tab never
// replays it, and closing the tab drops it. A leftover legacy URL that
// still carries the token as a query param is scrubbed from the address
// bar on load — the value is never read — and the page says to paste it
// instead.
// The org's published assistant must offer the provider
// (end_users.subscriptions) or the composer shelf shows no provider
// chip. Connecting opens a REAL sign-in popup at the provider.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AssistantCompanion } from "../../src/components/assistant-companion";
import {
  type TeaflaskAssistantAnonymousProps,
  type TeaflaskAssistantIdentityProps,
  TeaflaskAssistantProvider,
  useAssistantSession,
} from "../../src/components/teaflask-assistant-provider";
import { tokenStorageKeyOf, urlWithoutLegacyTokenParam } from "./token-context";

// The open-by-name hook's bench control: rings the parked ask the
// provider chip consumes by dropping its menu open.
function RingConnectButton() {
  const { requestSubscriptionConnect } = useAssistantSession();
  return (
    <button type="button" onClick={requestSubscriptionConnect}>
      Ring requestSubscriptionConnect()
    </button>
  );
}

// Setting or clearing the token reloads the page: the provider decides
// identified-vs-anonymous at mount, from whether getEndUserToken is
// wired at all, so the bench re-mounts rather than faking a re-decide.
function TokenForm({
  hasToken,
  tokenUnreadable,
  storageKey,
  legacyUrlScrubbed,
}: {
  hasToken: boolean;
  tokenUnreadable: boolean;
  storageKey: string;
  legacyUrlScrubbed: boolean;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("eut");
        const value =
          field instanceof HTMLInputElement ? field.value.trim() : "";
        if (value === "") {
          sessionStorage.removeItem(storageKey);
        } else {
          sessionStorage.setItem(storageKey, value);
        }
        location.reload();
      }}
    >
      {legacyUrlScrubbed ? (
        <p role="alert">
          This URL carried the end-user JWT as a query param — that no longer
          works, and the param was just removed from the address bar (it may
          survive in history and anything the URL was shared with). Paste the
          token into the field below instead.
        </p>
      ) : null}
      {tokenUnreadable ? (
        <p role="alert">
          The stored end-user JWT could not be read (not a JWT, or no user_id
          claim), so this tab runs anonymous. Replace or clear it below.
        </p>
      ) : null}
      <p>
        {hasToken
          ? "An end-user JWT is set for this tab, base and key."
          : "Anonymous: paste an end-user JWT to try the identified tier."}
      </p>
      <input
        name="eut"
        type="password"
        autoComplete="off"
        aria-label="End-user JWT"
        placeholder="Paste the end-user JWT"
      />
      <button type="submit">{hasToken ? "Replace token" : "Set token"}</button>
      {hasToken ? (
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(storageKey);
            location.reload();
          }}
        >
          Clear token
        </button>
      ) : null}
    </form>
  );
}

// Scrubbed before anything reads the URL; the token value itself is
// never touched.
const scrubbedHref = urlWithoutLegacyTokenParam(location.href);
if (scrubbedHref !== null) {
  history.replaceState(null, "", scrubbedHref);
}

const params = new URLSearchParams(location.search);
const publishableKey = params.get("pk") ?? "";
const baseUrl = params.get("base") ?? "http://127.0.0.1:8000";
const tokenStorageKey = tokenStorageKeyOf(baseUrl, publishableKey);
const endUserToken = sessionStorage.getItem(tokenStorageKey);

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("The connect bench page has no #root.");
}
// The bench trusts the pasted token's own `user_id` claim as the host's
// userId; a real host reads it from its session, never from the token.
// Null for a paste that cannot be read: the form must stay reachable to
// clear it, so the bench runs anonymous and says so rather than throwing.
function userIdOf(token: string): string | null {
  try {
    const [, payload = ""] = token.split(".");
    const claims: unknown = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );
    const userId =
      typeof claims === "object" && claims !== null && "user_id" in claims
        ? claims.user_id
        : undefined;
    return typeof userId === "string" ? userId : null;
  } catch {
    return null;
  }
}

const pastedUserId = endUserToken === null ? null : userIdOf(endUserToken);
const tokenUnreadable = endUserToken !== null && pastedUserId === null;
const identity:
  TeaflaskAssistantIdentityProps | TeaflaskAssistantAnonymousProps =
  pastedUserId === null
    ? {}
    : { userId: pastedUserId, getEndUserToken: () => endUserToken };

createRoot(rootElement).render(
  <StrictMode>
    <TeaflaskAssistantProvider
      publishableKey={publishableKey}
      baseUrl={baseUrl}
      {...identity}
    >
      <TokenForm
        hasToken={endUserToken !== null}
        tokenUnreadable={tokenUnreadable}
        storageKey={tokenStorageKey}
        legacyUrlScrubbed={scrubbedHref !== null}
      />
      <RingConnectButton />
      <AssistantCompanion />
    </TeaflaskAssistantProvider>
  </StrictMode>,
);
