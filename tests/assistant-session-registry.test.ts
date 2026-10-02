// @vitest-environment jsdom
/**
 * The session registry's whole contract: one entry per identity key
 * shared across retains, ref-counted teardown on a microtask (so
 * StrictMode's release-then-retain never tears anything down), revival
 * after a sweep, and the three arbitration rules — first capable
 * registrant per capability, first identity-wired token resolver,
 * errors fanned out to everyone. The session and store are fakes that
 * expose what the registry wired into them; the real pair's behavior is
 * the store suite's and the element acceptance test's subject.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MintVisitorTokenResponse } from "../src/contract/identity";
import {
  AssistantSessionRegistry,
  DEFAULT_BASE_URL,
  type AssistantSessionEntry,
  type AssistantSessionRegistrant,
  type AssistantSessionSpec,
} from "../src/core/assistant-session-registry";
import type {
  ConversationStoreDeps,
  HostCapabilities,
} from "../src/core/conversation-store";
import {
  readStoredThread,
  writeStoredThread,
} from "../src/persistence/stored-thread";
import { ServingApiError } from "../src/transport/serving-error";
import type { TokenSessionConfig } from "../src/transport/token-session";

const { FakeTokenSession, FakeConversationStore } = vi.hoisted(() => {
  class FakeTokenSession {
    disposed = false;
    constructor(readonly config: unknown) {}
    dispose(): void {
      this.disposed = true;
    }
  }
  class FakeConversationStore {
    bootCount = 0;
    disposed = false;
    tier: unknown = null;
    constructor(readonly deps: unknown) {}
    bootstrap(): void {
      this.bootCount += 1;
      this.disposed = false;
    }
    setTier(tier: unknown): void {
      this.tier = tier;
    }
    dispose(): void {
      this.disposed = true;
    }
  }
  return { FakeTokenSession, FakeConversationStore };
});

vi.mock("../src/transport/token-session", () => ({
  TokenSession: FakeTokenSession,
  END_USER_ID_MISMATCH: "END_USER_ID_MISMATCH",
}));
vi.mock("../src/core/conversation-store", () => ({
  AssistantConversationStore: FakeConversationStore,
}));

const { getAssistantConfigMock, listSubscriptionsMock } = vi.hoisted(() => ({
  getAssistantConfigMock: vi.fn(),
  listSubscriptionsMock: vi.fn(),
}));
vi.mock("../src/transport/serving-api", () => ({
  getAssistantConfig: getAssistantConfigMock,
  listSubscriptions: listSubscriptionsMock,
}));

const PK = "pk_test_registry";
const USER_A = "user-a";
const USER_B = "user-b";

function specOf(
  overrides: Partial<AssistantSessionSpec> = {},
): AssistantSessionSpec {
  return { publishableKey: PK, ...overrides };
}

function registrantOf(
  overrides: Partial<AssistantSessionRegistrant> = {},
): AssistantSessionRegistrant {
  return {
    resolveEndUserToken: null,
    hostCapabilitiesOf: () => ({ navigate: null, executeActionIntent: null }),
    reportError: vi.fn(),
    onTelemetry: null,
    ...overrides,
  };
}

function sessionOf(
  entry: AssistantSessionEntry,
): InstanceType<typeof FakeTokenSession> & { config: TokenSessionConfig } {
  return entry.session as unknown as InstanceType<typeof FakeTokenSession> & {
    config: TokenSessionConfig;
  };
}

function storeOf(entry: AssistantSessionEntry): InstanceType<
  typeof FakeConversationStore
> & {
  deps: ConversationStoreDeps;
} {
  return entry.store as unknown as InstanceType<
    typeof FakeConversationStore
  > & { deps: ConversationStoreDeps };
}

function mintedOf(
  tier: MintVisitorTokenResponse["tier"],
  endUserId?: string | null,
): MintVisitorTokenResponse {
  return endUserId === undefined
    ? { visitor_token: "vt", expires_in: 900, tier }
    : { visitor_token: "vt", expires_in: 900, tier, end_user_id: endUserId };
}

function servingErrorOf(code: ServingApiError["code"]): ServingApiError {
  return new ServingApiError({
    code,
    status: 403,
    message: "The suite made this up.",
    retryAfterSeconds: null,
  });
}

async function sweepsFlushed(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let registry: AssistantSessionRegistry;

beforeEach(() => {
  window.localStorage.clear();
  getAssistantConfigMock.mockReset();
  registry = new AssistantSessionRegistry();
});

describe("identity keying", () => {
  it("resolves the same entry (and store) for the same spec", () => {
    const first = registry.entryFor(specOf());
    const second = registry.entryFor(specOf());
    expect(second).toBe(first);
    expect(second.store).toBe(first.store);
    expect(second.session).toBe(first.session);
  });

  it("normalizes a trailing slash and the default base url together", () => {
    const explicit = registry.entryFor(
      specOf({ baseUrl: `${DEFAULT_BASE_URL}/` }),
    );
    const defaulted = registry.entryFor(specOf());
    expect(defaulted).toBe(explicit);
  });

  it("keeps different identity wiring apart", () => {
    const anonymous = registry.entryFor(specOf());
    const identified = registry.entryFor(specOf({ userId: USER_A }));
    const otherKey = registry.entryFor(specOf({ publishableKey: "pk_other" }));
    expect(identified).not.toBe(anonymous);
    expect(otherKey).not.toBe(anonymous);
  });

  it("refuses an entry it did not construct", () => {
    expect(() =>
      registry.retain({} as unknown as AssistantSessionEntry, registrantOf()),
    ).toThrow(/entryFor/);
  });
});

describe("ref-counted lifecycle", () => {
  it("boots the store on the first retain only", () => {
    const entry = registry.entryFor(specOf());
    registry.retain(entry, registrantOf());
    registry.retain(entry, registrantOf());
    expect(storeOf(entry).bootCount).toBe(1);
  });

  it("sweeps on the last release: store and session disposed, key vacated", async () => {
    const entry = registry.entryFor(specOf());
    const releaseFirst = registry.retain(entry, registrantOf());
    const releaseSecond = registry.retain(entry, registrantOf());

    releaseFirst();
    await sweepsFlushed();
    expect(storeOf(entry).disposed).toBe(false);

    releaseSecond();
    await sweepsFlushed();
    expect(storeOf(entry).disposed).toBe(true);
    expect(sessionOf(entry).disposed).toBe(true);
    expect(registry.entryFor(specOf())).not.toBe(entry);
  });

  it("counts a double release once", async () => {
    const entry = registry.entryFor(specOf());
    const releaseFirst = registry.retain(entry, registrantOf());
    registry.retain(entry, registrantOf());

    releaseFirst();
    releaseFirst();
    await sweepsFlushed();

    expect(storeOf(entry).disposed).toBe(false);
    expect(registry.entryFor(specOf())).toBe(entry);
  });

  it("a release then retain in the same tick keeps the entry alive (StrictMode)", async () => {
    const entry = registry.entryFor(specOf());
    const release = registry.retain(entry, registrantOf());

    release();
    registry.retain(entry, registrantOf());
    await sweepsFlushed();

    expect(storeOf(entry).disposed).toBe(false);
    expect(registry.entryFor(specOf())).toBe(entry);
    // The second retain crossed 0→1 again, so it re-booted — bootstrap is
    // idempotent by the store's own contract.
    expect(storeOf(entry).bootCount).toBe(2);
  });

  it("a retain after the sweep revives and re-inserts the entry", async () => {
    const entry = registry.entryFor(specOf());
    registry.retain(entry, registrantOf())();
    await sweepsFlushed();
    expect(storeOf(entry).disposed).toBe(true);

    registry.retain(entry, registrantOf());
    expect(storeOf(entry).bootCount).toBe(2);
    expect(storeOf(entry).disposed).toBe(false);
    expect(registry.entryFor(specOf())).toBe(entry);
  });

  it("a stale entry's release never sweeps its successor", async () => {
    const stale = registry.entryFor(specOf());
    registry.retain(stale, registrantOf())();
    await sweepsFlushed();

    const successor = registry.entryFor(specOf());
    expect(successor).not.toBe(stale);
    registry.retain(successor, registrantOf());

    // A holder of the old reference retains and releases it while the
    // successor occupies the key — the stale entry runs unshared and its
    // sweep must not vacate the successor.
    registry.retain(stale, registrantOf())();
    await sweepsFlushed();

    expect(registry.entryFor(specOf())).toBe(successor);
    expect(storeOf(successor).disposed).toBe(false);
    expect(storeOf(stale).disposed).toBe(true);
  });
});

describe("the user boundary", () => {
  it("a userId change resolves a separate entry and the sweep disposes the old one", async () => {
    const forA = registry.entryFor(specOf({ userId: USER_A }));
    const releaseA = registry.retain(forA, registrantOf());
    sessionOf(forA).config.onMinted?.(mintedOf("identified", USER_A));
    expect(forA.tier.get()).toBe("identified");

    // The provider re-renders with the next user: a new entry, and the
    // old one is released the way the retain effect does it.
    const forB = registry.entryFor(specOf({ userId: USER_B }));
    registry.retain(forB, registrantOf());
    releaseA();
    await sweepsFlushed();

    expect(forB).not.toBe(forA);
    expect(forB.store).not.toBe(forA.store);
    expect(forB.session).not.toBe(forA.session);
    expect(storeOf(forA).disposed).toBe(true);
    expect(sessionOf(forA).disposed).toBe(true);
    // Nothing of A rides into B: no cached verdict, no setup error.
    expect(forB.tier.get()).toBeNull();
    expect(forB.setupError.get()).toBeNull();
    expect(storeOf(forB).deps.userId).toBe(USER_B);
    expect(sessionOf(forB).config.expectedEndUserId).toBe(USER_B);
  });

  it("a same-userId re-render keeps the entry", () => {
    const first = registry.entryFor(specOf({ userId: USER_A }));
    registry.retain(first, registrantOf());
    const again = registry.entryFor(specOf({ userId: USER_A }));
    expect(again).toBe(first);
  });

  it("userId → undefined (sign-out) is a different, anonymous entry", async () => {
    const signedIn = registry.entryFor(specOf({ userId: USER_A }));
    const release = registry.retain(signedIn, registrantOf());
    sessionOf(signedIn).config.onMinted?.(mintedOf("identified", USER_A));

    const signedOut = registry.entryFor(specOf());
    registry.retain(signedOut, registrantOf());
    release();
    await sweepsFlushed();

    expect(signedOut).not.toBe(signedIn);
    expect(storeOf(signedIn).disposed).toBe(true);
    expect(signedOut.tier.get()).toBeNull();
    expect(storeOf(signedOut).deps.userId).toBeUndefined();
    expect(sessionOf(signedOut).config.getEndUserToken).toBeUndefined();
  });

  it("an empty userId names nobody: the anonymous entry, no vouch wired", () => {
    const empty = registry.entryFor(specOf({ userId: "" }));
    expect(empty).toBe(registry.entryFor(specOf()));
    expect(sessionOf(empty).config.getEndUserToken).toBeUndefined();
    expect(sessionOf(empty).config.expectedEndUserId).toBeUndefined();
    expect(storeOf(empty).deps.userId).toBeUndefined();
  });

  it("the token session is told the user it must mint for", () => {
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    expect(sessionOf(entry).config.expectedEndUserId).toBe(USER_A);
    expect(storeOf(entry).deps.userId).toBe(USER_A);
  });

  it("a mint that disagrees with userId after the retry is a setup failure: the surfaces show nothing", () => {
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    const registrant = registrantOf();
    registry.retain(entry, registrant);

    const mismatch = servingErrorOf("END_USER_ID_MISMATCH");
    sessionOf(entry).config.onMintFailed?.(mismatch);

    expect(entry.setupError.get()).toBe(mismatch);
    expect(entry.tier.get()).toBeNull();
    expect(registrant.reportError).toHaveBeenCalledWith(mismatch);
  });

  it("a mint carrying no end_user_id lands as before", () => {
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    registry.retain(entry, registrantOf());

    sessionOf(entry).config.onMinted?.(mintedOf("identified"));

    expect(entry.tier.get()).toBe("identified");
    expect(entry.setupError.get()).toBeNull();
  });

  it("the sign-in claim stamps the stored thread with the user who claimed it", () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    registry.retain(entry, registrantOf());

    sessionOf(entry).config.onMinted?.(mintedOf("identified", USER_A));

    expect(readStoredThread(PK)).toEqual({
      threadId: "thread-1",
      identified: true,
      userId: USER_A,
    });
    // Another user's session offers nothing to claim from it.
    const forB = registry.entryFor(specOf({ userId: USER_B }));
    expect(sessionOf(forB).config.claimThreadId?.()).toBeNull();
  });
});

describe("the mint verdict", () => {
  it("caches tier for late registrants and pushes it into the store", () => {
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    registry.retain(entry, registrantOf());

    sessionOf(entry).config.onMinted?.(mintedOf("identified"));

    expect(entry.tier.get()).toBe("identified");
    expect(storeOf(entry).tier).toBe("identified");
    // The late registrant reads the cell — nothing to replay, the cached
    // snapshot IS the replay.
    registry.retain(entry, registrantOf());
    expect(entry.tier.get()).toBe("identified");
  });

  it("keeps setup failures and clears them on the next good mint", () => {
    const entry = registry.entryFor(specOf());
    const registrant = registrantOf();
    registry.retain(entry, registrant);

    sessionOf(entry).config.onMintFailed?.(
      servingErrorOf("PUBLISHABLE_KEY_INVALID"),
    );
    expect(entry.setupError.get()?.code).toBe("PUBLISHABLE_KEY_INVALID");

    sessionOf(entry).config.onMinted?.(mintedOf("anonymous"));
    expect(entry.setupError.get()).toBeNull();
  });

  it("a transient mint failure reports but never blanks the surfaces", () => {
    const entry = registry.entryFor(specOf());
    const first = registrantOf();
    const second = registrantOf();
    registry.retain(entry, first);
    registry.retain(entry, second);

    const transient = servingErrorOf("RATE_LIMITED");
    sessionOf(entry).config.onMintFailed?.(transient);

    expect(entry.setupError.get()).toBeNull();
    expect(first.reportError).toHaveBeenCalledWith(transient);
    expect(second.reportError).toHaveBeenCalledWith(transient);
  });

  it("marks the stored thread identified and withdraws the claim", () => {
    writeStoredThread(PK, { threadId: "thread-1", identified: false });
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    registry.retain(entry, registrantOf());
    expect(sessionOf(entry).config.claimThreadId?.()).toBe("thread-1");

    sessionOf(entry).config.onMinted?.(mintedOf("identified"));

    expect(readStoredThread(PK)?.identified).toBe(true);
    expect(sessionOf(entry).config.claimThreadId?.()).toBeNull();
  });
});

describe("the assistant-config fetch", () => {
  const SERVED = { default: [{ prompt: "Served opener" }], routes: [] };

  it("is single-flight: two ensures, one request, the verdict cached", async () => {
    getAssistantConfigMock.mockResolvedValue({ suggestions: SERVED });
    const entry = registry.entryFor(specOf());

    entry.ensureAssistantConfig();
    entry.ensureAssistantConfig();
    await Promise.resolve();

    expect(getAssistantConfigMock).toHaveBeenCalledTimes(1);
    expect(entry.assistantConfig.get()).toEqual(SERVED);

    // A success sticks for the session — a later mount never re-fetches.
    entry.ensureAssistantConfig();
    expect(getAssistantConfigMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the cell null on failure and lets a later mount retry", async () => {
    getAssistantConfigMock.mockRejectedValueOnce(new Error("network down"));
    getAssistantConfigMock.mockResolvedValueOnce({ suggestions: SERVED });
    const entry = registry.entryFor(specOf());

    entry.ensureAssistantConfig();
    await sweepsFlushed();
    expect(entry.assistantConfig.get()).toBeNull();

    entry.ensureAssistantConfig();
    await sweepsFlushed();
    expect(getAssistantConfigMock).toHaveBeenCalledTimes(2);
    expect(entry.assistantConfig.get()).toEqual(SERVED);
  });

  it("a failed fetch still ANSWERS — the shelf's slot signal settles", async () => {
    getAssistantConfigMock.mockRejectedValueOnce(new Error("network down"));
    const entry = registry.entryFor(specOf());
    expect(entry.configAnswered.get()).toBe(false);

    entry.ensureAssistantConfig();
    await sweepsFlushed();

    // Failure is an answer: the composer shelf may now fall back to the
    // provider chip instead of holding the slot blank forever.
    expect(entry.configAnswered.get()).toBe(true);
    expect(entry.modelChoice.get()).toBeNull();
  });
});

describe("arbitration", () => {
  it("capabilities come from the first capable registrant, per capability", () => {
    const navigate = () => Promise.resolve();
    const executeActionIntent = () =>
      Promise.reject(new Error("never executed"));
    const entry = registry.entryFor(specOf());
    registry.retain(
      entry,
      registrantOf({
        hostCapabilitiesOf: () => ({ navigate, executeActionIntent: null }),
      }),
    );
    registry.retain(
      entry,
      registrantOf({
        hostCapabilitiesOf: () => ({
          navigate: () => Promise.resolve(),
          executeActionIntent,
        }),
      }),
    );

    const merged: HostCapabilities = storeOf(entry).deps.hostCapabilitiesOf();
    expect(merged.navigate).toBe(navigate);
    expect(merged.executeActionIntent).toBe(executeActionIntent);
  });

  it("capabilities hand over when the first capable registrant releases", () => {
    const firstNavigate = () => Promise.resolve();
    const secondNavigate = () => Promise.resolve();
    const entry = registry.entryFor(specOf());
    const releaseFirst = registry.retain(
      entry,
      registrantOf({
        hostCapabilitiesOf: () => ({
          navigate: firstNavigate,
          executeActionIntent: null,
        }),
      }),
    );
    registry.retain(
      entry,
      registrantOf({
        hostCapabilitiesOf: () => ({
          navigate: secondNavigate,
          executeActionIntent: null,
        }),
      }),
    );
    expect(storeOf(entry).deps.hostCapabilitiesOf().navigate).toBe(
      firstNavigate,
    );

    releaseFirst();
    expect(storeOf(entry).deps.hostCapabilitiesOf().navigate).toBe(
      secondNavigate,
    );
  });

  it("the token resolver is the first identity-wired registrant, with handover", async () => {
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    registry.retain(entry, registrantOf());
    const releaseSecond = registry.retain(
      entry,
      registrantOf({ resolveEndUserToken: () => "token-two" }),
    );
    registry.retain(
      entry,
      registrantOf({ resolveEndUserToken: () => "token-three" }),
    );

    expect(await sessionOf(entry).config.getEndUserToken?.()).toBe("token-two");

    releaseSecond();
    expect(await sessionOf(entry).config.getEndUserToken?.()).toBe(
      "token-three",
    );
  });

  it("waits for the first retain instead of minting without an identity", async () => {
    // THE silent-anonymous bug: React commits a descendant's effects
    // before its provider's, so any request from below reaches the mint
    // before retain wires the resolver. Answering it anonymously ran the
    // whole session — every thread it created — as a visitor the member
    // never becomes.
    const entry = registry.entryFor(specOf({ userId: USER_A }));

    const vouch = sessionOf(entry).config.getEndUserToken?.();
    registry.retain(
      entry,
      registrantOf({ resolveEndUserToken: () => "token-late" }),
    );

    expect(await vouch).toBe("token-late");
  });

  it("gives up waiting when the render never commits", async () => {
    // The bound is the safety valve, not the mechanism: an entry whose
    // provider never retains must still answer, or the request that
    // triggered the mint hangs for the life of the page.
    vi.useFakeTimers();
    try {
      const entry = registry.entryFor(specOf({ userId: USER_A }));
      const vouch = sessionOf(entry).config.getEndUserToken?.();
      await vi.runAllTimersAsync();
      expect(await vouch).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never waits once the entry has been retained", async () => {
    // A release leaves no registrant behind, and that is the contract's
    // own fail-open case — not a provider on its way in.
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    const release = registry.retain(
      entry,
      registrantOf({ resolveEndUserToken: () => "token-one" }),
    );
    expect(await sessionOf(entry).config.getEndUserToken?.()).toBe("token-one");

    release();
    expect(await sessionOf(entry).config.getEndUserToken?.()).toBeNull();
  });

  it("fails open to anonymous when no registrant can resolve identity", async () => {
    const entry = registry.entryFor(specOf({ userId: USER_A }));
    registry.retain(entry, registrantOf());
    expect(await sessionOf(entry).config.getEndUserToken?.()).toBeNull();
  });

  it("store-level errors fan out to every registrant", () => {
    const entry = registry.entryFor(specOf());
    const first = registrantOf();
    const second = registrantOf();
    registry.retain(entry, first);
    registry.retain(entry, second);

    const failure = new Error("the stream fell over");
    storeOf(entry).deps.reportError(failure);

    expect(first.reportError).toHaveBeenCalledWith(failure);
    expect(second.reportError).toHaveBeenCalledWith(failure);
  });

  it("telemetry fans out to the wired registrants, and a throwing host hook never escapes the path it narrates", () => {
    const entry = registry.entryFor(specOf());
    const broken = registrantOf({
      onTelemetry: vi.fn(() => {
        throw new Error("the host analytics fell over");
      }),
    });
    const healthy = registrantOf({ onTelemetry: vi.fn() });
    const unwired = registrantOf();
    registry.retain(entry, broken);
    registry.retain(entry, healthy);
    registry.retain(entry, unwired);

    const event = {
      name: "approval_submit_attempted",
      properties: {
        interrupt_id: "v1:before_tool_call:t1:handler",
        thread_id: "thread-1",
        approved: true,
        trusted: false,
        card_status: "actionable",
        parked: false,
      },
    } as const;
    // The approval submit narrates through this dep BEFORE it validates
    // anything — a host throw escaping here would strand the card's
    // synchronous click guard disabled forever.
    expect(() => {
      storeOf(entry).deps.onTelemetry(event);
    }).not.toThrow();

    expect(healthy.onTelemetry).toHaveBeenCalledWith(event);
    // The broken hook is itself reported on the error seam.
    expect(healthy.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "the host analytics fell over" }),
    );
  });

  it("a throwing host reportError never escapes either — the error channel has nowhere left to report, so the console keeps the record", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const entry = registry.entryFor(specOf());
    const broken = registrantOf({
      reportError: vi.fn(() => {
        throw new Error("the host error hook fell over");
      }),
    });
    const healthy = registrantOf();
    registry.retain(entry, broken);
    registry.retain(entry, healthy);

    const failure = new Error("the stream fell over");
    expect(() => {
      storeOf(entry).deps.reportError(failure);
    }).not.toThrow();
    expect(healthy.reportError).toHaveBeenCalledWith(failure);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("reportError callback threw"),
      expect.objectContaining({ message: "the host error hook fell over" }),
      expect.any(String),
      failure,
    );
    warn.mockRestore();
  });
});

describe("the gate refusal hook", () => {
  it("the entry adopts a refusal as the gate — and re-reads the standing it spoke about", async () => {
    const registry = new AssistantSessionRegistry();
    const entry = registry.entryFor(specOf({ publishableKey: "pk_ringer" }));
    expect(entry.conversationGate.get()).toEqual({ kind: "none" });

    // The refusal is ABOUT the standing (an auth-bounced credential),
    // and the session-cached read predates it: the gate must refresh it
    // so the chip renders the bounced state, not a stale "Connected".
    const bounced = [
      {
        provider: "openai_chatgpt",
        offered: true,
        connected: true,
        state: "bounced",
        plan_type: null,
        bounce_cause: "auth",
        bounce_retry_at: null,
      },
    ];
    listSubscriptionsMock.mockResolvedValue(bounced);

    const deps = storeOf(entry).deps;
    deps.onGateRefusal(
      new ServingApiError({
        code: "SUBSCRIPTION_CONNECT_REQUIRED",
        message: "Reconnect your ChatGPT plan to continue here.",
        status: 403,
        retryAfterSeconds: null,
        details: { providers: ["openai_chatgpt"], reason: "auth_bounced" },
      }),
    );

    expect(entry.conversationGate.get()).toEqual({
      kind: "connect",
      reason: "auth_bounced",
      providers: ["openai_chatgpt"],
    });
    expect(listSubscriptionsMock).toHaveBeenCalled();
    await Promise.resolve();
    expect(entry.subscriptions.get()).toEqual(bounced);
  });

  it("a non-gate error leaves the gate alone", () => {
    const registry = new AssistantSessionRegistry();
    const entry = registry.entryFor(specOf({ publishableKey: "pk_nongate" }));
    const readsBefore = listSubscriptionsMock.mock.calls.length;

    storeOf(entry).deps.onGateRefusal(
      new ServingApiError({
        code: "RATE_LIMITED",
        message: "slow down",
        status: 429,
        retryAfterSeconds: 30,
      }),
    );

    expect(entry.conversationGate.get()).toEqual({ kind: "none" });
    expect(listSubscriptionsMock.mock.calls.length).toBe(readsBefore);
  });

  it("the parked chip ask still opens and acknowledges", () => {
    const registry = new AssistantSessionRegistry();
    const entry = registry.entryFor(specOf({ publishableKey: "pk_ask" }));
    expect(entry.connectOpenRequested.get()).toBe(false);

    entry.requestSubscriptionConnect();
    expect(entry.connectOpenRequested.get()).toBe(true);

    entry.acknowledgeSubscriptionConnect();
    expect(entry.connectOpenRequested.get()).toBe(false);
  });
});

describe("the subscriptions fetch", () => {
  it("an overtaken flight never clobbers the refresh that superseded it", async () => {
    const registry = new AssistantSessionRegistry();
    const entry = registry.entryFor(specOf({ publishableKey: "pk_ooo" }));

    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    listSubscriptionsMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    entry.ensureSubscriptions();
    entry.refreshSubscriptions(); // supersedes the first flight

    const newer = [
      {
        provider: "openai_chatgpt",
        offered: true,
        connected: true,
        state: "verifying",
        plan_type: null,
      },
    ];
    const stale = [
      {
        provider: "openai_chatgpt",
        offered: true,
        connected: false,
        state: null,
        plan_type: null,
      },
    ];
    resolveSecond(newer);
    await Promise.resolve();
    expect(entry.subscriptions.get()).toEqual(newer);

    // The first flight resolves late — and must change nothing.
    resolveFirst(stale);
    await Promise.resolve();
    expect(entry.subscriptions.get()).toEqual(newer);
  });
});
