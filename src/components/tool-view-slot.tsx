"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type {
  IconAdapter,
  ResolvedToolView,
  ResolvedToolViewIcon,
  ToolViewAdapter,
  ToolViewCall,
  ToolViewInstance,
  ToolViewProps,
} from "../core/tool-view.js";
import type { ToolCallIcon } from "../core/tool-call-presentation.js";
import { OperationGlyph, OperationMarkFrame } from "./operation-icons.js";
import { TOOL_VIEW_LATE_FAILURE_EVENT } from "./react-tool-view.js";
import { useOptionalAssistantSession } from "./teaflask-assistant-provider.js";
import { DefaultToolView } from "./tool-arguments-summary.js";
import { useLatestRef } from "./use-latest-ref.js";
import { useResolvedThemeMode } from "./use-resolved-theme-mode.js";

// The tool-view mount slot: the runtime half of the resolution ladder.
// The presenter resolved the static candidates (rungs 1–3); this slot
// mounts the first, delivers prop changes through `update` IN PLACE
// (never a remount — a view's local UI state must survive a status
// advance), and on a mount/update throw advances to the rung below —
// monotonic, so a flaky adapter never flickers back in. Exhausting the
// candidates lands on rung 4, the package default view, the slot's own
// terminal (the row has no override).
//
// Composition law: everything inside the mount container belongs to the
// adapter; nothing package-owned lives there. The row's error, refusal
// and offloaded lines (tool-row.tsx) render OUTSIDE this slot, so neither
// a hostile adapter nor a throw can remove them.

/** The row-body slot: the mounted candidate's container, or the rung-4
 *  terminal. It adds no heading of its own — a view titles itself (the
 *  package parts carry the card title), so nothing here can claim a
 *  result that a request-shaped view does not show. */
export function ToolViewSlot({
  views,
  call,
}: {
  views: readonly ResolvedToolView[];
  call: ToolViewCall;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const themeMode = useResolvedThemeMode(slotRef);
  const props: ToolViewProps = { call, context: { themeMode } };
  const active = useMountedAdapter(views, props, mountRef);
  return (
    <div ref={slotRef} data-tf-tool-view={active?.key ?? ""}>
      {active !== undefined ? (
        // data-tf-host-view marks the HOST's subtree: the sheet's
        // border/box reset excludes everything under it, so a host
        // utility on the view's own elements wins — the widget must not
        // out-cascade its documented extension point. The row body's
        // compact register rides the mount node, so a host view inherits
        // the transcript's size and leading by setting nothing of its own
        // (the inherit-don't-specify law).
        <div ref={mountRef} data-tf-host-view="" className="tf:text-xs" />
      ) : (
        <DefaultToolView call={call} context={{ themeMode }} />
      )}
    </div>
  );
}

/** The operation-mark slot: a registered icon replaces the mark's GLYPH
 *  and nothing else — the mark's identity, state attribute, ink rules
 *  and assistive state word stay package-owned (OperationMarkFrame),
 *  outside anything an adapter can reach. The terminal is the package
 *  glyph for the resolved icon token. */
export function ToolViewIconSlot({
  icons,
  call,
  icon,
}: {
  icons: readonly ResolvedToolViewIcon[];
  call: ToolViewCall;
  icon: ToolCallIcon;
}) {
  const mountRef = useRef<HTMLSpanElement | null>(null);
  const themeMode = useResolvedThemeMode(mountRef);
  const props: ToolViewProps = { call, context: { themeMode } };
  const active = useMountedAdapter(icons, props, mountRef);
  return (
    <OperationMarkFrame status={call.status}>
      {active !== undefined ? (
        // aria-hidden like every package glyph (OperationGlyph): the
        // mark's assistive content is the frame's sr-only state word,
        // package-owned — an icon adapter mounting text or a titled SVG
        // must not join the row summary's accessible name beside it.
        <span
          ref={mountRef}
          aria-hidden
          data-tf-host-view=""
          data-tf-tool-view-icon={active.key}
        />
      ) : (
        <OperationGlyph icon={icon} />
      )}
    </OperationMarkFrame>
  );
}

/**
 * The shared adapter lifecycle: mount once, update in place, destroy on
 * unmount, advance on failure. Effects key on the ADAPTER's identity
 * (registrations live at module scope by contract), never on the
 * candidate wrapper the presenter rebuilds per render. Failures are
 * tracked by adapter identity, never by position, and the failed set only
 * grows within a mount. The failure census and the resolution-change
 * census: docs/transcript-surfaces.md, "The tool-view mount slot".
 */
function useMountedAdapter<
  Candidate extends ResolvedToolView | ResolvedToolViewIcon,
>(
  candidates: readonly Candidate[],
  props: ToolViewProps,
  nodeRef: RefObject<HTMLElement | null>,
): Candidate | undefined {
  const [failedAdapters, setFailedAdapters] =
    useState<ReadonlySet<Candidate["adapter"]>>(EMPTY_FAILED);
  const active = candidates.find(
    (candidate) => !failedAdapters.has(candidate.adapter),
  );
  const adapter = active?.adapter;
  // Tolerant on purpose: fixture and bare test mounts have no session;
  // failures then reach only the console, while a real embed's land on
  // the host's onError — observable to developers, no stack traces
  // shown to end users.
  const session = useOptionalAssistantSession();
  const reportErrorRef = useLatestRef(session?.reportError);
  // The key NAMES the failing view in reports; it must never be an
  // ADVANCE signal. One adapter registered under two keys (the README's
  // own double-registration shape) re-resolves from rung 2 to rung 1
  // when the wire ref lands late — same adapter, new key — and a key
  // dependency on useAdapterMount would destroy and remount the view,
  // discarding exactly the local UI state that update-in-place exists
  // to preserve. It rides the mount record instead, written at commit
  // time, so reports name the currently-resolved key.
  const heldRef = useRef<AdapterMount>({
    instance: null,
    deliveredProps: null,
    props,
    key: active?.key,
  });

  // ONE report-clear-advance path for every failure phase in the
  // FAILURE CENSUS: report to the host, clear the failed adapter's
  // debris, drop the mounted instance, and skip the adapter everywhere
  // it resolves. The WeakSet dedupes per adapter object — a late event
  // and a straggling stale throw must not double-report. What keeps a
  // failed adapter from being reached twice is the INSTANCE DROP here:
  // two commits can queue two deliveries while the instance is still
  // live (flushSync ×2 before any drain), and the first delivery's
  // catch nulls the instance, so the second returns at its null check.
  // The failure state applying before any later commit — whose cleanup
  // also nulls the mount — is the belt on top, not the load-bearing
  // guard.
  const reportedFailuresRef = useRef(new WeakSet());
  const advancePast = useCallback(
    (failedAdapter: MountableAdapter, error: unknown) => {
      if (reportedFailuresRef.current.has(failedAdapter)) {
        return;
      }
      reportedFailuresRef.current.add(failedAdapter);
      _reportThrow(heldRef.current.key ?? "", error, reportErrorRef.current);
      nodeRef.current?.replaceChildren();
      heldRef.current.instance = null;
      heldRef.current.deliveredProps = null;
      setFailedAdapters((previous) => {
        if (previous.has(failedAdapter)) {
          return previous;
        }
        const next = new Set(previous);
        next.add(failedAdapter);
        return next;
      });
    },
    [nodeRef, reportErrorRef],
  );

  useAdapterMount(adapter, nodeRef, heldRef, advancePast);
  useAdapterDelivery(adapter, active?.key, props, heldRef, advancePast);
  return active;
}

type MountableAdapter = ToolViewAdapter | IconAdapter;

const EMPTY_FAILED: ReadonlySet<MountableAdapter> = new Set();

/** What one slot holds about its mounted adapter between commits: the
 *  live instance, the props last delivered to it, the newest committed
 *  props, and the key the adapter currently resolves under. Written at
 *  COMMIT time (the delivery effect), never during render: a discarded
 *  concurrent render attempt must not leak its props object here, or
 *  the staleness accounting drifts. */
interface AdapterMount {
  instance: ToolViewInstance | null;
  deliveredProps: ToolViewProps | null;
  props: ToolViewProps;
  key: string | undefined;
}

/** Mount and destroy, one adapter at a time. Every adapter call is
 *  deferred ONE microtask past the React commit: the React sugar's
 *  mount/update is a flushSync render into a nested root and its destroy
 *  is a root unmount, and React forbids both while its own commit is
 *  still on the stack (an effect or a cleanup). The microtask runs
 *  before the member can interact, and the relative order — destroy
 *  before the next mount — rides the queue's FIFO. */
function useAdapterMount(
  adapter: MountableAdapter | undefined,
  nodeRef: RefObject<HTMLElement | null>,
  heldRef: RefObject<AdapterMount>,
  advancePast: (adapter: MountableAdapter, error: unknown) => void,
): void {
  useEffect(() => {
    const node = nodeRef.current;
    // The record object is the slot's for its whole lifetime (only its
    // fields change), so the cleanup reads it directly.
    const held = heldRef.current;
    if (adapter === undefined || node === null) {
      return;
    }
    let cancelled = false;
    let instance: ToolViewInstance | null = null;
    // The React sugar's self-scheduled-render failure channel (failure
    // census case 5): dispatched on the mount container, the one object
    // the sugar and this slot share.
    const onLateFailure = (event: Event) => {
      advancePast(adapter, (event as CustomEvent).detail);
    };
    node.addEventListener(TOOL_VIEW_LATE_FAILURE_EVENT, onLateFailure);
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      try {
        instance = adapter.mount(node, held.props);
        held.instance = instance;
        held.deliveredProps = held.props;
      } catch (error) {
        advancePast(adapter, error);
      }
    });
    return () => {
      cancelled = true;
      node.removeEventListener(TOOL_VIEW_LATE_FAILURE_EVENT, onLateFailure);
      held.instance = null;
      held.deliveredProps = null;
      // Captured NOW, not at destroy time: cleanups run before the next
      // commit's create-phase effects, but the deferred destroy below
      // runs after them — by then the record already names the NEXT
      // resolution (or "" at the terminal), and the log would blame the
      // wrong view. This cleanup still tracks a re-key: the record holds
      // whatever key this adapter was last resolved under.
      const destroyedKey = held.key ?? "";
      queueMicrotask(() => {
        if (instance === null) {
          return;
        }
        try {
          instance.destroy();
        } catch (error) {
          console.error(
            `[teaflask-assistant] The tool view "${destroyedKey}" threw on destroy.`,
            error,
          );
        }
        node.replaceChildren();
      });
    };
    // Neither the cursor nor the KEY is in the deps, ON PURPOSE: the
    // adapter's identity is the ONLY advance signal. An advance always changes `adapter` by
    // construction (a failed adapter is skipped at every position it
    // occupies), and a key change with an unchanged adapter — the late
    // wire ref re-resolving one double-registered adapter from rung 2
    // to rung 1 — is a re-labelling, not a reason to destroy a mounted
    // view.
  }, [adapter, advancePast, heldRef, nodeRef]);
}

/** Every commit after the mount delivers the LATEST committed props
 *  through `update` — in place, never a remount. The delivery guard is
 *  STRUCTURAL: the presenter mints a fresh call per invocation and this
 *  slot a fresh props object per render, so an object-identity guard is
 *  dead by construction — it would suppress only the mount's own
 *  duplicate and hand every mounted view an update per streamed token
 *  (with the React sugar, a synchronous render into a nested root per
 *  token, on calls that already settled). */
function useAdapterDelivery(
  adapter: MountableAdapter | undefined,
  key: string | undefined,
  props: ToolViewProps,
  heldRef: RefObject<AdapterMount>,
  advancePast: (adapter: MountableAdapter, error: unknown) => void,
): void {
  useEffect(() => {
    const held = heldRef.current;
    held.props = props;
    held.key = key;
    if (adapter === undefined) {
      return;
    }
    queueMicrotask(() => {
      const instance = held.instance;
      if (instance === null) {
        return;
      }
      const latest = held.props;
      const delivered = held.deliveredProps;
      if (delivered !== null && _sameDelivery(delivered, latest)) {
        return;
      }
      held.deliveredProps = latest;
      try {
        instance.update(latest);
      } catch (error) {
        advancePast(adapter, error);
      }
    });
  });
}

/**
 * "Nothing a view can observe changed." The field set rests on three
 * premises — `result`/`truncated` derive from `resultText` (lazy
 * accessors over it, so the guard compares the source text and never
 * forces the structuring parse); `args` is identity-stable across
 * re-renders with unchanged source (the IDENTITY LAW); the schema refs
 * are identity-stable per source — each stated in
 * docs/transcript-surfaces.md, "The delivery guard's premises".
 */
function _sameDelivery(previous: ToolViewProps, next: ToolViewProps): boolean {
  const before = previous.call;
  const after = next.call;
  return (
    previous.context.themeMode === next.context.themeMode &&
    before.toolName === after.toolName &&
    before.toolCallId === after.toolCallId &&
    before.status === after.status &&
    before.awaitingDecision === after.awaitingDecision &&
    before.resultText === after.resultText &&
    before.offloaded === after.offloaded &&
    before.errorText === after.errorText &&
    before.refusalText === after.refusalText &&
    before.argsSchema === after.argsSchema &&
    before.resultSchema === after.resultSchema &&
    _shallowRecordEqual(before.args, after.args)
  );
}

function _shallowRecordEqual(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  if (before === after) {
    return true;
  }
  const keys = Object.keys(before);
  if (keys.length !== Object.keys(after).length) {
    return false;
  }
  for (const key of keys) {
    if (
      !Object.prototype.hasOwnProperty.call(after, key) ||
      before[key] !== after[key]
    ) {
      return false;
    }
  }
  return true;
}

function _reportThrow(
  key: string,
  error: unknown,
  reportError: ((error: Error) => void) | undefined,
): void {
  // The host's observer hears it, and the console names the view for
  // whoever is actually debugging the page.
  reportError?.(error instanceof Error ? error : new Error(String(error)));
  console.error(
    `[teaflask-assistant] The tool view "${key}" threw; the next resolution took over.`,
    error,
  );
}
