// Node's ESM resolver requires explicit extensions on relative
// specifiers, but this package type-checks under moduleResolution:
// "bundler" and tsc emits specifiers verbatim — so an extensionless
// `from "./x"` in src/ becomes an unloadable `./x` in dist/. This
// codemod appends `.js` (or `/index.js` for directory imports) to every
// relative specifier in src/. It is not a one-shot: `generate:api`
// chains it after orval so the codegen drift hook reproduces the
// extensions byte-identically on every regeneration, which is also why
// it must stay idempotent and fail loudly on anything it cannot resolve.
//
// Scope is src/**/*.{ts,tsx} only. tests/, fixtures/ and tests-e2e/ are
// never emitted to dist and stay extensionless; src/styles/styles.css
// carries a Tailwind `@source "../components"` directive that must never
// be touched, which the .ts/.tsx restriction guarantees.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import prettier from "prettier";
import ts from "typescript";

// Specifiers already wearing an extension are left alone — that is what
// makes a re-run (and every post-orval run) a no-op on settled files.
const HAS_KNOWN_EXTENSION = /\.(?:js|jsx|mjs|cjs|css|json)$/;

/**
 * Rewrites every extensionless relative specifier in one module's source
 * text. Covers static import/export-from (including type-only forms),
 * dynamic `import("…")` with a literal argument, and type-position
 * `typeof import("…")` — the last lands in the emitted .d.ts, where
 * node16 types resolution needs the extension just as much.
 *
 * `resolveKind(specifier)` answers "file" (append .js), "dir-index"
 * (append /index.js) or null (unresolvable — the transform throws, so a
 * regeneration that grows an unexpected shape fails the drift hook
 * loudly instead of shipping a broken specifier).
 */
export function rewriteImportExtensions(sourceText, fileName, resolveKind) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const edits = [];
  const consider = (literal) => {
    const specifier = literal.text;
    if (!specifier.startsWith(".") || HAS_KNOWN_EXTENSION.test(specifier)) {
      return;
    }
    const kind = resolveKind(specifier);
    if (kind !== "file" && kind !== "dir-index") {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        literal.getStart(sourceFile),
      );
      throw new Error(
        `${fileName}:${line + 1}:${character + 1} — relative specifier ` +
          `"${specifier}" resolves to neither <specifier>.ts(x) nor ` +
          `<specifier>/index.ts(x); add-import-extensions cannot extend it.`,
      );
    }
    // literal.end sits after the closing quote; the suffix goes before it.
    edits.push({
      at: literal.end - 1,
      suffix: kind === "file" ? ".js" : "/index.js",
    });
  };

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      consider(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      consider(node.arguments[0]);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      consider(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Right-to-left splices on the raw text: no AST printer, so every byte
  // the codemod does not own survives untouched.
  let text = sourceText;
  for (const edit of edits.sort((a, b) => b.at - a.at)) {
    text = text.slice(0, edit.at) + edit.suffix + text.slice(edit.at);
  }
  return { text, rewrites: edits.length };
}

/**
 * The filesystem-backed resolver for one importing file's directory.
 * Files win over directories: src/element.ts and src/element/ coexist,
 * and TS resolves the file first — the codemod must agree.
 */
export function fsResolveKind(importerDir) {
  return (specifier) => {
    const base = resolve(importerDir, specifier);
    if (existsSync(`${base}.ts`) || existsSync(`${base}.tsx`)) {
      return "file";
    }
    if (
      existsSync(join(base, "index.ts")) ||
      existsSync(join(base, "index.tsx"))
    ) {
      return "dir-index";
    }
    return null;
  };
}

function collectModuleFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectModuleFiles(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

async function main() {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const rootDir = resolve(packageDir, process.argv[2] ?? "src");

  let rewrites = 0;
  let changedFiles = 0;
  for (const file of collectModuleFiles(rootDir)) {
    const before = readFileSync(file, "utf8");
    const { text, rewrites: fileRewrites } = rewriteImportExtensions(
      before,
      file,
      fsResolveKind(dirname(file)),
    );
    if (fileRewrites === 0) {
      continue;
    }
    // An appended extension can push a line past the print width; the
    // pre-commit prettier hook would then rewrap into a shape a later
    // regeneration could not reproduce — so the codemod formats its own
    // output and regeneration stays byte-stable.
    const config = await prettier.resolveConfig(file);
    const formatted = await prettier.format(text, {
      ...config,
      filepath: file,
    });
    writeFileSync(file, formatted);
    rewrites += fileRewrites;
    changedFiles += 1;
  }
  console.log(
    `add-import-extensions: ${rewrites} specifier(s) rewritten across ` +
      `${changedFiles} file(s) under ${rootDir}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
