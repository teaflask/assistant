"use client";

// The React spelling of the tool-view contract: thin sugar over the
// imperative {mount → {update, destroy}} lifecycle — one contract, two
// spellings, never two systems (tool-views.md). The component renders
// into its own react-dom root inside the package-owned container;
// `update` re-renders the same element type, so React reconciles and
// component-local state survives a status advance; `destroy` unmounts.

import { Component, type ComponentType, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import type {
  ToolViewAdapter,
  ToolViewInstance,
  ToolViewProps,
} from "../core/tool-view.js";

/** Wrap a React component as a canonical tool-view adapter. Also the
 *  icon spelling — IconAdapter shares the lifecycle, so the same
 *  wrapper serves `{ version, icon: reactToolView(MyMark) }`. Generic
 *  like the adapter it produces: a component written against generated
 *  per-org argument types (`ToolViewProps<MyArgs>`) wraps without a
 *  cast, and the typed adapter assigns to the registration through
 *  method bivariance (core/tool-view.ts). */
export function reactToolView<
  TArgs = Record<string, unknown>,
  TResult = unknown,
>(
  component: ComponentType<ToolViewProps<TArgs, TResult>>,
): ToolViewAdapter<TArgs, TResult> {
  const View = component;
  return {
    mount(
      container: HTMLElement,
      props: ToolViewProps<TArgs, TResult>,
    ): ToolViewInstance<TArgs, TResult> {
      const root = createRoot(container);
      // PREMISE — which throw phases the latch can observe inside the
      // flushSync window, and which it cannot (settled empirically, r3):
      // render, layout-effect AND passive-effect throws belonging to a
      // renderInto flush all surface before flushSync returns — React
      // flushes the forced work's passive effects synchronously — so
      // renderInto rethrows them all: the adapter contract's one
      // failure channel. What no mount/update return can ever observe
      // is a throw from a render the view schedules for ITSELF — its
      // own setState from a timer, a promise, a subscription —
      // committed by the nested root with no renderInto in flight.
      // componentDidCatch then fires with the window closed, and the
      // failure travels the container's late-failure event instead —
      // the mount slot listens and advances the ladder, restoring the
      // replaced React boundary's any-phase fallback-and-report
      // behaviour across the imperative seam.
      let unmounted = false;
      const unmountLate = () => {
        if (!unmounted) {
          unmounted = true;
          // Asynchronously: react-dom forbids unmounting while its own
          // commit or effect flush is still on the stack.
          queueMicrotask(() => {
            root.unmount();
          });
        }
      };
      const latch: _FailureLatch = {
        inSyncWindow: false,
        failed: false,
        error: undefined,
        onLateFailure: (error) => {
          unmountLate();
          container.dispatchEvent(
            new CustomEvent(TOOL_VIEW_LATE_FAILURE_EVENT, { detail: error }),
          );
        },
      };
      const renderInto = (next: ToolViewProps<TArgs, TResult>) => {
        // Read through a local: componentDidCatch mutates the latch from
        // inside the flushSync call below, which control-flow narrowing
        // cannot see — narrowing the property itself would mis-read the
        // post-flush check as always-false.
        const alreadyFailed: boolean = latch.failed;
        if (alreadyFailed) {
          // Already failed and reported (sync throw or late event); the
          // slot never reuses a failed instance, so a straggling update
          // is a no-op rather than a stale re-throw and double report.
          return;
        }
        latch.inSyncWindow = true;
        try {
          flushSync(() => {
            root.render(
              <_CatchBoundary latch={latch}>
                <View {...next} />
              </_CatchBoundary>,
            );
          });
        } finally {
          latch.inSyncWindow = false;
        }
        if (latch.failed) {
          unmountLate();
          throw latch.error;
        }
      };
      renderInto(props);
      return {
        update: renderInto,
        destroy: () => {
          if (!unmounted) {
            unmounted = true;
            root.unmount();
          }
        },
      };
    },
  };
}

/** The package-internal late-failure channel between the React sugar
 *  and the mount slot: a passive-effect throw cannot surface as a
 *  synchronous mount/update throw, so the sugar dispatches it on the
 *  mount container — the one object both sides share — and the slot
 *  treats it exactly like a thrown adapter (report, clear, advance).
 *  Not part of the public adapter contract: a vanilla adapter's own
 *  async failures remain the adapter's to handle. */
export const TOOL_VIEW_LATE_FAILURE_EVENT = "teaflask-tool-view-late-failure";

interface _FailureLatch {
  inSyncWindow: boolean;
  failed: boolean;
  error: unknown;
  onLateFailure: (error: unknown) => void;
}

/** Records a child throw into the mount's latch. Inside the flushSync
 *  window the wrapper above rethrows on the adapter's stack; outside it
 *  (a passive-effect throw) the latch's late channel carries it.
 *  Latching — a component that threw never flickers back in on a later
 *  commit of the same root. */
class _CatchBoundary extends Component<
  { latch: _FailureLatch; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    const latch = this.props.latch;
    const alreadyFailed = latch.failed;
    latch.failed = true;
    latch.error = error;
    if (!latch.inSyncWindow && !alreadyFailed) {
      latch.onLateFailure(error);
    }
  }

  render() {
    if (this.state.failed) {
      return null;
    }
    return this.props.children;
  }
}
