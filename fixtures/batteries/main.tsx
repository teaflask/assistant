// The batteries-included bench. Run `npm run fixture:batteries` and open
// http://127.0.0.1:8789/fixtures/batteries/ — unlike
// the companion bench (which scripts the widget's internals), this page
// is the pure consumer story: the real <TeaflaskAssistant/> three-liner
// plus the hostile-host conditions its hotkey contract must survive — a
// host ⌘K handler that claims or merely observes the chord, focused
// editable elements, rebinding, disabling, an invalid spec, and the
// imperative ref. No backend: the mint fails quietly and the palette
// shows its honest setup-error card, which is fine — the subject here is
// the trigger, not the conversation.

import { StrictMode, useEffect, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";

import {
  TeaflaskAssistant,
  type TeaflaskAssistantHandle,
} from "../../src/components/teaflask-assistant";

type HostHandlerMode = "off" | "observe" | "claim";
type HotkeyChoice = "mod+k" | "mod+j" | "disabled" | "invalid";

const HOTKEY_PROPS: Record<HotkeyChoice, string | false | undefined> = {
  "mod+k": undefined, // the default — proves the prop can be omitted
  "mod+j": "mod+j",
  disabled: false,
  invalid: "cmd+j", // the warn-once degrade path
};

function HostPage({
  assistant,
}: {
  assistant: RefObject<TeaflaskAssistantHandle | null>;
}) {
  const [handlerMode, setHandlerMode] = useState<HostHandlerMode>("off");
  const [hostHits, setHostHits] = useState(0);

  // The competing handler every real integration might have: on document,
  // so it runs before the package's window listener. "claim" is a host
  // that preventDefault()s (it must win); "observe" neither claims nor
  // stops — the documented double-fire case.
  useEffect(() => {
    if (handlerMode === "off") {
      return;
    }
    const hostCmdK = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        if (handlerMode === "claim") {
          event.preventDefault();
        }
        setHostHits((hits) => hits + 1);
      }
    };
    document.addEventListener("keydown", hostCmdK);
    return () => {
      document.removeEventListener("keydown", hostCmdK);
    };
  }, [handlerMode]);

  return (
    <main>
      <h1>TeaflaskAssistant — batteries bench</h1>
      <p>
        This page mounts the one-line root. Expected out of the box: the
        companion in the corner, and ⌘K/Ctrl+K toggling the palette from
        anywhere on the page — including the fields below.
      </p>

      <fieldset>
        <legend>Host ⌘K handler</legend>
        {(["off", "observe", "claim"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={handlerMode === mode}
            onClick={() => {
              setHandlerMode(mode);
              setHostHits(0);
            }}
          >
            {mode}
            {handlerMode === mode ? " ✓" : ""}
          </button>
        ))}
        {handlerMode !== "off" && (
          <div className="host-palette">
            Host handler ({handlerMode}) saw ⌘K <strong>{hostHits}</strong>{" "}
            time(s).{" "}
            {handlerMode === "claim"
              ? "It preventDefault()s, so the palette must NOT open."
              : "It does not claim the chord, so both it and the palette fire."}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Editable contexts (⌘K must open from all of them)</legend>
        <input placeholder="A host input" />
        <textarea rows={2} placeholder="A host textarea" />
        <div contentEditable suppressContentEditableWarning>
          A contenteditable block.
        </div>
      </fieldset>

      <fieldset>
        <legend>Imperative escape hatch</legend>
        <button
          type="button"
          onClick={() => {
            assistant.current?.openPalette();
          }}
        >
          assistantRef.current?.openPalette()
        </button>
      </fieldset>
    </main>
  );
}

function App() {
  const assistantRef = useRef<TeaflaskAssistantHandle>(null);
  const [hotkeyChoice, setHotkeyChoice] = useState<HotkeyChoice>("mod+k");
  const hotkey = HOTKEY_PROPS[hotkeyChoice];

  return (
    <TeaflaskAssistant
      ref={assistantRef}
      publishableKey="pk_test_batteries_bench"
      {...(hotkey === undefined ? {} : { hotkey })}
    >
      <HostPage assistant={assistantRef} />
      <fieldset>
        <legend>hotkey prop</legend>
        {(["mod+k", "mod+j", "disabled", "invalid"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={hotkeyChoice === choice}
            onClick={() => {
              setHotkeyChoice(choice);
            }}
          >
            {choice}
            {hotkeyChoice === choice ? " ✓" : ""}
          </button>
        ))}
        <p>
          "invalid" passes <code>hotkey="cmd+j"</code>: one console warning,
          hotkey disabled, the ref button still works.
        </p>
      </fieldset>
    </TeaflaskAssistant>
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
