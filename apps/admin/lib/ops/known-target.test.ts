import { describe, expect, it } from "vitest";

import { knownTargetStep } from "./known-target.ts";

function found(alreadyErased: boolean) {
  return {
    status: "found" as const,
    scope: { sessionId: "ses_a", environment: "prod", alreadyErased, otherEnvironments: [] },
  };
}

describe("the known-target erasure journey", () => {
  it("asks for an id until one has been looked up", () => {
    expect(knownTargetStep(null, false)).toBe("ask");
  });

  it("offers the act only for a session that exists and is not yet erased", () => {
    expect(knownTargetStep(found(false), false)).toBe("erasable");
    expect(knownTargetStep(found(true), false)).toBe("alreadyErased");
    expect(knownTargetStep({ status: "missing" }, false)).toBe("missing");
    expect(knownTargetStep({ status: "error", message: "x" }, false)).toBe("failed");
  });

  it("is erased once this visit's erasure is recorded, whatever the lookup said", () => {
    expect(knownTargetStep(found(false), true)).toBe("erased");
  });
});
