"use client";

import type { RefObject } from "react";

import type {
  ServedModelChoice,
  ServedThinkingEffort,
} from "../contract/assistant-config.js";
import type { ComposerContract } from "../core/conversation-contract.js";
import { CheckIcon, ChevronDownIcon } from "./icons.js";
import { effortLabelOf, nearestEffortIn } from "./model-picker-effort.js";
import { TfButton } from "./primitives/button.js";

export type PickerPanel = "root" | "model" | "effort";

// Every panel's frame: its focus target, which panel the menu shows, and
// the navigation that moves focus onto the revealed panel.
interface PickerPanelFrame {
  panelRef: RefObject<HTMLDivElement | null>;
  panel: PickerPanel;
  showPanel: (next: PickerPanel) => void;
}

// The compact root: Model and Effort as the menu's two drill-ins.
export function ModelPickerRootPanel({
  panelRef,
  panel,
  currentName,
  currentEffort,
  showPanel,
}: PickerPanelFrame & {
  currentName: string;
  currentEffort: ServedThinkingEffort | null;
}) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      hidden={panel !== "root"}
      role="group"
      aria-label="Model and effort"
      className={
        (panel === "root" ? "tf:flex " : "tf:hidden ") +
        "tf:flex-col tf:gap-0.5 tf:outline-none"
      }
    >
      <TfButton
        variant="row"
        className="tf:gap-3"
        onClick={() => {
          showPanel("model");
        }}
      >
        <span className="tf:flex-1 tf:text-left">Model</span>
        <span className="tf:min-w-0 tf:truncate tf:text-tf-muted-foreground">
          {currentName}
        </span>
        <span className="tf:-rotate-90 tf:text-tf-muted-foreground">
          <ChevronDownIcon />
        </span>
      </TfButton>
      <TfButton
        variant="row"
        className="tf:gap-3"
        onClick={() => {
          showPanel("effort");
        }}
      >
        <span className="tf:flex-1 tf:text-left">Effort</span>
        <span className="tf:min-w-0 tf:truncate tf:text-tf-muted-foreground">
          {currentEffort === null ? "Default" : effortLabelOf(currentEffort)}
        </span>
        <span className="tf:-rotate-90 tf:text-tf-muted-foreground">
          <ChevronDownIcon />
        </span>
      </TfButton>
    </div>
  );
}

// The model drill-in: one row per served option, the current one checked.
export function ModelPickerServedModelsPanel({
  panelRef,
  panel,
  menu,
  currentModelId,
  modelPick,
  setModelPick,
  showPanel,
}: PickerPanelFrame &
  Pick<ComposerContract, "modelPick" | "setModelPick"> & {
    menu: ServedModelChoice;
    currentModelId: string;
  }) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      hidden={panel !== "model"}
      role="group"
      aria-label="Model"
      className={
        (panel === "model" ? "tf:flex " : "tf:hidden ") +
        "tf:flex-col tf:gap-0.5 tf:outline-none"
      }
    >
      <PickerPanelHeading
        label="Model"
        onBack={() => {
          showPanel("root");
        }}
      />
      {menu.models.map((option) => (
        <TfButton
          key={option.id}
          variant="row"
          aria-pressed={option.id === currentModelId}
          onClick={() => {
            // The default row is the way back: it stores NO pin,
            // so the thread keeps following operator changes. A
            // stored effort re-resolves against the chosen model's
            // OWN set (nearest, ties down — Amendment C): kept
            // when supported, rewritten when not, never
            // materialized from the display default (a null pin
            // stays null — the config answers), and never
            // rewritten when it is outside this bundle's
            // vocabulary.
            const stored = modelPick?.effort ?? null;
            setModelPick({
              modelId: option.id === menu.default_model_id ? null : option.id,
              effort:
                stored === null || option.efforts.includes(stored)
                  ? stored
                  : (nearestEffortIn(option.efforts, stored) ?? stored),
            });
            showPanel("root");
          }}
        >
          <span className="tf:min-w-0 tf:flex-1 tf:truncate">
            {option.display_name}
          </span>
          <span aria-hidden={option.id !== currentModelId} className="tf:w-4">
            {option.id === currentModelId ? <CheckIcon /> : null}
          </span>
        </TfButton>
      ))}
    </div>
  );
}

// The effort drill-in: the selected model's own ladder, the displayed
// (clamped) value checked.
export function ModelPickerEffortPanel({
  panelRef,
  panel,
  ladder,
  currentEffort,
  modelPick,
  setModelPick,
  showPanel,
}: PickerPanelFrame &
  Pick<ComposerContract, "modelPick" | "setModelPick"> & {
    ladder: readonly ServedThinkingEffort[];
    currentEffort: ServedThinkingEffort | null;
  }) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      hidden={panel !== "effort"}
      role="group"
      aria-label="Reasoning effort"
      className={
        (panel === "effort" ? "tf:flex " : "tf:hidden ") +
        "tf:flex-col tf:gap-0.5 tf:outline-none"
      }
    >
      <PickerPanelHeading
        label="Effort"
        onBack={() => {
          showPanel("root");
        }}
      />
      {ladder.map((effort) => (
        <TfButton
          key={effort}
          variant="row"
          aria-pressed={effort === currentEffort}
          onClick={() => {
            // Clicking the already-current row writes NOTHING: the
            // displayed value may be a clamp of configured truth.
            if (effort !== currentEffort) {
              // Effort-only never pins a model: the pin stays
              // whatever it was (null follows the configured model).
              setModelPick({
                modelId: modelPick?.modelId ?? null,
                effort,
              });
            }
            showPanel("root");
          }}
        >
          <span className="tf:min-w-0 tf:flex-1 tf:truncate">
            {effortLabelOf(effort)}
          </span>
          <span aria-hidden={effort !== currentEffort} className="tf:w-4">
            {effort === currentEffort ? <CheckIcon /> : null}
          </span>
        </TfButton>
      ))}
    </div>
  );
}

function PickerPanelHeading({
  label,
  onBack,
}: {
  label: string;
  onBack: () => void;
}) {
  return (
    <div className="tf:mb-1 tf:flex tf:items-center tf:gap-1 tf:border-b tf:px-1 tf:pb-1">
      <TfButton variant="icon" aria-label="Back" onClick={onBack}>
        <span className="tf:rotate-90">
          <ChevronDownIcon />
        </span>
      </TfButton>
      <span className="tf:text-tf-label tf:font-medium">{label}</span>
    </div>
  );
}
