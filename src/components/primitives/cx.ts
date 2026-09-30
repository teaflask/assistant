// Class-name joiner for the primitives layer — the package deliberately
// carries no styling dependencies.
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
