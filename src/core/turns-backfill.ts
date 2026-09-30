// The thread detail serves the newest window of a conversation's turns
// (TURNS_PAGE_SIZE in the contract; a full window means earlier turns
// exist), but the stream replay is the whole conversation — so the ledger
// must hold every turn or old runs replay with the wrong (or no) user
// message spliced in front. A full first window triggers a cursor walk
// back until a short page. Both doors serve the same window shape, so the
// widget store and the playground hook walk through this one function.
export const TURNS_WINDOW = 200;

/** The turns page cursor both doors' thread-detail GET accepts. */
export interface TurnsBackfillCursor {
  before_created_at: string;
  before_id: string;
  limit: number;
}

/**
 * Walks the turns cursor back from a full newest window until a short
 * page, oldest first. A flaky page degrades instead of blocking: the walk
 * stops and what landed is returned — the oldest splices degrade, the
 * conversation never blocks. `isStale` is re-read after every await; a
 * walk that outlived its adoption (the user opened another thread
 * mid-drain) returns null and the caller adopts nothing.
 */
export async function backfilledTurnsOf<
  T extends { id: string; created_at: string },
>(
  newestWindow: readonly T[],
  fetchPage: (cursor: TurnsBackfillCursor) => Promise<{ turns: T[] }>,
  opts: { isStale?: () => boolean } = {},
): Promise<T[] | null> {
  const turns = [...newestWindow];
  let oldest: T | undefined =
    turns.length >= TURNS_WINDOW ? turns[0] : undefined;
  while (oldest !== undefined) {
    let page: { turns: T[] };
    try {
      page = await fetchPage({
        before_created_at: oldest.created_at,
        before_id: oldest.id,
        limit: TURNS_WINDOW,
      });
    } catch {
      break;
    }
    if (opts.isStale?.()) {
      return null;
    }
    turns.unshift(...page.turns);
    oldest = page.turns.length < TURNS_WINDOW ? undefined : page.turns[0];
  }
  if (opts.isStale?.()) {
    return null;
  }
  return turns;
}
