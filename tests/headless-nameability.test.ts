/**
 * The headless nameability law ("a public field's type must be nameable
 * by the host reading it", closed as a rule rather than leg by leg). The
 * law walks every export of src/headless.ts with the TypeScript checker:
 * for each exported value's call signatures and each exported type's
 * public structure (properties, signatures, unions, type arguments),
 * every NAMED type declared under src/ that a host can observe one level
 * down must be either exported from ./headless itself or on the
 * committed OPAQUE ledger below — machinery that deliberately rides a
 * public type without being nameable (a host receives it and hands it
 * back; it never constructs or annotates one).
 *
 * What this makes impossible: shipping a hook or type whose public field
 * needs `import type { X } from "@teaflask/assistant"` (the
 * chrome-bearing root) or is unnameable everywhere — the defect shape of
 * ServingErrorCodeOnTheWire (round 2), the ComposerContract field types
 * (round 4) and the provider props' field types (round 5). A new
 * unnameable field type fails here until it is exported or ledgered.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
// The program's file names are absolute forward-slash paths; a symbol is
// the package's own when its declaration sits under this prefix.
const SRC_ROOT = path.join(packageRoot, "src") + "/";

/** Types deliberately NOT nameable from ./headless: internals riding a
 *  public type opaquely. Each row must still be demanded by the walk —
 *  a stale row fails — and must never ALSO be exported. */
const OPAQUE: ReadonlyMap<string, string> = new Map([
  [
    "UserTurnLedger",
    "ActiveConversation.ledger — the replay ledger is store machinery; a host receives the conversation and never constructs or annotates a ledger",
  ],
  [
    "StreamResumeStore",
    "ActiveConversation.resume — transport resume machinery riding the conversation opaquely, same stance",
  ],
  [
    "ApprovalInbox",
    "ActiveConversation.approvalInbox — store machinery behind useApprovals(); the nameable surface is ApprovalSurface/ApprovalCardModel",
  ],
  [
    "ServingAssistantTurnResponse",
    "ActiveConversation.coworkerRequestTurns — the seed window a fresh epoch's execution inbox takes its coworker requests from is store machinery (tests/epoch-seed-census.test.ts); a host reads a coworker's browser work through the store's coworkerWork cell, never the window",
  ],
]);

function headlessProgram(): {
  checker: ts.TypeChecker;
  moduleSymbol: ts.Symbol;
} {
  const configFile = ts.readConfigFile(
    path.join(packageRoot, "tsconfig.json"),
    (file) => ts.sys.readFile(file),
  );
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    packageRoot,
  );
  const entry = path.join(packageRoot, "src/headless.ts");
  const program = ts.createProgram([entry], parsed.options);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(entry);
  if (sourceFile === undefined) {
    throw new Error("src/headless.ts did not load");
  }
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) {
    throw new Error("no module symbol for src/headless.ts");
  }
  return { checker, moduleSymbol };
}

function isDeclaredUnderSrc(symbol: ts.Symbol): boolean {
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined) {
    return false;
  }
  return declaration.getSourceFile().fileName.startsWith(SRC_ROOT);
}

function originalOf(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

/** Collect every named src-declared type observable ONE level down from
 *  `type` — named references are recorded, not entered (each recorded
 *  name must itself be exported, at which point the walk covers ITS
 *  fields, giving the transitive closure over the export surface). */
function collectNamed(
  checker: ts.TypeChecker,
  type: ts.Type,
  out: Map<ts.Symbol, string>,
  context: string,
  depth: number,
  rootSymbol: ts.Symbol | null = null,
): void {
  if (depth > 6) {
    return;
  }
  const record = (symbol: ts.Symbol | undefined): boolean => {
    if (symbol === undefined) {
      return false;
    }
    const original = originalOf(checker, symbol);
    if (!isDeclaredUnderSrc(original)) {
      return false;
    }
    // Anonymous structural symbols (object literal types) are not
    // nameable things — their PROPERTIES are walked instead.
    if (original.name.startsWith("__")) {
      return false;
    }
    // Only TYPE-shaped symbols are nameability subjects: a class method's
    // own symbol (QuestionDraftStore.clear, say) is src-declared but a
    // host names its CONTAINING type, not the method.
    if (
      (original.flags &
        (ts.SymbolFlags.Interface |
          ts.SymbolFlags.TypeAlias |
          ts.SymbolFlags.Class |
          ts.SymbolFlags.Enum)) ===
      0
    ) {
      return false;
    }
    if (!out.has(original)) {
      out.set(original, context);
    }
    return true;
  };

  for (const part of type.isUnionOrIntersection() ? type.types : [type]) {
    // The exported type ITSELF must not stop the walk (the shallow-walk
    // bug the ActiveConversation machinery fields exposed): at the root,
    // the export's own name is skipped so its fields are what get
    // demanded.
    const partSymbol =
      (part.flags & ts.TypeFlags.Object) !== 0
        ? (part as ts.ObjectType).symbol
        : undefined;
    const isSelf =
      rootSymbol !== null &&
      (part.aliasSymbol === rootSymbol || partSymbol === rootSymbol);
    // A named src type: record it and also descend into its type
    // arguments (ReadonlyCell<ComposerInput> demands both names).
    const named =
      !isSelf &&
      (record(part.aliasSymbol) ||
        ((part.flags & ts.TypeFlags.Object) !== 0 &&
          record((part as ts.ObjectType).symbol)));
    const reference = part as ts.TypeReference;
    const typeArguments =
      part.aliasSymbol !== undefined
        ? (part.aliasTypeArguments ?? [])
        : checker.getTypeArguments(reference);
    for (const argument of typeArguments) {
      collectNamed(checker, argument, out, context, depth + 1);
    }
    if (named) {
      continue;
    }
    // Anonymous structure: walk its own surface.
    if ((part.flags & ts.TypeFlags.Object) !== 0) {
      for (const property of checker.getPropertiesOfType(part)) {
        const declaration =
          property.declarations?.[0] ?? property.valueDeclaration;
        if (declaration === undefined) {
          continue;
        }
        collectNamed(
          checker,
          checker.getTypeOfSymbolAtLocation(property, declaration),
          out,
          `${context}.${property.name}`,
          depth + 1,
        );
      }
      for (const signature of [
        ...part.getCallSignatures(),
        ...part.getConstructSignatures(),
      ]) {
        for (const parameter of signature.parameters) {
          const declaration = parameter.valueDeclaration;
          if (declaration === undefined) {
            continue;
          }
          collectNamed(
            checker,
            checker.getTypeOfSymbolAtLocation(parameter, declaration),
            out,
            `${context}(${parameter.name})`,
            depth + 1,
          );
        }
        collectNamed(
          checker,
          signature.getReturnType(),
          out,
          `${context}=>`,
          depth + 1,
        );
      }
    }
  }
}

describe("every public field type on ./headless is nameable or ledgered opaque", () => {
  const { checker, moduleSymbol } = headlessProgram();
  const exports = checker.getExportsOfModule(moduleSymbol);
  const provided = new Map<ts.Symbol, string>();
  for (const exported of exports) {
    provided.set(originalOf(checker, exported), exported.name);
  }

  // The demand set: walk one level of every export's public surface.
  const required = new Map<ts.Symbol, string>();
  for (const exported of exports) {
    const original = originalOf(checker, exported);
    const isTypeish =
      (original.flags &
        (ts.SymbolFlags.Interface |
          ts.SymbolFlags.TypeAlias |
          ts.SymbolFlags.Class)) !==
      0;
    if (isTypeish) {
      collectNamed(
        checker,
        checker.getDeclaredTypeOfSymbol(original),
        required,
        exported.name,
        0,
        original,
      );
    }
    if ((original.flags & ts.SymbolFlags.Value) !== 0) {
      const declaration =
        original.valueDeclaration ?? original.declarations?.[0];
      if (declaration !== undefined) {
        collectNamed(
          checker,
          checker.getTypeOfSymbolAtLocation(original, declaration),
          required,
          exported.name,
          0,
        );
      }
    }
  }

  it("anti-vacuity: the walk demands the known load-bearing names", () => {
    const names = new Set([...required.keys()].map((symbol) => symbol.name));
    expect(required.size).toBeGreaterThan(20);
    for (const expected of [
      "ComposerContract",
      "ApprovalCardModel",
      "ComposerModelPick",
      "AssistantTheme",
    ]) {
      expect(names.has(expected), `${expected} not demanded by the walk`).toBe(
        true,
      );
    }
  });

  it("no demanded type is unnameable: exported or ledgered opaque, never neither", () => {
    const offenders = [...required.entries()]
      .filter(([symbol]) => !provided.has(symbol) && !OPAQUE.has(symbol.name))
      .map(([symbol, context]) => `${symbol.name} (via ${context})`)
      .sort();
    expect(offenders).toEqual([]);
  });

  it("the opaque ledger only shrinks: every row is still demanded, and none is also exported", () => {
    const demandedNames = new Set(
      [...required.keys()].map((symbol) => symbol.name),
    );
    const providedNames = new Set(
      [...provided.keys()].map((symbol) => symbol.name),
    );
    for (const name of OPAQUE.keys()) {
      expect(demandedNames.has(name), `${name} — stale opaque row`).toBe(true);
      expect(providedNames.has(name), `${name} — opaque AND exported`).toBe(
        false,
      );
    }
  });
});
