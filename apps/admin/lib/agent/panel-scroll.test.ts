import { describe, expect, it } from "vitest";

import { revealOffset } from "./panel-scroll.ts";

describe("where the panel leaves an item it has just been handed", () => {
  it("stays put when the whole item is already in view", () => {
    expect(revealOffset(120, 400, 700)).toBe(0);
  });

  it("scrolls far enough to show the foot, and no further", () => {
    expect(revealOffset(650, 1100, 700)).toBe(400);
  });

  it("stops at the item's own top when the item is taller than the panel", () => {
    expect(revealOffset(300, 1600, 700)).toBe(300);
  });

  it("scrolls back up to bring an item above the fold into view", () => {
    expect(revealOffset(-80, 200, 700)).toBe(-80);
  });
});
