import { build, type Metafile, type OutputFile } from "esbuild";
import { describe, expect, it } from "vitest";

// The bundle-discipline law: a consumer that mounts only the provider +
// the activity feed (the ./activity subpath) must not pay for the
// transcript, CopilotKit, or their stylesheets. This asserts the actual
// BUNDLE — the metafile's resolved module graph and the emitted outputs
// — not import statements: a lint-style "the activity module doesn't
// write `import @copilotkit`" passes trivially and proves nothing about
// what ships.
//
// The law: the companion presence widget lives on the activity entry and
// its chat drawer rides a dynamic import, so the assertion is about the
// STATIC closure — the chunks a host pays for on page load, following
// only import-statement edges. The dynamic edge to the drawer body is
// asserted separately (the anti-vacuity control): it must exist, must be
// dynamic, and must be the only road to CopilotKit from this entry.

// Bundling the whole package (the root barrel drags in CopilotKit) is
// real work — seconds on a laptop, tens of seconds on the CI runner —
// so every test states this budget instead of trusting vitest's 5s
// default, and identical builds are shared below.
const BUNDLE_TEST_TIMEOUT_MS = 120_000;

interface BundleResult {
  metafile: Metafile;
  outputFiles: OutputFile[];
}

const _bundleCache = new Map<string, Promise<BundleResult>>();

function bundleOf(entry: string, minify: boolean): Promise<BundleResult> {
  const key = `${entry}#${String(minify)}`;
  const cached = _bundleCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const bundled = _buildBundle(entry, minify);
  _bundleCache.set(key, bundled);
  return bundled;
}

async function _buildBundle(
  entry: string,
  minify: boolean,
): Promise<BundleResult> {
  const result = await build({
    entryPoints: [new URL(`../${entry}`, import.meta.url).pathname],
    bundle: true,
    // Dynamic imports become their own chunks, exactly as a host bundler
    // splits them — without this the drawer body would be inlined and
    // the static/dynamic distinction under test would not exist.
    splitting: true,
    write: false,
    minify,
    metafile: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    outdir: "out",
    // react/react-dom are external, as a host resolves peers; everything
    // else (ag-ui, rxjs, and — if reachable — CopilotKit) bundles, so a
    // leaked transcript import cannot hide behind an external. That
    // includes use-stick-to-bottom, a peer: it IS transcript machinery,
    // and externalizing it would hide exactly the leaks this closure
    // exists to catch. Fonts load as empty so a leaked stylesheet fails
    // on OUR assertions, not a loader error.
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    loader: { ".woff": "empty", ".woff2": "empty", ".ttf": "empty" },
    logLevel: "silent",
  });
  return { metafile: result.metafile, outputFiles: result.outputFiles };
}

/** The output chunks reachable from the entry over STATIC edges only —
 *  what a host pays for before anything is clicked. */
function staticClosureOf(metafile: Metafile, entry: string): string[] {
  const entryKey = Object.keys(metafile.outputs).find((key) =>
    metafile.outputs[key].entryPoint?.endsWith(entry),
  );
  if (entryKey === undefined) {
    throw new Error(`No output chunk claims the entry ${entry}.`);
  }
  const visited = new Set<string>([entryKey]);
  const queue = [entryKey];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) {
      break;
    }
    for (const edge of metafile.outputs[key].imports) {
      if (edge.kind !== "import-statement" && edge.kind !== "require-call") {
        continue;
      }
      if (!visited.has(edge.path) && edge.path in metafile.outputs) {
        visited.add(edge.path);
        queue.push(edge.path);
      }
    }
  }
  return [...visited];
}

function modulesInChunks(metafile: Metafile, chunkKeys: string[]): string[] {
  return chunkKeys.flatMap((key) => Object.keys(metafile.outputs[key].inputs));
}

function dynamicEdgesFrom(metafile: Metafile, chunkKeys: string[]): string[] {
  return chunkKeys.flatMap((key) =>
    metafile.outputs[key].imports
      .filter((edge) => edge.kind === "dynamic-import")
      .map((edge) => edge.path),
  );
}

// The transcript's heavy closure, post-chassis: the owned renderer stack
// (react-markdown and friends, the lazy-gated shiki door, the scroll
// machinery, the icon set) plus the transcript module itself. The
// minimized companion must never ship any of it statically.
const REACHES_TRANSCRIPT = (module: string) =>
  module.includes("react-markdown") ||
  module.includes("node_modules/marked/") ||
  module.includes("node_modules/shiki") ||
  module.includes("use-stick-to-bottom") ||
  module.includes("lucide-react") ||
  module.includes("src/components/transcript");

describe("the activity-only bundle (@teaflask/assistant/activity)", () => {
  it(
    "statically ships no transcript module, no CopilotKit, and no stylesheet",
    async () => {
      const { metafile } = await bundleOf("src/activity.ts", false);

      const closure = staticClosureOf(metafile, "src/activity.ts");
      const modules = modulesInChunks(metafile, closure);
      expect(modules.filter(REACHES_TRANSCRIPT)).toEqual([]);
      // CopilotKit's chat pulls katex CSS as a side effect, so the
      // stylesheet law is asserted at the module level: no module in the
      // static closure may import a stylesheet. (The chunk-level cssBundle
      // is no signal here — esbuild cannot load CSS lazily, so it hoists
      // even a DYNAMIC chunk's CSS into the entry's css file; bundlers
      // that split CSS load the drawer's styles with the drawer.)
      const cssImports = modules.flatMap((module) =>
        metafile.inputs[module].imports
          .map((edge) => edge.path)
          .filter((path) => path.endsWith(".css")),
      );
      expect(cssImports).toEqual([]);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );

  it(
    "reaches the transcript ONLY over the drawer's dynamic edge — the walk is not vacuous",
    async () => {
      const { metafile } = await bundleOf("src/activity.ts", false);

      const closure = staticClosureOf(metafile, "src/activity.ts");
      const dynamicTargets = dynamicEdgesFrom(metafile, closure);
      expect(dynamicTargets.length).toBeGreaterThan(0);

      // The drawer body's own (static) closure is where CopilotKit lives:
      // proves both that the chunk genuinely ships the transcript and that
      // the static walk above had something real to exclude. If someone
      // makes the drawer import static, the closure test goes red; if the
      // dynamic edge disappears entirely, this one does.
      const reachable = new Set(
        dynamicTargets.flatMap((target) => {
          const visited = new Set<string>([target]);
          const queue = [target];
          while (queue.length > 0) {
            const key = queue.shift();
            if (key === undefined) {
              break;
            }
            for (const edge of metafile.outputs[key].imports) {
              if (
                edge.kind !== "dynamic-import" &&
                !visited.has(edge.path) &&
                edge.path in metafile.outputs
              ) {
                visited.add(edge.path);
                queue.push(edge.path);
              }
            }
          }
          return [...visited];
        }),
      );
      expect(
        modulesInChunks(metafile, [...reachable]).some(REACHES_TRANSCRIPT),
      ).toBe(true);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );

  it(
    "is measurably small — the number the bundle-weight budget is set against",
    async () => {
      const { metafile, outputFiles } = await bundleOf("src/activity.ts", true);

      // Only the static closure counts: the drawer chunk downloads on the
      // first expand, never on page load.
      // Metafile keys are outdir-relative ("out/activity.js"); outputFiles
      // carry absolute paths — suffix-match the two.
      const closure = staticClosureOf(metafile, "src/activity.ts");
      const bytes = outputFiles
        .filter((file) => closure.some((key) => file.path.endsWith(key)))
        .reduce((total, file) => total + file.contents.byteLength, 0);

      // Not a performance budget — a tripwire. Crossing it means something
      // transcript-sized leaked through the seam even if no module path
      // matched above. The line sits ~21 KB over the closure measured with
      // the AG-UI 1.0 chassis (whose client carries zod's v4 locale table
      // and the proto codec — the ledger is the AG-UI 1.0 migration
      // record); a transcript-sized leak is tens of kilobytes, so the
      // tripwire still catches it.
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThan(680_000);

      console.info(
        `activity-only static closure: ${String(bytes)} bytes minified (react external, deps bundled)`,
      );
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );

  it(
    "control: the root barrel DOES reach the renderer stack statically — the assertion mechanism is alive",
    async () => {
      const { metafile } = await bundleOf("src/index.ts", false);

      // If this ever fails, the graph walk went vacuous (or the transcript
      // left the root entry) — fix the test, do not delete the control.
      const closure = staticClosureOf(metafile, "src/index.ts");
      expect(
        modulesInChunks(metafile, closure).some((module) =>
          module.includes("react-markdown"),
        ),
      ).toBe(true);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );
});

// The ./headless entry's declared law: "bindings, never the machinery —
// none of the package chrome". The hooks ride the provider and the
// store (which IS in this closure — a live-session entry), but no
// chrome component may enter it: a host that brings its own frontend
// must not pay for ours, and a chrome module appearing here would mean
// the contexts drifted back into the chrome. No byte budget — the entry
// deliberately carries the store and transport.
describe("the headless bundle (@teaflask/assistant/headless)", () => {
  it(
    "statically ships the provider and store but none of the package chrome",
    async () => {
      const { metafile } = await bundleOf("src/headless.ts", false);
      const closure = staticClosureOf(metafile, "src/headless.ts");
      const modules = modulesInChunks(metafile, closure);

      // Anti-vacuity: the entry genuinely bundles the live session.
      expect(
        modules.some((module) =>
          module.includes("src/components/teaflask-assistant-provider"),
        ),
      ).toBe(true);
      expect(
        modules.some((module) =>
          module.includes("src/core/conversation-store"),
        ),
      ).toBe(true);

      // The chrome stays out — the surfaces a host replaces when it
      // brings its own frontend.
      const CHROME = [
        "src/components/message-list",
        "src/components/tool-row",
        "src/components/composer.",
        "src/components/transcript.",
        "src/components/conversation-view",
        "src/components/assistant-page",
        "src/components/assistant-palette",
      ];
      expect(
        modules.filter((module) =>
          CHROME.some((chrome) => module.includes(chrome)),
        ),
      ).toEqual([]);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );
});

// The ./transcript entry's declared law: the entry header and the
// README's subpath section both promise "React-free and transport-free
// by construction" — public prose a host may rely on, and load-bearing
// enough that humanFileSize was lifted out of a .tsx to keep it true.
// Neither ./markdown nor ./scroll carries a closure guard, but neither
// declares such a property; a declared law gets a mechanical guard, like
// the activity closure above.
describe("the transcript projection bundle (@teaflask/assistant/transcript)", () => {
  it(
    // What ships, not what's written: a side-effect-only import of a
    // sideEffects-free module tree-shakes to nothing and correctly does
    // not trip this — the controls that must go red are a USED re-export
    // of a React-bearing module and of a transport module (both proven
    // during review round 2).
    "statically ships no React edge and no transport module",
    async () => {
      const { metafile } = await bundleOf("src/transcript.ts", false);
      const closure = staticClosureOf(metafile, "src/transcript.ts");
      const modules = modulesInChunks(metafile, closure);

      // Anti-vacuity: the projection and its AG-UI seam really bundle in.
      expect(
        modules.some((module) => module.includes("src/core/transcript-rows")),
      ).toBe(true);
      expect(modules.some((module) => module.includes("@ag-ui/client"))).toBe(
        true,
      );

      // Transport-free: MarkerAnchorsSnapshot rides type-only, so no
      // transport module may appear in the resolved graph.
      expect(
        modules.filter((module) => module.includes("src/transport/")),
      ).toEqual([]);

      // React-free: react/react-dom are external in this build, so a
      // dependency would surface as an import EDGE on a bundled module,
      // never as a bundled module itself — scan the edges.
      const reactEdges = modules.flatMap((module) =>
        metafile.inputs[module].imports
          .filter((edge) => /^react(-dom)?(\/|$)/.test(edge.path))
          .map((edge) => `${module} -> ${edge.path}`),
      );
      expect(reactEdges).toEqual([]);
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );
});

// The PARSE-GRAPH closure: every module the entry's import statements
// reach, walked over metafile.inputs' edges from the entry, static
// edges only (dynamic-import edges excluded; externals traverse
// nothing — they have no inputs entry, so React is asserted on EDGES
// where it appears, exactly the sibling law's recorded reason).
function parseGraphClosureOf(metafile: Metafile, entry: string): string[] {
  const entryKey = Object.keys(metafile.inputs).find(
    (module) => module === entry || module.endsWith(`/${entry}`),
  );
  if (entryKey === undefined) {
    throw new Error(`entry ${entry} is not in the metafile`);
  }
  const seen = new Set<string>();
  const queue = [entryKey];
  while (queue.length > 0) {
    const module = queue.pop();
    if (module === undefined || seen.has(module)) {
      continue;
    }
    seen.add(module);
    for (const edge of metafile.inputs[module].imports) {
      if (edge.kind === "dynamic-import" || edge.external === true) {
        continue;
      }
      queue.push(edge.path);
    }
  }
  return [...seen];
}

describe("the ./transcript projection entry stays a leaf (the prose law over the PARSE GRAPH)", () => {
  // Two laws for one entry, deliberately, because they measure
  // different things (verified in the round-4/5 review, not assumed):
  // the sibling law above pins the SHIPPED BYTES — the tree-shaken
  // chunks — and it stayed green while this entry's parse graph reached
  // src/transport/* through an unused-at-runtime kinds import
  // (tree-shaking dropped the bytes, so no chunk-level assertion could
  // fire). "Transport-free BY CONSTRUCTION" (transcript.ts) is a
  // dependency-graph law: an import that happens to tree-shake away is
  // still a dependency — one side effect or non-shakeable use away from
  // shipping — so this law pins the parse graph. Classes, not counts:
  // counts churn with honest growth; the transport layer, the DOM
  // reader subtree, the affordances and React must never be reachable.
  it(
    "the parse graph reaches no transport, reader or affordance module, and imports no React",
    async () => {
      const { metafile } = await bundleOf("src/transcript.ts", false);
      const closure = parseGraphClosureOf(metafile, "src/transcript.ts");
      const offenders = closure.filter(
        (module) =>
          module.includes("src/transport/") ||
          module.includes("src/reader/") ||
          module.includes("src/affordances/"),
      );
      expect(offenders).toEqual([]);
      // React is external in this build, so it never appears as an
      // input — assert the EDGES of every closure module instead (the
      // sibling law's own recorded mechanism; a bare inputs-key scan
      // for react is vacuous by construction).
      const reactEdges = closure.flatMap((module) =>
        metafile.inputs[module].imports
          .filter((edge) => /^react(-dom)?(\/|$)/.test(edge.path))
          .map((edge) => `${module} -> ${edge.path}`),
      );
      expect(reactEdges).toEqual([]);
      // Anti-vacuity: the walk genuinely covered the projection — the
      // row derivation, the newest anchor family, and the kinds leaf
      // the round-4 fix introduced are all in the parse graph.
      for (const expected of [
        "src/core/transcript-rows",
        "src/core/tool-decision-anchors",
        "src/core/tool-denial-anchors",
        "src/core/execution-kinds",
        "src/core/pending-decision-gap",
      ]) {
        expect(
          closure.some((module) => module.includes(expected)),
          expected,
        ).toBe(true);
      }
    },
    BUNDLE_TEST_TIMEOUT_MS,
  );
});
