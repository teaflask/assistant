// The Shadow DOM + CSP motion probe (TVC-102; artifact-loading,
// TVC-103). The page loads the BUILT script-tag artifact
// (/dist/element/assistant.js) and connects a keyless
// <teaflask-assistant>, so the artifact's own mount path runs for real:
// open shadow root, the baked rem→px constructed sheet adopted as the
// tree's only stylesheet, and the host-attribute reflection bridge that
// lets `[data-reduce-motion="true"] …` descendant selectors keep
// working across the boundary. This bench file no longer reconstructs
// any of that — it only renders the probe scene into the artifact's
// wrapper. `?reduce-motion` plants the kill switch on a LIGHT-DOM
// ancestor — outside the shadow root on purpose; the artifact's
// reflection is the thing under test. Deep source imports for the SCENE
// are the bench idiom (main.tsx's note applies here too); the shipped
// tree itself renders null without a publishable key, and driving it to
// a live spinner needs a serving-contract backend this static harness
// cannot provide (the shadow CSP artifact-proof record records that
// residual).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ChildTranscriptPreviewFrame } from "../../src/components/child-transcript";
import { ShimmerText, Spinner } from "../../src/components/streaming-states";
import { SubagentDelegationSurface } from "../../src/components/subagent-delegation-surface";
import {
  SubagentDispatchesContext,
  SubagentGroupRow,
} from "../../src/components/subagent-group-row";
import type { ThreadDispatch } from "../../src/contract/dispatches";

function mustFindHost(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`the probe page is missing #${id}`);
  }
  return element;
}

/** One paint frame. */
function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/** Two frames — the scenario pages' "paint has settled" idiom. */
async function twoFrames(): Promise<void> {
  await frame();
  await frame();
}

/** rAF-polls until `read` yields non-null. No timeout on purpose: the
 *  Playwright spec's own timeout is the failure mode, and a hang here
 *  (readiness never set) is a red test, never a silent pass. */
async function untilNotNull<T>(read: () => T | null): Promise<T> {
  for (;;) {
    const value = read();
    if (value !== null) {
      return value;
    }
    await frame();
  }
}

const PROBE_DISPATCHES: ReadonlyMap<number, ThreadDispatch> = new Map(
  [0, 1].map((ordinal) => [
    ordinal,
    {
      ordinal,
      label: `Shadow task ${String(ordinal)}.`,
      status: "succeeded",
      error: null,
      child_session_id: `shadow-child-${String(ordinal)}`,
      created_at: "2026-08-21T10:00:00Z",
      updated_at: "2026-08-21T10:00:00Z",
    },
  ]),
);

async function boot(): Promise<void> {
  const ancestor = mustFindHost("probe-ancestor");
  const host = mustFindHost("probe-host");
  const reduceMotion = new URLSearchParams(window.location.search).has(
    "reduce-motion",
  );
  if (reduceMotion) {
    ancestor.setAttribute("data-reduce-motion", "true");
  }

  // The artifact's side effect: the element upgrades, and its
  // connectedCallback attaches the open shadow root, adopts the baked
  // constructed sheet, appends the wrapper, and starts the reflection
  // bridge. The probe creates NONE of that. The wait is bounded with a
  // NAMED diagnosis for the MISSING-artifact case: a reused fixture
  // server (reuseExistingServer) serves whatever dist/element/ is on
  // disk — nothing at all if no build:element ever ran here, and a
  // 404'd module script leaves the element undefined forever. That must
  // read as "restart the server", not as an opaque readiness timeout.
  // (The other reuse hazard — a PRESENT but STALE dist/element/ — loads
  // and defines fine, so no in-page wait can see it; the suite's
  // freshness guard in tvc-motion.spec.ts rehashes the build's recorded
  // inputs and reds on it.) On a healthy page the definition lands
  // during module evaluation, well before load, so the grace only ever
  // fires on a genuinely missing artifact; it is sized to beat the
  // spec's 5s readiness window so the message is in the failure
  // snapshot.
  const ARTIFACT_DEFINE_GRACE_MS = 3_000;
  let defineTimer: number | undefined;
  await Promise.race([
    customElements.whenDefined("teaflask-assistant").then(() => {
      clearTimeout(defineTimer);
    }),
    new Promise<never>((_, reject) => {
      defineTimer = window.setTimeout(() => {
        reject(
          new Error(
            "<teaflask-assistant> was never defined — " +
              "/dist/element/assistant.js did not load. A reused " +
              "fixture server serves whatever dist/element/ is on " +
              "disk (possibly nothing): restart " +
              "`npm run fixture:transcript`.",
          ),
        );
      }, ARTIFACT_DEFINE_GRACE_MS);
    }),
  ]);
  const shadow = await untilNotNull(() => host.shadowRoot);
  const wrapper = await untilNotNull(
    () => shadow.firstElementChild as HTMLElement | null,
  );

  // Render the scene into a detached container first — our own React
  // commit, no interleaving with the artifact's root (which renders
  // null: the element is deliberately keyless).
  const scene = document.createElement("div");
  createRoot(scene).render(
    <StrictMode>
      <div
        data-tf-assistant=""
        className="tf:bg-tf-background tf:p-6 tf:text-tf-foreground"
      >
        <ShimmerText className="tf:text-tf-label tf:text-tf-muted-foreground">
          Working…
        </ShimmerText>
        <p className="tf:flex tf:items-center tf:gap-2 tf:text-tf-label tf:text-tf-muted-foreground">
          <Spinner label="Sending…" />
        </p>
        {/* The drill-in popover under the SAME hardest host (TVC-076):
            the shadow root is the shipped widget's normal habitat, so
            top-layer behavior, placement, the native Escape listener,
            composedPath light dismissal, and focus restore are measured
            here rather than derived from "same shell as the roster's".
            SETTLED entries on purpose: TVC-102's locators assume the
            page's ONE spinner, so this scene must add no motion (settled
            rows wear the quiet check); the deterministic renderPreview
            stub keeps the probe streamless. */}
        <SubagentDelegationSurface
          dispatches={PROBE_DISPATCHES}
          threadId="shadow-probe-thread"
          renderPreview={(childSessionId) => (
            <ChildTranscriptPreviewFrame
              label={`Shadow preview ${childSessionId}`}
              status="running"
            >
              <p
                className="tf:m-0 tf:p-4 tf:text-tf-label"
                data-probe-preview-body=""
              >
                Shadow preview body.
              </p>
            </ChildTranscriptPreviewFrame>
          )}
        >
          <SubagentDispatchesContext.Provider
            value={{ byOrdinal: PROBE_DISPATCHES }}
          >
            <SubagentGroupRow
              row={{
                kind: "subagent-group",
                key: "shadow-probe-subagents",
                entries: [0, 1].map((ordinal) => ({
                  toolCallId: `shadow-call-${String(ordinal)}`,
                  receipt: {
                    outcome: "already_settled",
                    ordinal,
                    label: `Shadow task ${String(ordinal)}.`,
                    childSessionId: `shadow-child-${String(ordinal)}`,
                    settled: { failed: false, note: null },
                  },
                  label: `Shadow task ${String(ordinal)}.`,
                  running: false,
                  failed: false,
                  cancelled: false,
                  note: null,
                })),
              }}
            />
          </SubagentDispatchesContext.Provider>
        </SubagentDelegationSurface>
      </div>
    </StrictMode>,
  );

  // react-dom can wipe a root container's foreign children when a
  // commit lands while the root's committed tree is empty — the keyless
  // artifact root's permanent state. Exactly WHICH commits clear (the
  // initial one? every empty re-render?) produced three contradictory
  // source-reads of react-dom 19.2.3, so this loop is deliberately
  // agnostic about the internals and the page MEASURES instead: attempt
  // 1 held in 40/40 instrumented loads (both arms; see
  // data-probe-append-attempts below) — in practice the artifact root's
  // null commit, scheduled during the artifact module's evaluation, has
  // already flushed before this later module appends. If scheduling
  // ever reorders or a future react clears differently, the BOUNDED
  // retry absorbs it and exhaustion fails loudly (readiness never sets;
  // the spec goes red).
  const APPEND_ATTEMPTS = 10;
  let appendAttempts = 0;
  let sceneHeld = false;
  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt += 1) {
    appendAttempts = attempt + 1;
    wrapper.append(scene);
    await twoFrames();
    if (scene.isConnected) {
      sceneHeld = true;
      break;
    }
  }
  if (!sceneHeld) {
    throw new Error(
      `the probe scene did not hold its place inside the artifact's ` +
        `wrapper after ${String(APPEND_ATTEMPTS)} appends — something ` +
        `keeps clearing it`,
    );
  }
  // Bench telemetry: which append attempt held, so the retry's behavior
  // is measurable from the page instead of argued from react internals.
  document.body.setAttribute(
    "data-probe-append-attempts",
    String(appendAttempts),
  );

  // The kill switch crosses the boundary through the ARTIFACT's bridge
  // (a MutationObserver mirror — asynchronous), and the spec's
  // animationName reads are one-shot: readiness must not fire before
  // the mirror lands on the wrapper.
  if (reduceMotion) {
    await untilNotNull(() =>
      wrapper.getAttribute("data-reduce-motion") === "true" ? true : null,
    );
  }
  await twoFrames();
  document.body.setAttribute("data-probe-ready", "true");
}

void boot().catch((error: unknown) => {
  // Readiness stays unset — the spec goes red — and the diagnosis is
  // written where the failure artifacts show it (visible page text and
  // a body attribute), not only the console.
  const message = error instanceof Error ? error.message : String(error);
  document.body.setAttribute("data-probe-error", message);
  document.body.append(`shadow-probe boot failed: ${message}`);
  console.error("[shadow-probe]", error);
});
