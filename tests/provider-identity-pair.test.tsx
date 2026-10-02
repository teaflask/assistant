// @vitest-environment jsdom

// The React provider applies core/identity-pair's rule to every cell of
// the matrix a plain-JS host can produce (the props union binds only
// TypeScript), and says the half-set cases once per page.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TeaflaskAssistantProvider,
  type TeaflaskAssistantProviderProps,
  useAssistantSession,
} from "../src/components/teaflask-assistant-provider";
import type { TokenSessionConfig } from "../src/transport/token-session";
import { IDENTITY_PAIR_MATRIX } from "./identity-pair-matrix";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const sessions = vi.hoisted(() => ({ configs: [] as TokenSessionConfig[] }));
vi.mock("../src/transport/token-session", () => ({
  TokenSession: class {
    constructor(config: TokenSessionConfig) {
      sessions.configs.push(config);
    }
    dispose(): void {
      // Nothing to release — no mint ever starts here.
    }
    authorizedFetch(): Promise<never> {
      return new Promise<never>(() => undefined);
    }
  },
}));

const observed = { identityProvided: [] as boolean[] };
function IdentityProbe() {
  observed.identityProvided.push(useAssistantSession().identityProvided);
  return null;
}

// The warn-once ledger is page state, so the warnings are counted across
// the whole file: the first half-set cell adds the line, no later cell
// adds another, and the correct cells add none.
const pairWarnings: string[] = [];
let halfSetCellsSeen = 0;

let container: HTMLDivElement;
let root: Root;
let serial = 0;

beforeEach(() => {
  observed.identityProvided = [];
  sessions.configs = [];
  vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
    if (String(message).includes("must be set together")) {
      pairWarnings.push(String(message));
    }
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// Built as the untyped host builds them: the pairing union is bypassed
// on purpose, since that is exactly the host this rule exists for.
function mount(userId: string | undefined, vouch: (() => string) | undefined) {
  serial += 1;
  const props = {
    publishableKey: `pk_test_pair_${String(serial)}`,
    userId,
    getEndUserToken: vouch,
  } as unknown as TeaflaskAssistantProviderProps;
  act(() => {
    root.render(
      <TeaflaskAssistantProvider {...props}>
        <IdentityProbe />
      </TeaflaskAssistantProvider>,
    );
  });
}

describe("the provider and the identity pair", () => {
  it.each(IDENTITY_PAIR_MATRIX)(
    "$name → identified: $identified, half-set: $halfSet",
    ({ userId, vouch, identified, halfSet }) => {
      mount(userId, vouch);
      const config = sessions.configs.at(-1);
      expect(observed.identityProvided.at(-1)).toBe(identified);
      expect(config?.getEndUserToken !== undefined).toBe(identified);
      expect(config?.expectedEndUserId).toBe(identified ? userId : undefined);

      if (halfSet) {
        halfSetCellsSeen += 1;
      }
      expect(pairWarnings).toHaveLength(halfSetCellsSeen > 0 ? 1 : 0);
    },
  );

  it("covered both correct shapes and all four half-set cells", () => {
    expect(IDENTITY_PAIR_MATRIX.filter((cell) => !cell.halfSet)).toHaveLength(
      2,
    );
    expect(halfSetCellsSeen).toBe(4);
    expect(pairWarnings).toHaveLength(1);
    expect(pairWarnings[0]).toContain("[teaflask-assistant]");
  });
});
