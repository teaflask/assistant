// The identity pair as the provider tests pass it: whole or absent, the
// way the props type insists, so a case toggles identity with one flag.

import type {
  TeaflaskAssistantAnonymousProps,
  TeaflaskAssistantIdentityProps,
} from "../src/components/teaflask-assistant-provider";

export function identityPropsOf(
  identified: boolean,
  userId = "end-user-1",
): TeaflaskAssistantIdentityProps | TeaflaskAssistantAnonymousProps {
  return identified ? { userId, getEndUserToken: () => "end-user-token" } : {};
}
