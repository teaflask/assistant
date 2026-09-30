// The hostile-host bench for the floating panel. Run `npm run fixture`
// and open http://127.0.0.1:8787/fixtures/floating-panel/ — each toggle
// constructs one of the conditions the primitive exists to survive
// (conditions the dashboard dogfood, a well-behaved host, can never
// produce): a transformed ancestor, a maximal-z-index competitor, a host
// modal's forced popover hide, a shadow-root mount, a host `.hidden`
// utility (index.html — since the tf: prefix it can no longer touch the
// sheet; kept as the negative specimen), and a garish ancestor theme. The
// bench's own chrome is plain host-styled markup on purpose — the panel
// is the only thing here allowed to look like the package.

import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { TfFloatingPanel } from "../../src/components/primitives/floating-panel";

type Corner = "bottom-right" | "bottom-left";

function PlaceholderChild({ onClose }: { onClose: () => void }) {
  return (
    <>
      <header className="panel-handle" data-tf-swipe-handle="">
        <strong>Companion placeholder</strong>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <label className="panel-field">
        Autofocus proof — focus lands here on open
        <input data-tf-autofocus="" placeholder="Type, then Esc" />
      </label>
      <div className="panel-scroll">
        {Array.from({ length: 40 }, (_, index) => (
          <p key={index}>
            Filler row {String(index + 1)}: this column scrolls vertically — the
            same axis the dismissing swipe travels — which is exactly why
            dismissal only begins on the grab handle above.
          </p>
        ))}
      </div>
    </>
  );
}

// A second, independent panel mounted inside an open shadow root with the
// package sheet linked inside it — a component-level in-shadow bench for
// TfFloatingPanel. The script-tag distribution's real bench is
// fixtures/element/ (npm run fixture:element), which drives the actual
// <teaflask-assistant> bundle.
function ShadowRootMount() {
  const hostRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const attachShadowBench = () => {
    const host = hostRef.current;
    if (host === null || mountedRef.current) {
      return;
    }
    mountedRef.current = true;
    const shadow = host.attachShadow({ mode: "open" });
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = "/dist/styles.css";
    shadow.appendChild(sheet);
    // The bench's own placeholder styles don't cross the shadow boundary;
    // without this clone the shadow panel's child renders as bare UA
    // markup and reads as a package defect it isn't.
    const benchStyles = document.querySelector("style");
    if (benchStyles !== null) {
      shadow.appendChild(benchStyles.cloneNode(true));
    }
    const mount = document.createElement("div");
    shadow.appendChild(mount);
    createRoot(mount).render(
      <StrictMode>
        <ShadowPanel />
      </StrictMode>,
    );
  };
  return (
    <div className="host-card">
      <p>
        Shadow-root mount: an independent panel rendered inside an open shadow
        root, stylesheet adopted inside it.
      </p>
      <button type="button" onClick={attachShadowBench}>
        Mount shadow-root panel
      </button>
      <div ref={hostRef} />
    </div>
  );
}

function ShadowPanel() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Reopen shadow panel
      </button>
      <TfFloatingPanel
        open={open}
        focusOnOpen
        onOpenChange={setOpen}
        corner="bottom-left"
        aria-label="Shadow-root floating panel"
      >
        <PlaceholderChild
          onClose={() => {
            setOpen(false);
          }}
        />
      </TfFloatingPanel>
    </>
  );
}

function Bench() {
  const [open, setOpen] = useState(false);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [transformed, setTransformed] = useState(false);
  const [garish, setGarish] = useState(false);
  const [dark, setDark] = useState(false);
  const [competitor, setCompetitor] = useState(false);
  const [hostClicks, setHostClicks] = useState(0);
  const hostModalRef = useRef<HTMLDialogElement>(null);

  const wrapperClass = [
    transformed ? "bench-transformed" : "",
    garish ? "bench-garish" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main>
      <section className="host-card host-controls">
        <button
          type="button"
          onClick={() => {
            setOpen((wasOpen) => !wasOpen);
          }}
        >
          {open ? "Close panel" : "Open panel"}
        </button>
        <label>
          <input
            type="checkbox"
            checked={corner === "bottom-left"}
            onChange={(event) => {
              setCorner(event.target.checked ? "bottom-left" : "bottom-right");
            }}
          />
          left corner
        </label>
        <label>
          <input
            type="checkbox"
            checked={transformed}
            onChange={(event) => {
              setTransformed(event.target.checked);
            }}
          />
          transformed ancestor
        </label>
        <label>
          <input
            type="checkbox"
            checked={garish}
            onChange={(event) => {
              setGarish(event.target.checked);
            }}
          />
          garish theme
        </label>
        <label>
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => {
              setDark(event.target.checked);
            }}
          />
          dark theme
        </label>
        <label>
          <input
            type="checkbox"
            checked={competitor}
            onChange={(event) => {
              setCompetitor(event.target.checked);
            }}
          />
          z-index competitor
        </label>
        <button
          type="button"
          onClick={() => {
            hostModalRef.current?.showModal();
          }}
        >
          Open host modal
        </button>
      </section>

      <section className="host-card">
        <h1>The host app is still alive</h1>
        <p>
          With the panel open, everything here must keep working: the button
          counts, the input types, the page scrolls, and a click just outside
          the panel&apos;s edge lands on this page (the popover backdrop
          intercepts nothing).
        </p>
        <button
          type="button"
          onClick={() => {
            setHostClicks((count) => count + 1);
          }}
        >
          Host clicks: {String(hostClicks)}
        </button>{" "}
        <input className="host-input" placeholder="Host input keeps focus" />
      </section>

      <ShadowRootMount />

      {Array.from({ length: 12 }, (_, index) => (
        <section className="host-card" key={index}>
          <p>
            Host filler {String(index + 1)} — enough page to scroll behind the
            open panel, proving no scroll lock exists.
          </p>
        </section>
      ))}

      {/* The panel and its hostile ancestors: theme and stacking traps
          apply to the panel exactly when they wrap it. */}
      <div className={wrapperClass} data-tf-theme={dark ? "dark" : undefined}>
        <TfFloatingPanel
          open={open}
          focusOnOpen
          onOpenChange={setOpen}
          corner={corner}
          aria-label="Floating panel bench"
        >
          <PlaceholderChild
            onClose={() => {
              setOpen(false);
            }}
          />
        </TfFloatingPanel>
      </div>

      {competitor ? (
        <div className="bench-z-competitor">
          Host chrome at z-index 2147483647, parked in the panel&apos;s corner.
          The top layer must paint above this.
        </div>
      ) : null}

      <dialog ref={hostModalRef} className="host-modal">
        <p>
          A host modal opened with showModal(): the spec force-hides every open
          popover, so the panel yields — and must come back on its own when this
          closes, still tracking its open state.
        </p>
        <button
          type="button"
          onClick={() => {
            hostModalRef.current?.close();
          }}
        >
          Close host modal
        </button>
      </dialog>
    </main>
  );
}

const benchMount = document.getElementById("bench");
if (benchMount === null) {
  throw new Error("The bench page is missing its #bench mount.");
}
createRoot(benchMount).render(
  <StrictMode>
    <Bench />
  </StrictMode>,
);
