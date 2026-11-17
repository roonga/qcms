import { describe, expect, it } from "vitest";

import { worstExit } from "./check-vendor.mjs";

describe("worstExit", () => {
  it("fails when only the second gate fails", () => {
    expect(worstExit([0, 1])).toBe(1);
  });

  it("fails when only the first gate fails", () => {
    expect(worstExit([1, 0])).toBe(1);
  });

  it("passes when both pass", () => {
    expect(worstExit([0, 0])).toBe(0);
  });
});
