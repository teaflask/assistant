// The connect bench's token scoping and URL hygiene, kept pure so
// tests/connect-bench-token.test.ts can hold the two invariants
// deterministically: one stored JWT per (api base, publishable key)
// pair, and a legacy token query param is scrubbed without ever being
// read.

// One storage key per (api base, publishable key) pair: switching either
// in the same tab must never replay a stored identity against a
// different endpoint or key. The base is normalized (origin plus
// path, trailing slashes dropped) so spelling variants of one endpoint
// share a key; a malformed or empty base still yields a stable,
// distinct key rather than a throw.
export function tokenStorageKeyOf(
  baseUrl: string,
  publishableKey: string,
): string {
  const key = publishableKey === "" ? "unset" : publishableKey;
  return `tf-connect-bench:eut:${normalizedBase(baseUrl)}:${key}`;
}

function normalizedBase(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    const trimmed = raw.trim();
    return trimmed === "" ? "unset" : `opaque:${trimmed}`;
  }
}

/** The href with the legacy token query param removed — the param's
 *  VALUE is never read, only deleted — or null when there is nothing to
 *  scrub (no param, or an href the URL parser refuses). Every other
 *  query param and the hash survive. */
export function urlWithoutLegacyTokenParam(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!url.searchParams.has("eut")) {
    return null;
  }
  url.searchParams.delete("eut");
  return url.toString();
}
