// The ref-admitting type surface. React 19 passes `ref` to a function
// component as a plain prop; React 18.3 — which the peer range admits —
// strips it silently. So any props type that ADMITS a ref without
// forwardRef behind it type-checks a call that no-ops on half the peer
// range (or worse: rides a spread and clobbers an internal ref under
// 19). The call-site census that drove the forwardRef conversions could
// not find latent sites by construction; this test sweeps the TYPE
// surface instead and holds it.
//
// The enumeration, committed (every way a props type can admit a ref):
//
// | Shape                                   | Verdict                    |
// |-----------------------------------------|----------------------------|
// | TeaflaskAssistant, TfButton, TfTextarea,| forwardRef — ref admitted  |
// |   TfFileInput                           | and forwarded on both lines|
// | TfInput, Kbd (ComponentProps<"…">)      | fixed: WithoutRef — ref is |
// |                                         | now a compile error        |
// | HeaderDisclosureTrigger                 | fixed: Omit strips "ref";  |
// |   (ComponentProps<typeof TfButton>)     | triggerRef is the channel  |
// | Every other exported component          | provably unreachable: props|
// |                                         | are hand-written literals  |
// |   or extend the *HTMLAttributes families, and @types/react defines |
// |   those WITHOUT ref — passing one is a type error, not a caller    |
// |   habit. RefAttributes appears nowhere in src.                     |
//
// Rules enforced below, so the premise outlives this diff:
//   R1  ComponentPropsWithRef is banned in src.
//   R2  ComponentProps<"intrinsic"> is banned in src — it carries the
//       element's ref into the props type. Use ComponentPropsWithoutRef.
//   R3  ComponentProps<typeof X> is legal only directly inside an
//       Omit<…> that strips "ref", and every such site is allowlisted.
//   R4  No props member named `ref` with a React ref type — forwardRef
//       is the one sanctioned ref channel.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

// R3's allowlist: ComponentProps<typeof …> sites proven to strip "ref".
const SANCTIONED_TYPEOF_SITES = ["companion-header-disclosure.tsx"];

const REACT_REF_TYPE = /\b(?:Ref|RefObject|RefCallback|LegacyRef)</;

interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function moduleFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...moduleFiles(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files.sort();
}

function sweep(): { violations: Violation[]; typeofSites: string[] } {
  const violations: Violation[] = [];
  const typeofSites: string[] = [];

  for (const file of moduleFiles(SRC_DIR)) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const shortName = file.slice(SRC_DIR.length + 1);
    const flag = (node: ts.Node, rule: string) => {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      violations.push({
        file: shortName,
        line: line + 1,
        rule,
        text: node.getText(sourceFile).slice(0, 80),
      });
    };

    const visit = (node: ts.Node) => {
      if (ts.isTypeReferenceNode(node)) {
        const name = node.typeName.getText(sourceFile);
        if (name === "ComponentPropsWithRef") {
          flag(node, "R1: ComponentPropsWithRef admits a ref");
        } else if (name === "ComponentProps") {
          const firstArg = node.typeArguments?.[0];
          if (firstArg !== undefined && ts.isLiteralTypeNode(firstArg)) {
            flag(
              node,
              "R2: ComponentProps<intrinsic> admits the element's ref — use ComponentPropsWithoutRef",
            );
          } else if (firstArg !== undefined && ts.isTypeQueryNode(firstArg)) {
            const parent = node.parent;
            const strippedKeys =
              ts.isTypeReferenceNode(parent) &&
              parent.typeName.getText(sourceFile) === "Omit" &&
              parent.typeArguments !== undefined &&
              parent.typeArguments.length > 1
                ? parent.typeArguments[1].getText(sourceFile)
                : undefined;
            if (strippedKeys?.includes('"ref"') === true) {
              typeofSites.push(shortName);
            } else {
              flag(
                node,
                'R3: ComponentProps<typeof …> must sit in an Omit that strips "ref"',
              );
            }
          }
        }
      }
      if (
        ts.isPropertySignature(node) &&
        node.name.getText(sourceFile) === "ref" &&
        node.type !== undefined &&
        REACT_REF_TYPE.test(node.type.getText(sourceFile))
      ) {
        flag(
          node,
          "R4: a ref-typed props member — forwardRef is the sanctioned channel",
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { violations, typeofSites };
}

describe("the ref-admitting type surface of src/", () => {
  const { violations, typeofSites } = sweep();

  it("admits a ref only through forwardRef or a sanctioned Omit", () => {
    expect(
      violations.map(
        (v) => `${v.file}:${String(v.line)} ${v.rule} — ${v.text}`,
      ),
    ).toEqual([]);
  });

  it("keeps the sanctioned ComponentProps<typeof …> sites enumerated", () => {
    expect(typeofSites.map((s) => s.split("/").pop()).sort()).toEqual(
      [...SANCTIONED_TYPEOF_SITES].sort(),
    );
  });
});
