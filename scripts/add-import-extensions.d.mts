// Type surface for the consumers outside this directory:
// tests/add-import-extensions.test.ts exercises the transform directly.
export type ResolveKind = (specifier: string) => "file" | "dir-index" | null;

export function rewriteImportExtensions(
  sourceText: string,
  fileName: string,
  resolveKind: ResolveKind,
): { text: string; rewrites: number };

export function fsResolveKind(importerDir: string): ResolveKind;
