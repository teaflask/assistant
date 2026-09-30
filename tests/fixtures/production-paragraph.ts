/**
 * The production regression fixture: the Vercel-style docs
 * architecture explanation a member pasted as a custom answer in R46,
 * which the legacy enum check refused as "not one of the choices". The
 * same bytes live in the serving side's production fixtures and the
 * dashboard's production-paragraph fixture so every layer proves
 * the same journey. Multi-line, curly quotes, an em dash, a URL, a
 * date-like and a number-like phrase — all of which must come back
 * verbatim.
 */
export const PASTED_DOCS_PARAGRAPH =
  "None of these exactly — I want the Vercel-style architecture:\n" +
  "\n" +
  "1. A “Getting started” track that reads top-to-bottom in 3 tiers " +
  "(quickstart → concepts → deep dives), each page one idea.\n" +
  "2. Reference pages generated from the code, one per public surface, " +
  "cross-linked from the concept pages — never the other way round.\n" +
  "3. Guides for the tasks people actually search for; see " +
  "https://vercel.com/docs for the tone.\n" +
  "\n" +
  "Ship the first cut by 2026-09-01 and keep the sidebar to 2 levels.";
