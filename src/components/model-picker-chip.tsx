"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import type {
  ServedModelChoice,
  ServedThinkingEffort,
} from "../contract/assistant-config.js";
import type { ComposerContract } from "../core/conversation-contract.js";
import { ChevronDownIcon } from "./icons.js";
import { useConversation } from "./conversation-context.js";
import { displayEffortOf, effortLabelOf } from "./model-picker-effort.js";
import {
  ModelPickerEffortPanel,
  ModelPickerServedModelsPanel,
  ModelPickerRootPanel,
  type PickerPanel,
} from "./model-picker-panels.js";
import { TfButton } from "./primitives/button.js";
import { ProviderChip, ProviderChipShelf } from "./provider-chip.js";
import {
  useAssistantSession,
  useOptionalAssistantSession,
} from "./teaflask-assistant-provider.js";
import { useCell } from "./use-store-cell.js";

// The model picker: the composer shelf hosts TWO independent controls —
// this chip for the model & reasoning choice, and the provider chip
// (reused whole) for the ChatGPT account & funding standing. Selecting
// a model never opens or alters the account menu; connecting or
// disconnecting never touches the pick. Without a served menu the shelf
// renders the provider chip alone.
//
// The chip names the model and effort that will answer (the thread's
// pick, else the served defaults); its menu opens UPWARD over the
// transcript — the same anchoring, glass, light-dismiss, and Esc
// discipline as the provider chip's. The compact root has exactly two
// drill-ins: Model and Effort. Selection rides aria-pressed and a
// visible check (the mode menu's register, never menuitemradio), and
// display names come off the wire: the package carries no model catalog
// of its own.

/** The shelf row below the composer slab: the picker chip when the wire
 *  serves a menu, else today's provider chip. Tolerates a missing
 *  provider like the composer's paperclip does (welcome-branch tests
 *  render the view bare). */
export function ModelPickerShelf() {
  const session = useOptionalAssistantSession();
  if (session === null) {
    return null;
  }
  return <MountedModelPickerShelf />;
}

function MountedModelPickerShelf() {
  const session = useAssistantSession();
  // ONE open menu, held as ONE value: the row's mutual exclusion is
  // structural — a single variable cannot name two menus — not an
  // emergent effect of light dismiss, which only fires on pointerdown
  // and would miss a keyboard open or a programmatic connect ask.
  const [openChip, setOpenChip] = useState<"account" | "picker" | null>(null);
  // The menu rides the config fetch the hosting Composer already kicks
  // for its paperclip — no kick of its own here.
  const answered = useCell(session.configAnswered);
  const menu = useCell(session.modelChoice);
  // The standing read is kicked ABOVE the settle gate, so it flies in
  // parallel with the config read — gating it below would serialize
  // the two round trips and paint the connect chip an RTT late on
  // every cold session. Single-flight, so the chips' own kicks below
  // become no-ops.
  const identified = session.tier === "identified";
  useEffect(() => {
    if (identified) {
      session.ensureSubscriptions();
    }
  }, [identified, session]);
  // The account chip's gate, applied here because the shared row mounts
  // the inner chip directly (the provider shelf's own wrapper would nest
  // a second row): identified-only — the standing GET 403s an anonymous
  // bearer, credentials belong to vouched end users — and only when a
  // provider is offered or once connected.
  const statuses = useCell(session.subscriptions);
  const connectable = identified
    ? (statuses ?? []).filter((status) => status.offered || status.connected)
    : [];
  // TENANCY, derived once and used everywhere below: this shelf owns a
  // chip's open state exactly when it will RENDER that chip. Until the
  // config read settles it owns neither (the slot's identity is
  // unknown); with no served menu it owns neither (the provider shelf
  // branch runs its own bookkeeping). Every open/close/acknowledge
  // predicate routes through these two values — a second spelling of
  // the same rule is how the open adjustment and the close guard came
  // to fight each other into a render loop.
  const ownsPickerChip = answered && menu !== null;
  const ownsAccountChip = ownsPickerChip && connectable.length > 0;
  // The parked connect ask (requestSubscriptionConnect): consumed HERE,
  // by the state owner, so honoring it structurally closes the picker's
  // menu — an ask consumed behind another menu would never become
  // visible. A render-time adjustment of the shelf's OWN state (the
  // sanctioned shape); the effect only CONSUMES the ask, an external
  // store write, once the account menu is actually rendered. Gated on
  // OWNERSHIP, not just a connectable provider: pre-settle, or with no
  // served menu, this shelf renders no account chip, and consuming the
  // ask here would silently burn a ring that the provider shelf (or
  // this shelf, once the read lands) would honor visibly. With nothing
  // to connect it stays parked exactly as on an empty shelf.
  const openRequested = useCell(session.connectOpenRequested);
  if (openRequested && ownsAccountChip && openChip !== "account") {
    setOpenChip("account");
  }
  // A menu cannot outlive its tenancy: a withdrawn offer unmounts the
  // account chip and a withdrawn menu swaps this whole row for the
  // provider shelf — in both cases the open state dies with the tenant
  // rather than popping the menu back open on a later re-offer (the
  // same render-time-adjustment shape as the ask above).
  if (openChip === "account" && !ownsAccountChip) {
    setOpenChip(null);
  }
  if (openChip === "picker" && !ownsPickerChip) {
    setOpenChip(null);
  }
  useEffect(() => {
    if (openRequested && ownsAccountChip && openChip === "account") {
      session.acknowledgeSubscriptionConnect();
    }
  }, [openRequested, ownsAccountChip, openChip, session]);
  // Until the config read SETTLES, the slot's identity is unknown — a
  // provider chip mounted for the fetch window would flash, and an ask
  // consumed in it would be burnt on behalf of whichever shelf is about
  // to take the slot (the ownership gate above keeps the ask parked
  // through this window). Once settled, a null menu means "no picker"
  // whether the toggle is off or the read failed, and the provider chip
  // falls back honestly (it renders off the separate subscriptions
  // read).
  if (!answered) {
    return null;
  }
  if (menu === null) {
    return <ProviderChipShelf />;
  }
  // One shelf row, two independent controls: the account chip when there
  // is an account standing to speak for, and the picker as the row's
  // primary tenant, rightmost. Both menus anchor to this row's right
  // edge and open upward. At most one is ever open BY CONSTRUCTION —
  // both chips are controlled by the single openChip above, so a
  // pointer, keyboard, or programmatic open of one is the close of the
  // other; light dismiss still handles clicks that land nowhere.
  return (
    <div className="tf:relative tf:mt-1.5 tf:flex tf:items-center tf:justify-end tf:gap-2 tf:px-1">
      {ownsAccountChip ? (
        <ProviderChip
          statuses={connectable}
          open={openChip === "account"}
          onOpenChange={(next) => {
            setOpenChip(next ? "account" : null);
          }}
          // The one sentence relating the pick to the plan: the account
          // menu answers "who pays?", and the picker beside it changes
          // the question. Funding stays per provider — a connected plan
          // serves its own models, everything else runs on the
          // workspace's own funding.
          fundingNote="Models your plan serves run on it; other picks run on this site's own funding."
        />
      ) : null}
      <ModelPickerChip
        menu={menu}
        open={openChip === "picker"}
        onOpenChange={(next) => {
          setOpenChip(next ? "picker" : null);
        }}
      />
    </div>
  );
}

function ModelPickerChip({
  menu,
  open,
  onOpenChange,
}: {
  menu: ServedModelChoice;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { modelPick, setModelPick } = useConversation();
  const {
    panel,
    setPanel,
    showPanel,
    triggerRef,
    menuRef,
    rootPanelRef,
    modelPanelRef,
    effortPanelRef,
  } = useModelPickerPanels({ open, onOpenChange });
  const { currentModelId, renderedLadder, currentEffort, currentName } =
    pickerSelectionOf(menu, modelPick);

  return (
    <>
      <ModelPickerTrigger
        triggerRef={triggerRef}
        open={open}
        onOpenChange={onOpenChange}
        setPanel={setPanel}
        currentName={currentName}
        currentEffort={currentEffort}
      />
      {open ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the keydown is the menu's own Esc-to-close; every focusable inside is a real button.
        <div
          ref={menuRef}
          id="tf-model-picker-menu"
          role="dialog"
          aria-label="Choose model and effort"
          // Anchored to the shelf and opening UPWARD over the transcript,
          // glass like the package's other floating chrome, painted over
          // the static transcript by document order alone — no z-index.
          data-tf-glass=""
          // The root is deliberately compact: model and effort are two
          // drill-in choices, not one wide catalogue/settings table.
          // Each submenu uses the same measured surface, so opening one
          // changes the content rather than making the menu jump.
          className="tf:absolute tf:right-0 tf:bottom-full tf:mb-2 tf:flex tf:max-h-[min(32rem,calc(100vh-6rem))] tf:w-80 tf:max-w-full tf:flex-col tf:overflow-y-auto tf:rounded-2xl tf:border tf:p-2"
          onKeyDown={(event) => {
            if (event.key !== "Escape") {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setPanel("root");
            onOpenChange(false);
            triggerRef.current?.focus();
          }}
        >
          <ModelPickerRootPanel
            panelRef={rootPanelRef}
            panel={panel}
            currentName={currentName}
            currentEffort={currentEffort}
            showPanel={showPanel}
          />
          {/* Kept mounted while hidden so selection state and focusable
              identities remain stable as the visitor drills in and back. */}
          <ModelPickerServedModelsPanel
            panelRef={modelPanelRef}
            panel={panel}
            menu={menu}
            currentModelId={currentModelId}
            modelPick={modelPick}
            setModelPick={setModelPick}
            showPanel={showPanel}
          />
          <ModelPickerEffortPanel
            panelRef={effortPanelRef}
            panel={panel}
            ladder={renderedLadder}
            currentEffort={currentEffort}
            modelPick={modelPick}
            setModelPick={setModelPick}
            showPanel={showPanel}
          />
        </div>
      ) : null}
    </>
  );
}

interface ModelPickerPanelsController {
  panel: PickerPanel;
  setPanel: (next: PickerPanel) => void;
  showPanel: (next: PickerPanel) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  rootPanelRef: RefObject<HTMLDivElement | null>;
  modelPanelRef: RefObject<HTMLDivElement | null>;
  effortPanelRef: RefObject<HTMLDivElement | null>;
}

// The menu's panel state and its two focus disciplines: a drill-in or
// back moves focus onto the revealed panel, and a press outside the menu
// closes it.
function useModelPickerPanels({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ModelPickerPanelsController {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<PickerPanel>("root");

  // Drill-in, back, and selection all hide the container holding the
  // just-clicked button, which would drop keyboard focus to <body> —
  // Esc then stops closing the menu (its handler lives on the menu div)
  // and Tab restarts from the document top. Focus follows the navigation
  // onto the revealed panel instead; the close paths keep their own
  // focus story (the trigger).
  const rootPanelRef = useRef<HTMLDivElement | null>(null);
  const modelPanelRef = useRef<HTMLDivElement | null>(null);
  const effortPanelRef = useRef<HTMLDivElement | null>(null);
  const panelAwaitingFocus = useRef<PickerPanel | null>(null);
  const showPanel = (next: PickerPanel) => {
    // A same-value call re-renders nothing (React bails out), so a
    // pending mark here would fire on some later unrelated render.
    if (next === panel) {
      return;
    }
    panelAwaitingFocus.current = next;
    setPanel(next);
  };
  useEffect(() => {
    const target = panelAwaitingFocus.current;
    if (target === null) {
      return;
    }
    panelAwaitingFocus.current = null;
    if (!open || target !== panel) {
      return;
    }
    const panelRef: RefObject<HTMLDivElement | null> =
      target === "root"
        ? rootPanelRef
        : target === "model"
          ? modelPanelRef
          : effortPanelRef;
    panelRef.current?.focus();
  });

  // No connect concerns here: the shelf owns the open state and the
  // parked connect ask, and the account chip beside this one owns
  // the standing and the sign-in flow — this menu is models and
  // effort only.

  // Light dismissal by composedPath() — the script-tag distribution runs
  // in an open shadow root, where contains() would misjudge every
  // in-shadow press (the provider chip's rationale, verbatim).
  useEffect(() => {
    const menuElement = menuRef.current;
    if (!open || menuElement === null) {
      return;
    }
    const closeUnlessInside = (event: Event) => {
      const path = event.composedPath();
      if (path.includes(menuElement)) {
        return;
      }
      const trigger = triggerRef.current;
      if (trigger !== null && path.includes(trigger)) {
        return;
      }
      onOpenChange(false);
    };
    const doc = menuElement.ownerDocument;
    doc.addEventListener("pointerdown", closeUnlessInside);
    return () => {
      doc.removeEventListener("pointerdown", closeUnlessInside);
    };
  }, [open, onOpenChange]);

  return {
    panel,
    setPanel,
    showPanel,
    triggerRef,
    menuRef,
    rootPanelRef,
    modelPanelRef,
    effortPanelRef,
  };
}

interface PickerSelection {
  currentModelId: string;
  renderedLadder: readonly ServedThinkingEffort[];
  currentEffort: ServedThinkingEffort | null;
  currentName: string;
}

// What the chip and its panels display for a menu and a pick: the
// answering model, its own effort ladder, and the display effort
// clamped into that ladder.
function pickerSelectionOf(
  menu: ServedModelChoice,
  modelPick: ComposerContract["modelPick"],
): PickerSelection {
  // A null pin (or no pick) shows — and checks — the served default:
  // the configured model answers there.
  const currentModelId = modelPick?.modelId ?? menu.default_model_id;
  // The rendered ladder is the SELECTED model's own supported set
  // (the per-option efforts, consumed here — menu ⊆ pickable per
  // model). The root intersection survives only as the fallback for a
  // stored pin naming a model the wire no longer offers.
  const selectedOption = menu.models.find(
    (option) => option.id === currentModelId,
  );
  const renderedLadder = selectedOption?.efforts ?? menu.efforts;
  // The DISPLAY selection, clamped into the rendered ladder. The
  // preselected default is configured_effort — the config's effort
  // VERBATIM (the root-clamped default_effort survives as the
  // one-ladder fallback for a wire that predates it) — so a config
  // tuned above the root intersection preselects honestly on its own
  // model. The clamp still bites where the SELECTED model genuinely
  // cannot express the value (a stored pin meeting a narrower model's
  // set): display only — the stored pin is untouched, the
  // already-current guard in the effort panel keeps the clamped value
  // from being written back as a pin, and the runtime clamps the real
  // pair per answering model.
  const configuredEffort =
    menu.configured_effort ?? menu.default_effort ?? null;
  // The fallback default is default_effort FIRST: root-clamped, so a
  // member of every option's ladder — the one value guaranteed to
  // render when the selection is outside this bundle's vocabulary
  // entirely (configuredEffort may BE that unknown value).
  const currentEffort = displayEffortOf(
    renderedLadder,
    modelPick?.effort ?? configuredEffort,
    menu.default_effort ?? configuredEffort,
  );
  const currentName = selectedOption?.display_name ?? currentModelId;
  return { currentModelId, renderedLadder, currentEffort, currentName };
}

// The chip itself: the trigger naming the answering model and effort,
// which opens and closes the menu.
function ModelPickerTrigger({
  triggerRef,
  open,
  onOpenChange,
  setPanel,
  currentName,
  currentEffort,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setPanel: (next: PickerPanel) => void;
  currentName: string;
  currentEffort: ServedThinkingEffort | null;
}) {
  return (
    <TfButton
      ref={triggerRef}
      variant="chipQuiet"
      // The shelf row's designated shrinker: beside the account chip's
      // never-wrapping label, this chip gives up width first — the
      // model name truncates (one tap from its full spelling in the
      // menu) instead of either chip wrapping to two lines.
      className="tf:min-w-0"
      aria-expanded={open}
      aria-controls="tf-model-picker-menu"
      // The accessible name carries everything the visible label shows
      // (WCAG 2.5.3): the model AND, when one renders, the effort.
      aria-label={
        currentEffort === null
          ? `Model: ${currentName}`
          : `Model: ${currentName}, effort: ${effortLabelOf(currentEffort)}`
      }
      onClick={() => {
        if (!open) {
          setPanel("root");
        }
        onOpenChange(!open);
      }}
      onKeyDown={(event) => {
        // Escape with focus on the trigger closes the menu, not the
        // hosting surface — stopped so a drawer's own Esc never sees it.
        if (!open || event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setPanel("root");
        onOpenChange(false);
      }}
    >
      <span className="tf:flex tf:max-w-56 tf:min-w-0 tf:items-baseline tf:gap-1.5 tf:truncate">
        <span className="tf:truncate">{currentName}</span>
        {currentEffort !== null ? (
          <span className="tf:shrink-0 tf:text-tf-muted-foreground">
            {effortLabelOf(currentEffort)}
          </span>
        ) : null}
      </span>
      <ChevronDownIcon />
    </TfButton>
  );
}
