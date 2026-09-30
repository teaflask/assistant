// The assistant-config read: the authored widget configuration served at
// runtime. The shapes are generated from serving-openapi.json; this file
// keeps the package's public names stable over the generated ones.

export type {
  AssistantConfigResponse,
  AttachmentPolicyResponse as ServedAttachmentPolicy,
  ModelChoiceResponse as ServedModelChoice,
  RouteSuggestions as ServedRouteSuggestions,
  SuggestionsConfig as ServedSuggestionsConfig,
  ThinkingEffort as ServedThinkingEffort,
} from "../generated/models/index.js";
