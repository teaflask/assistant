// The host's identity pair, judged by one rule for every entry point (the
// React provider, the custom elements, the registry spec): the session is
// identified only when a non-empty userId AND getEndUserToken are both
// present; anything else — one half alone, or an empty id, which a
// templated `user?.id ?? ""` produces — runs anonymous, and is named once
// so a silently anonymous session is never an unseen wiring mistake.

type GetEndUserToken = () => string | null | Promise<string | null>;

export interface IdentityPairInput {
  userId?: string | null;
  getEndUserToken?: GetEndUserToken | null;
}

export interface NamedIdentity {
  userId: string;
  getEndUserToken: GetEndUserToken;
}

export const IDENTITY_PAIR_WARNING =
  "userId and getEndUserToken must be set together — a non-empty id with its vouch; the session runs anonymous until both are.";

/** The pair when it is whole, null otherwise. */
export function namedIdentityOf(
  input: IdentityPairInput,
): NamedIdentity | null {
  const userId = namedUserIdOf(input.userId);
  const getEndUserToken = input.getEndUserToken ?? undefined;
  return userId !== undefined && getEndUserToken !== undefined
    ? { userId, getEndUserToken }
    : null;
}

/** Something was set, but not a whole pair: the one shape worth a warning. */
export function identityPairIsHalfSet(input: IdentityPairInput): boolean {
  const nothingSet =
    (input.userId ?? undefined) === undefined &&
    (input.getEndUserToken ?? undefined) === undefined;
  return !nothingSet && namedIdentityOf(input) === null;
}

/** The userId half of the rule: null, undefined and "" all name nobody. */
export function namedUserIdOf(
  userId: string | null | undefined,
): string | undefined {
  return userId === null || userId === undefined || userId === ""
    ? undefined
    : userId;
}
