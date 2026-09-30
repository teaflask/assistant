// The epoch seed census: everything a fresh connection epoch
// is built or seeded from, classified by lifetime.
//
// THE GENERATING MECHANISM this closes: syncEpoch mints a fresh epoch —
// a fresh agent, a fresh execution inbox, a fresh driver — on every
// signature change (a send, a retry, a thread switch, a background
// attach), and seeds it from state the store still holds. A seed that
// OUTLIVES the conversation it describes is re-planted into the new
// epoch as if it were current: the round-1 review found the coworker
// requests window doing exactly that — the send staled the entries and
// the same synchronous path re-minted them pending from the store-lived
// window, and a thread switch seeded the next thread with the previous
// thread's requests. The approval inbox never had the problem because it
// is CARRIED on the active conversation, whose lifetime is the
// conversation's.
//
// THE LAW: every seed a fresh epoch takes is a member of the ACTIVE
// CONVERSATION (`active.*`), never a bare store field — so it dies with
// the conversation by construction, and each local mutation that
// invalidates it is named here with how the member is moved. The
// derivation is the source: every `active.<member>` and `store._<field>`
// read inside syncEpoch and _mintEpochDeps must have a row, and no
// `store._` row may be classified as a seed. Nothing here is a count.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, "../src/core/epoch-sync.ts"),
  "utf8",
);

type Lifetime = "conversation" | "store";
type Role =
  | "seed" // the fresh epoch is built or seeded from it
  | "signature" // decides whether a fresh epoch is minted
  | "bookkeeping" // the epoch handle and its own identity
  | "cleared" // per-epoch scratch the mint clears
  | "published" // a cell the mint sets FROM the epoch, never a seed
  | "guard"; // read to decide whether to mint at all

interface SeedRow {
  lifetime: Lifetime;
  role: Role;
  /** For a seed: every local mutation that makes it stale, and how the
   *  member moves — the reviewer verifies each against the site. */
  invalidatedBy?: string;
}

const EPOCH_SEEDS: Record<string, SeedRow> = {
  // --- the active conversation's members (conversation-lived) ---
  "active.thread": {
    lifetime: "conversation",
    role: "seed",
    invalidatedBy:
      "a send or a refresh whose thread record moved replaces the whole " +
      "_active object; a switch or abandon drops it",
  },
  "active.ledger": {
    lifetime: "conversation",
    role: "seed",
    invalidatedBy:
      "a thread switch mints a fresh UserTurnLedger; a send or refresh " +
      "merges the new turn into the carried one",
  },
  "active.resume": {
    lifetime: "conversation",
    role: "seed",
    invalidatedBy:
      "a thread switch mints a fresh StreamResumeStore; the same thread " +
      "carries it (the resume snapshot must survive a remount)",
  },
  "active.approvalInbox": {
    lifetime: "conversation",
    role: "seed",
    invalidatedBy:
      "the send's member open voids the pause — enterConversationFromSend " +
      "calls markPauseStale on the carried inbox; a thread switch mints a " +
      "fresh ApprovalInbox",
  },
  "active.coworkerRequestTurns": {
    lifetime: "conversation",
    role: "seed",
    invalidatedBy:
      "the send's member open voids every paused coworker — " +
      "enterConversationFromSend enters with an EMPTY window (the fresh " +
      "epoch seeds nothing) after staling the live inbox's entries; a " +
      "conversation read replaces it (adoptCoworkerRequests); a thread " +
      "switch or abandon drops it with _active",
  },
  // --- store fields syncEpoch reads (none is a seed) ---
  "store._active": { lifetime: "store", role: "guard" },
  "store._disposed": { lifetime: "store", role: "guard" },
  "store._approvalsCell": { lifetime: "store", role: "published" },
  "store._coworkerWorkCell": { lifetime: "store", role: "published" },
  "store._reconnectNonce": { lifetime: "store", role: "signature" },
  "store._backgroundAttachNonce": { lifetime: "store", role: "signature" },
  "store._epoch": { lifetime: "store", role: "bookkeeping" },
  "store._epochSignature": { lifetime: "store", role: "bookkeeping" },
  "store._epochResume": { lifetime: "store", role: "bookkeeping" },
  "store._nextEpochId": { lifetime: "store", role: "bookkeeping" },
  "store._epochConnectedOnce": { lifetime: "store", role: "bookkeeping" },
  "store._elicitationErrors": { lifetime: "store", role: "cleared" },
  "store._questionAnswers": { lifetime: "store", role: "cleared" },
  "store._messagesCell": { lifetime: "store", role: "published" },
  "store._markerAnchorsCell": { lifetime: "store", role: "published" },
  "store._connectionCell": { lifetime: "store", role: "published" },
};

function bodyOf(functionName: string): string {
  const start = SOURCE.indexOf(`function ${functionName}(`);
  if (start === -1) {
    throw new Error(`${functionName} is not in epoch-sync.ts`);
  }
  const end = SOURCE.indexOf("\n}\n", start);
  return SOURCE.slice(start, end);
}

/** Every `active.<member>` and `store._<field>` the two functions read. */
function referencesIn(body: string): Set<string> {
  const found = new Set<string>();
  for (const match of body.matchAll(/\bactive\.(\w+)/g)) {
    found.add(`active.${match[1]}`);
  }
  for (const match of body.matchAll(/\bstore\._(\w+)/g)) {
    found.add(`store._${match[1]}`);
  }
  return found;
}

describe("the epoch seed census", () => {
  const referenced = new Set([
    ...referencesIn(bodyOf("syncEpoch")),
    ...referencesIn(bodyOf("_mintEpochDeps")),
  ]);

  it("classifies every field a fresh epoch is minted or seeded from — a new one reds here until it has a row", () => {
    expect([...referenced].sort()).toEqual(Object.keys(EPOCH_SEEDS).sort());
  });

  it("seeds only from the active conversation — a store-lived field can never seed an epoch", () => {
    const storeSeeds = Object.entries(EPOCH_SEEDS)
      .filter(([name, row]) => name.startsWith("store.") && row.role === "seed")
      .map(([name]) => name);
    expect(storeSeeds).toEqual([]);
    for (const [name, row] of Object.entries(EPOCH_SEEDS)) {
      if (row.role === "seed") {
        expect(row.lifetime, name).toBe("conversation");
        expect(row.invalidatedBy, name).toBeTruthy();
      }
    }
  });

  it("the active conversation's members are exactly the seeds — a member nothing seeds from is dead weight, a seed off the conversation is the mechanism", () => {
    const contract = readFileSync(
      path.resolve(import.meta.dirname, "../src/core/conversation-contract.ts"),
      "utf8",
    );
    const start = contract.indexOf("export interface ActiveConversation {");
    const end = contract.indexOf("\n}\n", start);
    const members = [
      ...contract.slice(start, end).matchAll(/^\s{2}(\w+):/gm),
    ].map((match) => `active.${match[1]}`);
    const seeds = Object.entries(EPOCH_SEEDS)
      .filter(([, row]) => row.role === "seed")
      .map(([name]) => name);
    expect(members.sort()).toEqual(seeds.sort());
  });
});
