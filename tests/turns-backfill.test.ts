/**
 * The turns cursor walk (single-sourced when the playground fork
 * collapsed): a full newest window triggers a walk back until a short
 * page; a flaky page degrades to what landed; a superseded ask adopts
 * nothing.
 */
import { describe, expect, it } from "vitest";

import {
  backfilledTurnsOf,
  TURNS_WINDOW,
  type TurnsBackfillCursor,
} from "../src/core/turns-backfill";

interface Row {
  id: string;
  created_at: string;
}

function rowsOf(startIndex: number, count: number): Row[] {
  return Array.from({ length: count }, (_, offset) => {
    const index = String(startIndex + offset);
    return {
      id: `turn-${index}`,
      created_at: `2026-09-01T00:00:${index.padStart(2, "0")}Z`,
    };
  });
}

describe("backfilledTurnsOf", () => {
  it("a short first window walks nowhere", async () => {
    const window = rowsOf(0, 3);
    let fetches = 0;
    const turns = await backfilledTurnsOf(window, () => {
      fetches += 1;
      return Promise.resolve({ turns: [] });
    });
    expect(turns).toEqual(window);
    expect(fetches).toBe(0);
  });

  it("a full window walks the cursor back until a short page, oldest first", async () => {
    const oldest = rowsOf(0, 2);
    const middle = rowsOf(2, TURNS_WINDOW);
    const newest = rowsOf(2 + TURNS_WINDOW, TURNS_WINDOW);
    const cursors: TurnsBackfillCursor[] = [];
    const pages = [middle, oldest];
    const turns = await backfilledTurnsOf(newest, (cursor) => {
      cursors.push(cursor);
      return Promise.resolve({ turns: pages.shift() ?? [] });
    });
    expect(turns).toEqual([...oldest, ...middle, ...newest]);
    expect(cursors).toEqual([
      {
        before_created_at: newest[0]?.created_at,
        before_id: newest[0]?.id,
        limit: TURNS_WINDOW,
      },
      {
        before_created_at: middle[0]?.created_at,
        before_id: middle[0]?.id,
        limit: TURNS_WINDOW,
      },
    ]);
  });

  it("a flaky page degrades: the walk stops and what landed is returned", async () => {
    const newest = rowsOf(TURNS_WINDOW, TURNS_WINDOW);
    const turns = await backfilledTurnsOf(newest, () =>
      Promise.reject(new Error("boom")),
    );
    expect(turns).toEqual(newest);
  });

  it("a walk that outlived its adoption returns null and adopts nothing", async () => {
    const newest = rowsOf(TURNS_WINDOW, TURNS_WINDOW);
    let stale = false;
    const turns = await backfilledTurnsOf(
      newest,
      () => {
        stale = true;
        return Promise.resolve({ turns: rowsOf(0, 2) });
      },
      { isStale: () => stale },
    );
    expect(turns).toBeNull();
  });
});
