// The tool-view contract (tool-views.md): one view per tool call, resolved
// once over four rungs, mounted once in the row's body for the call's whole
// lifecycle. A view is a presentation of a tool call, not an approval
// mechanism — it receives the call and nothing else. The imperative adapter
// is canonical; the React registry is sugar over the same lifecycle: one
// contract, two spellings, never two systems. Runtime-React-free by design.

import { actionToolView } from "../components/tool-views/action-view.js";
import { commandToolView } from "../components/tool-views/command-view.js";
import { docsSearchToolView } from "../components/tool-views/docs-search-view.js";
import { fileEditToolView } from "../components/tool-views/file-edit-view.js";
import { questionsToolView } from "../components/tool-views/questions-view.js";
import type { ToolCallState } from "./tool-call-display.js";

/** The resolved palette a view renders under — "light" | "dark", never the
 *  authored "auto" (use-resolved-theme-mode.ts resolves it). */
export type ToolViewThemeMode = "light" | "dark";

/** A JSON Schema document, verbatim from the wire: the catalog row's
 *  declared shape, untyped by design — data a view may read, never validated. */
export type JsonSchema = Record<string, unknown>;

/** The recorded tool call a view presents — the contract's entire data
 *  surface. The generics default to today's untyped behaviour so generated
 *  per-org argument types are usable when they arrive. */
export interface ToolViewCall<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  toolName: string;
  toolCallId: string;
  status: ToolCallState;
  /** True while a pending approval or elicitation anchored to this call
   *  awaits the member. The view may say so; it can never decide. */
  awaitingDecision: boolean;
  /** The streamed arguments, parsed, minus the protocol-reserved `caption`
   *  — the row's label, never an argument. `{}` while the argument text is
   *  still arriving or is not a JSON record. */
  args: TArgs;
  /** The result parsed for presentation: the tool-result/v1 envelope
   *  unwrapped (core/tool-result-envelope.ts), other JSON passed through.
   *  Absent until it lands, when not JSON, or when `truncated`. */
  result?: TResult;
  /** The result verbatim from the wire; absent until it lands (and
   *  withheld upstream on errored, denied, cancelled, refused and
   *  offloaded calls, exactly as the technical panes withhold it). */
  resultText?: string;
  /** True when the wire's result was degraded to fit the size cap: the
   *  bytes in `resultText` are honest; `result` refuses to structure them. */
  truncated?: boolean;
  /** True when the wire's result was the context offloader's
   *  model-facing replacement, not the tool's output. */
  offloaded?: boolean;
  errorText?: string;
  refusalText?: string;
  /** The tool's registered argument schema, when the wire carried one (the
   *  `approval_requested` marker or `tool_call_annotated`). Absent
   *  is a legitimate answer — `undefined`, never `{}`, never inferred — and
   *  a view must degrade, never demand. The runtime door beside `TArgs`. */
  argsSchema?: JsonSchema;
  /** The tool's registered success-result schema (`tool_output_schema`)
   *  — same channels and absence semantics as `argsSchema`. */
  resultSchema?: JsonSchema;
}

/** What a view receives — the call, and the one ambient fact it may not
 *  resolve itself. Additively extensible: a future `actions` member is a
 *  recorded reserved step (tool-views.md), never this contract's. */
export interface ToolViewProps<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  call: ToolViewCall<TArgs, TResult>;
  context: { themeMode: ToolViewThemeMode };
}

/** A mounted view. `update` MUST apply new props in place, so local UI
 *  state survives the call's status advancing; `destroy` runs on unmount. */
export interface ToolViewInstance<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  update(props: ToolViewProps<TArgs, TResult>): void;
  destroy(): void;
}

/** The canonical authoring form: an imperative mount into a package-owned
 *  container. A throw from `mount` or `update` is the adapter's one failure
 *  channel — the slot reports it and resolution falls to the rung below.
 *  `mount`/`update` are METHOD declarations on purpose: bivariant parameters
 *  let a typed adapter assign into the default-typed registration slot
 *  (docs/tool-call-contract.md, "Adapter typing" — use `type` aliases). */
export interface ToolViewAdapter<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  mount(
    container: HTMLElement,
    props: ToolViewProps<TArgs, TResult>,
  ): ToolViewInstance<TArgs, TResult>;
}

/** The operation-mark role: the identical lifecycle over identical props,
 *  named apart so the roles can diverge additively (tool-view-slot.tsx). */
export interface IconAdapter<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  mount(
    container: HTMLElement,
    props: ToolViewProps<TArgs, TResult>,
  ): ToolViewInstance<TArgs, TResult>;
}

/** One registration, two roles: a view, an icon, or both. `version` is the
 *  contract version the adapters target; a wire ref resolves only on exact
 *  match (rungs 1 and 3). Default-typed slots: registries are heterogeneous. */
export interface ToolViewRegistration {
  version: number;
  view?: ToolViewAdapter;
  icon?: IconAdapter;
}

/** The registry a trusted host supplies (`toolViews` on the provider or the
 *  script-tag elements), keyed by the wire key a backend annotation names
 *  (rung 1) or the host's exact tool name (rung 2). No code rides the wire. */
export type ToolViewRegistry = Readonly<Record<string, ToolViewRegistration>>;

/** The reserved namespace for package-shipped views (rung 3). */
const RESERVED_TOOL_VIEW_KEY_PREFIX = "teaflask.";

/** True for keys the package owns. A reserved key never resolves through
 *  the HOST registry — by wire key or tool name — so tool output can never
 *  name a privileged view and a host cannot occupy the namespace. */
export function isReservedToolViewKey(key: string): boolean {
  return key.startsWith(RESERVED_TOOL_VIEW_KEY_PREFIX);
}

/** Rung 3 — the package's own views under reserved `teaflask.*` keys, as
 *  vanilla adapters (runtime-React-free); the backend names them beside the
 *  tools in tool_call_display.py. Frozen: nothing registers here at runtime. */
export const PACKAGE_TOOL_VIEWS: ToolViewRegistry = Object.freeze({
  "teaflask.questions": { version: 1, view: questionsToolView },
  "teaflask.action": { version: 1, view: actionToolView },
  "teaflask.command": { version: 1, view: commandToolView },
  "teaflask.file-edit": { version: 1, view: fileEditToolView },
  "teaflask.docs-search": { version: 1, view: docsSearchToolView },
});

/** The tool name a granted catalog action mounts as
 *  (the serving side's action_tool_name): the slug shown on the
 *  Actions page, under the `action__` prefix — the one spelling a HOST
 *  gets. The dashboard's agent-config twin (draft-writers.ts, kept apart
 *  by the import law) is pinned equal to this and the backend constant by
 *  the dashboard's action-tool-prefix test. */
export function actionToolName(slug: string): string {
  return `action__${slug}`;
}

/** A registry written in action SLUGS — the names the Actions page shows
 *  — keyed for rung 2 by the tool name each slug mounts as. A registry
 *  of ordinary tool names composes beside it with a spread. */
export function actionToolViews(
  bySlug: Readonly<Record<string, ToolViewRegistration>>,
): ToolViewRegistry {
  const registry: Record<string, ToolViewRegistration> = {};
  for (const [slug, registration] of Object.entries(bySlug)) {
    registry[actionToolName(slug)] = registration;
  }
  return registry;
}

/** A statically resolved view candidate: which rung answered, under
 *  which key, with which adapter. */
export interface ResolvedToolView {
  rung: 1 | 2 | 3;
  key: string;
  adapter: ToolViewAdapter;
}

export interface ResolvedToolViewIcon {
  rung: 1 | 2 | 3;
  key: string;
  adapter: IconAdapter;
}

/** The presenter's tool-view slot: the rung 1–3 candidates in ladder order,
 *  per role, plus the lazily assembled call (tool-call-presentation.ts).
 *  Rung 4 — the package default — is the definitional terminal, never a
 *  list member: exhausting `views` IS the resolution "package default". */
export interface ToolViewResolution {
  views: readonly ResolvedToolView[];
  icons: readonly ResolvedToolViewIcon[];
  call: ToolViewCall;
}

/** The four-rung resolution ladder (docs/tool-call-contract.md, "The
 *  resolution ladder"), static half: host registry by exact `{key,
 *  version}` (1), host registry by exact tool name (2), package built-ins
 *  by reserved `teaflask.*` key (3); rung 4 is the definitional default.
 *  Own-property-guarded lookups; reserved keys refused at both host rungs. */
export function resolvedToolViewsOf(
  ref: { key: string; version: number } | undefined,
  toolName: string,
  registry: ToolViewRegistry | undefined,
  builtIns: ToolViewRegistry = PACKAGE_TOOL_VIEWS,
): {
  views: readonly ResolvedToolView[];
  icons: readonly ResolvedToolViewIcon[];
} {
  const candidates: {
    rung: 1 | 2 | 3;
    key: string;
    registration: ToolViewRegistration;
  }[] = [];
  if (ref !== undefined && !isReservedToolViewKey(ref.key)) {
    const registration = _ownRegistrationOf(registry, ref.key);
    if (registration !== undefined) {
      if (registration.version === ref.version) {
        candidates.push({ rung: 1, key: ref.key, registration });
      }
    }
  }
  if (!isReservedToolViewKey(toolName)) {
    const registration = _ownRegistrationOf(registry, toolName);
    if (registration !== undefined) {
      candidates.push({ rung: 2, key: toolName, registration });
    }
  }
  if (ref !== undefined && isReservedToolViewKey(ref.key)) {
    const registration = _ownRegistrationOf(builtIns, ref.key);
    if (registration !== undefined) {
      if (registration.version === ref.version) {
        candidates.push({ rung: 3, key: ref.key, registration });
      }
    }
  }
  const views: ResolvedToolView[] = [];
  const icons: ResolvedToolViewIcon[] = [];
  for (const { rung, key, registration } of candidates) {
    if (registration.view !== undefined) {
      views.push({ rung, key, adapter: registration.view });
    }
    if (registration.icon !== undefined) {
      icons.push({ rung, key, adapter: registration.icon });
    }
  }
  return { views, icons };
}

function _ownRegistrationOf(
  registry: ToolViewRegistry | undefined,
  key: string,
): ToolViewRegistration | undefined {
  if (registry === undefined) {
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(registry, key)
    ? registry[key]
    : undefined;
}
