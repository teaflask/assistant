// The identity pair at the type level: `userId` and `getEndUserToken`
// travel together or not at all, on the provider and the batteries root.
// Self-falsifying: loosen either prop back to a lone optional and the
// expected error stops occurring, so tsc fails on the unused directive.

import { describe, expect, it } from "vitest";

import { TeaflaskAssistant } from "../src/components/teaflask-assistant";
import { TeaflaskAssistantProvider } from "../src/components/teaflask-assistant-provider";

const vouch = () => "end-user-token";

describe("the identity pair", () => {
  it("getEndUserToken without userId does not type-check", () => {
    expect(() => {
      return (
        // @ts-expect-error -- a vouch without the user it vouches for
        <TeaflaskAssistantProvider
          publishableKey="pk"
          getEndUserToken={vouch}
        />
      );
    }).not.toThrow();
    expect(() => {
      // @ts-expect-error -- the batteries root insists the same way
      return <TeaflaskAssistant publishableKey="pk" getEndUserToken={vouch} />;
    }).not.toThrow();
  });

  it("userId without getEndUserToken does not type-check", () => {
    expect(() => {
      // @ts-expect-error -- a user nobody vouches for
      return <TeaflaskAssistantProvider publishableKey="pk" userId="user-a" />;
    }).not.toThrow();
  });

  it("both together, or neither, type-check", () => {
    expect(() => [
      <TeaflaskAssistantProvider
        key="signed-in"
        publishableKey="pk"
        userId="user-a"
        getEndUserToken={vouch}
      />,
      <TeaflaskAssistantProvider key="anonymous" publishableKey="pk" />,
      <TeaflaskAssistant
        key="root"
        publishableKey="pk"
        userId="user-a"
        getEndUserToken={vouch}
      />,
    ]).not.toThrow();
  });
});
