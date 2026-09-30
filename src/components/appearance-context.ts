"use client";

import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { AssistantThemeMode } from "../appearance/theme.js";
import type { AssistantSuggestionInput } from "./conversation-view.js";

// The provider's appearance channel to the widget roots. A separate
// context from the session on purpose: hosts write the theme prop as an
// inline object literal — appearance must be structurally unable to
// reach the session's memo keys, where a fresh-per-render identity
// would tear down and rebuild the conversation transport.

export interface AssistantRootProps {
  style?: CSSProperties;
  "data-tf-theme"?: AssistantThemeMode;
}

export interface AssistantAppearanceValue {
  // Spread onto every element that carries `data-tf-assistant`. The
  // theme prop rides as inline `--tf-*` variables, which is what makes
  // explicit JS intent beat ambient host CSS; `data-tf-theme` rides
  // along when the host passed `mode`. Empty when neither prop is set,
  // leaving the pure-CSS route exactly as documented.
  rootProps: AssistantRootProps;
  // The host's companion mark — the node the perch and the
  // drawer welcome all show, read by identity like `toolViews`. A
  // sibling of the theme, never a theme token: the mark is identity,
  // not paint. Null means the package's own flask.
  companionMark: ReactNode | null;
  // The host's opening prompts for the companion drawer's welcome —
  // content, never the package's (it has no tool catalog to invent
  // prompts from), so like `companionMark` it rides beside the theme
  // rather than inside it. Null when the host offers none, and the
  // welcome simply renders without them.
  suggestions: readonly AssistantSuggestionInput[] | null;
}

export const AssistantAppearanceContext =
  createContext<AssistantAppearanceValue | null>(null);

export function useAssistantAppearance(): AssistantAppearanceValue {
  const value = useContext(AssistantAppearanceContext);
  if (value === null) {
    throw new Error(
      "Teaflask assistant components must be rendered inside <TeaflaskAssistantProvider>.",
    );
  }
  return value;
}
