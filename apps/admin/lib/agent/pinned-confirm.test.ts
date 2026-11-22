import { describe, expect, it } from "vitest";

import { pinsDecision } from "./pinned-confirm.ts";

const open = { waiting: true, typedConfirmation: false } as const;

describe("the panel's pinned decision", () => {
  it("pins where a waiting card is taller than the conversation", () => {
    expect(pinsDecision({ ...open, cardHeight: 900, viewHeight: 400 })).toBe(true);
  });

  it("leaves a card that fits to its own Confirm", () => {
    expect(pinsDecision({ ...open, cardHeight: 300, viewHeight: 400 })).toBe(false);
    expect(pinsDecision({ ...open, cardHeight: 400, viewHeight: 400 })).toBe(false);
  });

  it("pins nothing once the card is no longer waiting", () => {
    expect(pinsDecision({ ...open, waiting: false, cardHeight: 900, viewHeight: 400 })).toBe(false);
  });

  it("pins nothing where the card asks for a typed confirmation", () => {
    expect(
      pinsDecision({ ...open, typedConfirmation: true, cardHeight: 900, viewHeight: 400 }),
    ).toBe(false);
  });

  it("pins nothing before either box has been measured", () => {
    expect(pinsDecision({ ...open, cardHeight: 900, viewHeight: 0 })).toBe(false);
    expect(pinsDecision({ ...open, cardHeight: 0, viewHeight: 400 })).toBe(false);
  });
});
