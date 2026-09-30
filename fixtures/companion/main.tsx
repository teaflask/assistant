// The companion presence bench. Run `npm run fixture:companion` and open
// http://127.0.0.1:8788/fixtures/companion/ — the buttons script the
// exact inputs the real widget consumes: the surface registry, the
// drawer flag a tool navigation opens, a host modal's forced
// popover hide, the reduce-motion kill switch, and the appearance props
// (corner, mode, and an unsized host companion mark against the
// package's default flask). No backend: the provider's mint fails
// quietly (the drawer shows its honest setup-error card), which is fine
// — real turns are the dashboard dogfood's job; this bench exists for
// the conditions a polite host never produces.

import {
  StrictMode,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createRoot } from "react-dom/client";

import { AssistantCompanion } from "../../src/components/assistant-companion";
import { TeaflaskAssistantProvider } from "../../src/components/teaflask-assistant-provider";
import { openCompanionDrawer } from "../../src/core/companion-drawer-flag";
import { assistantSurfaceRegistry } from "../../src/core/surface-registry";
import { BenchHostMark } from "./bench-host-mark";

type Corner = "bottom-right" | "bottom-left";

// Realistic host prompts at three lengths — the measure for the
// drawer's welcome: the short one any layout survives, the sentence-
// length ones are what decide pills versus rows at 384px.
const BENCH_SUGGESTIONS = [
  { prompt: "What's new this week?", kind: "learn" as const },
  { prompt: "Draft a doc about resetting a password", kind: "write" as const },
  {
    prompt: "Review my workspace settings and flag anything misconfigured",
    kind: "review" as const,
  },
];

function Bench() {
  const modalRef = useRef<HTMLDialogElement>(null);
  const [fullSurface, setFullSurface] = useState<(() => void) | null>(null);
  const [transient, setTransient] = useState<(() => void) | null>(null);

  const toggleRegistration = (
    kind: "full-surface" | "transient",
    current: (() => void) | null,
    save: Dispatch<SetStateAction<(() => void) | null>>,
  ) => {
    if (current === null) {
      const unregister = assistantSurfaceRegistry.register(kind);
      // Wrapped: a bare function handed to a state setter is an updater
      // and would run (unregistering!) instead of being stored.
      save(() => unregister);
    } else {
      current();
      save(null);
    }
  };

  return (
    <main className="transformed">
      <h1>AssistantCompanion — presence bench</h1>
      <p>
        The companion sits bottom-right. Every button below scripts one input of
        the presence rule; the mark and the drawer are the real package pieces.
      </p>

      <fieldset>
        <legend>Yield (the surface registry)</legend>
        <button
          type="button"
          onClick={() => {
            toggleRegistration("full-surface", fullSurface, setFullSurface);
          }}
        >
          {fullSurface === null
            ? "Mount a full surface"
            : "Unmount the full surface"}
        </button>
        <button
          type="button"
          onClick={() => {
            toggleRegistration("transient", transient, setTransient);
          }}
        >
          {transient === null ? "Open a palette" : "Close the palette"}
        </button>
        <button
          type="button"
          onClick={() => {
            openCompanionDrawer();
          }}
        >
          Tool navigation (opens the drawer)
        </button>
      </fieldset>

      <fieldset>
        <legend>Hostile host</legend>
        <button
          type="button"
          onClick={() => {
            modalRef.current?.showModal();
          }}
        >
          showModal() over the dock (parks; close restores)
        </button>
        <button
          type="button"
          onClick={() => {
            const html = document.documentElement;
            html.setAttribute(
              "data-reduce-motion",
              html.getAttribute("data-reduce-motion") === "true"
                ? "false"
                : "true",
            );
          }}
        >
          Toggle data-reduce-motion
        </button>
        <button
          type="button"
          onClick={() => {
            document.body.classList.toggle("garish");
          }}
        >
          Toggle garish host background
        </button>
        <button
          type="button"
          onClick={() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
            location.reload();
          }}
        >
          Clear stored preferences (reloads)
        </button>
      </fieldset>

      <dialog ref={modalRef}>
        <p>A host modal. The dock parks under it; closing restores it.</p>
        <button
          type="button"
          onClick={() => {
            modalRef.current?.close();
          }}
        >
          Close modal
        </button>
      </dialog>
    </main>
  );
}

function App() {
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [dark, setDark] = useState(false);
  const [hostMark, setHostMark] = useState(false);
  return (
    <TeaflaskAssistantProvider
      publishableKey="pk_test_companion_bench"
      mode={dark ? "dark" : "light"}
      suggestions={BENCH_SUGGESTIONS}
      companionMark={hostMark ? <BenchHostMark /> : undefined}
    >
      <Bench />
      <fieldset>
        <legend>Appearance</legend>
        <button
          type="button"
          onClick={() => {
            setCorner(
              corner === "bottom-right" ? "bottom-left" : "bottom-right",
            );
          }}
        >
          Corner: {corner}
        </button>
        <button
          type="button"
          onClick={() => {
            setDark(!dark);
          }}
        >
          Mode: {dark ? "dark" : "light"}
        </button>
        <button
          type="button"
          onClick={() => {
            setHostMark(!hostMark);
          }}
        >
          Mark: {hostMark ? "host ring" : "default flask"}
        </button>
      </fieldset>
      <AssistantCompanion corner={corner} />
    </TeaflaskAssistantProvider>
  );
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("The bench page lost its root element.");
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
