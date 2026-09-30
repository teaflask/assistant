// The canned composer contract: what lets the REAL shipping Composer
// render on the fixture bench without a live conversation store behind
// it. The contract's callbacks resolve inertly — the scenario
// photographs the composer, it never sends. Two registers: idle (the
// resting slab) and busy (mid-turn, the stop square showing).

import type {
  ComposerContract,
  ComposerInput,
} from "../../src/core/conversation-store";
import { ObservableCell } from "../../src/core/observable-cell";

export const CANNED_COMPOSER: ComposerContract = {
  busy: false,
  pendingSend: false,
  sendMessage: () => Promise.resolve(true),
  pendingEcho: null,
  composerRefocusPending: false,
  markComposerRefocusHandled: () => undefined,
  stopping: false,
  stopTurn: () => Promise.resolve(),
  modelPick: null,
  setModelPick: () => undefined,
  composerInput: new ObservableCell<ComposerInput>({
    scope: "u:0",
    draft: "",
    attachments: [],
  }),
  setDraft: () => undefined,
  setAttachments: () => undefined,
  noteComposerFocus: () => undefined,
  takeComposerCaretReturn: () => false,
};

export const CANNED_COMPOSER_BUSY: ComposerContract = {
  ...CANNED_COMPOSER,
  busy: true,
};
