// TeaFlask agent identity tokens (contract law 10). The DOM hooks
// [data-tf-agent-identity] / [data-tf-subagent-identity] carry these as
// their VALUES — a valueless hook is not an identity (TVC-090/091 read
// the tokens, not the attributes' presence).
//
// Ownership note: this module mints the identity tokens alone; the
// marks and their visible treatment are the renderer's. Every mark must
// derive its token from this module — a second token spelling would
// break TVC-091's cross-surface stability law.

/** The primary assistant's identity token — one agent, one constant. */
export const PRIMARY_AGENT_IDENTITY_TOKEN = "teaflask";

/**
 * A subagent's identity token: the child SESSION is the coworker's
 * identity (a resume chain deliberately shares it — several asks
 * of ONE coworker wear one mark), and the prefix makes a collision with
 * the primary token structurally impossible.
 */
export function subagentIdentityTokenOf(childSessionId: string): string {
  return `subagent:${childSessionId}`;
}
