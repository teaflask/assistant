// The committed sweep enumeration for the import-extension codemod:
// every case that would break the "append .js to relative specifiers"
// class is posed here, so the enumeration is verified rather than
// authored. The codemod is not a one-shot — generate:api chains it
// after orval — so these cases guard every future regeneration too.
import { describe, expect, it } from "vitest";

import {
  rewriteImportExtensions,
  type ResolveKind,
} from "../scripts/add-import-extensions.mjs";

// A stub resolver over a fixed universe: `./models` and `../generated/models`
// are directories with an index module; `./both` is the file-versus-directory
// collision (src/element.ts vs src/element/); everything else relative is a
// plain module file except `./missing`, which resolves to nothing.
const resolveKind: ResolveKind = (specifier) => {
  const tail = specifier.replace(/^(?:\.\.?\/)+/, "");
  if (tail === "models" || tail === "generated/models") {
    return "dir-index";
  }
  if (tail === "missing") {
    return null;
  }
  return "file";
};

function transform(source: string): string {
  return rewriteImportExtensions(source, "probe.tsx", resolveKind).text;
}

describe("add-import-extensions codemod", () => {
  it("leaves bare specifiers untouched", () => {
    const source =
      'import { filter } from "rxjs";\nimport React from "react";\nimport { c } from "@ag-ui/core";\n';
    expect(transform(source)).toBe(source);
  });

  it("leaves virtual: specifiers untouched", () => {
    const source = 'import cssText from "virtual:tf-element-styles";\n';
    expect(transform(source)).toBe(source);
  });

  it("leaves .css and .json specifiers untouched", () => {
    const source =
      'import "./styles.css";\nimport spec from "./contract.json";\n';
    expect(transform(source)).toBe(source);
  });

  it("appends .js to a plain relative value import", () => {
    expect(transform('import { a } from "./a";\n')).toBe(
      'import { a } from "./a.js";\n',
    );
    expect(transform('import { b } from "../up/b";\n')).toBe(
      'import { b } from "../up/b.js";\n',
    );
  });

  it("appends .js to type-only imports", () => {
    expect(transform('import type { T } from "./types";\n')).toBe(
      'import type { T } from "./types.js";\n',
    );
  });

  it("appends .js to every export-from form", () => {
    expect(transform('export * from "./m";\n')).toBe(
      'export * from "./m.js";\n',
    );
    expect(transform('export { x } from "./b";\n')).toBe(
      'export { x } from "./b.js";\n',
    );
    expect(transform('export type { C } from "./c";\n')).toBe(
      'export type { C } from "./c.js";\n',
    );
  });

  it("appends .js to a literal dynamic import()", () => {
    expect(transform('const m = import("./lazy");\n')).toBe(
      'const m = import("./lazy.js");\n',
    );
  });

  it("leaves a non-literal dynamic import() untouched", () => {
    const source = "const m = import(pathVariable);\n";
    expect(transform(source)).toBe(source);
  });

  it("appends .js inside typeof import() type positions", () => {
    expect(
      transform('let h: typeof import("./shiki-highlighter") | null = null;\n'),
    ).toBe('let h: typeof import("./shiki-highlighter.js") | null = null;\n');
  });

  it("appends /index.js to directory imports", () => {
    expect(transform('import { M } from "../generated/models";\n')).toBe(
      'import { M } from "../generated/models/index.js";\n',
    );
    expect(transform('export * from "./models";\n')).toBe(
      'export * from "./models/index.js";\n',
    );
  });

  it("prefers the file over the directory when both exist", () => {
    // Mirrors src/element.ts coexisting with src/element/ — TS resolves
    // the file first, so the codemod must too.
    const kinds: ResolveKind = (specifier) =>
      specifier === "./both" ? "file" : null;
    expect(
      rewriteImportExtensions('import "./both";\n', "probe.ts", kinds).text,
    ).toBe('import "./both.js";\n');
  });

  it("leaves already-extended specifiers untouched, and is idempotent", () => {
    const settled =
      'import { a } from "./a.js";\nexport * from "./models/index.js";\n';
    expect(transform(settled)).toBe(settled);

    const once = transform(
      'import { a } from "./a";\nexport * from "./models";\n',
    );
    expect(transform(once)).toBe(once);
  });

  it("throws with file:line on an unresolvable relative specifier", () => {
    expect(() => transform('\nimport { gone } from "./missing";\n')).toThrow(
      /probe\.tsx:2:22.*"\.\/missing"/,
    );
  });

  it("rewrites multiple specifiers in one file without disturbing bytes it does not own", () => {
    const source = [
      '// leading comment mentioning "./decoy" stays untouched',
      'import { a } from "./a";',
      'import type { T } from "../types";',
      'const later = () => import("./lazy");',
      'export * from "./models";',
      "",
    ].join("\n");
    expect(transform(source)).toBe(
      [
        '// leading comment mentioning "./decoy" stays untouched',
        'import { a } from "./a.js";',
        'import type { T } from "../types.js";',
        'const later = () => import("./lazy.js");',
        'export * from "./models/index.js";',
        "",
      ].join("\n"),
    );
  });
});
