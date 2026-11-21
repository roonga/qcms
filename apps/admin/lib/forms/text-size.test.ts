import { TEXT_SIZE_MAX as CORE_MAX, TEXT_SIZE_MIN as CORE_MIN } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TEXT_SIZE,
  RESPONDENT_SCALES,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_SIZE_PRESETS,
  TEXT_SIZE_PRODUCT_CAP,
  canStepTextSize,
  cappedAtScale,
  presetSize,
  readTextSize,
  respondentTextSize,
  stepTextSize,
  textSizeMark,
} from "./text-size.ts";

describe("bounds", () => {
  it("restates core's bounds", () => {
    expect([TEXT_SIZE_MIN, TEXT_SIZE_MAX]).toEqual([CORE_MIN, CORE_MAX]);
  });

  it("offers only presets inside the bounds", () => {
    for (const preset of TEXT_SIZE_PRESETS) {
      expect(preset.px).toBeGreaterThanOrEqual(TEXT_SIZE_MIN);
      expect(preset.px).toBeLessThanOrEqual(TEXT_SIZE_MAX);
    }
    expect(presetSize("small")).toBe(TEXT_SIZE_MIN);
    expect(presetSize("medium")).toBe(DEFAULT_TEXT_SIZE);
  });

  it("reads a typed value and names why it is refused", () => {
    expect(readTextSize("21")).toEqual({ status: "ok", px: 21 });
    expect(readTextSize(" 18 ")).toEqual({ status: "ok", px: 18 });
    expect(readTextSize("")).toEqual({ status: "empty" });
    expect(readTextSize("2x")).toEqual({ status: "notANumber" });
    expect(readTextSize("18.5")).toEqual({ status: "notANumber" });
    expect(readTextSize("14")).toEqual({ status: "belowFloor" });
    expect(readTextSize("40")).toEqual({ status: "aboveCap" });
  });

  it("steps by one and stops at each bound", () => {
    expect(stepTextSize(18, 1)).toBe(19);
    expect(stepTextSize(TEXT_SIZE_MIN, -1)).toBe(TEXT_SIZE_MIN);
    expect(stepTextSize(TEXT_SIZE_MAX, 1)).toBe(TEXT_SIZE_MAX);
    expect(canStepTextSize(TEXT_SIZE_MIN, -1)).toBe(false);
    expect(canStepTextSize(TEXT_SIZE_MAX, 1)).toBe(false);
    expect(canStepTextSize(18, 1)).toBe(true);
  });
});

describe("Custom is a state, not a value", () => {
  it("marks a preset when the value is one of theirs", () => {
    expect(textSizeMark(16)).toBe("small");
    expect(textSizeMark(18)).toBe("medium");
    expect(textSizeMark(20)).toBe("large");
  });

  it("marks Custom for every other value in the bounds", () => {
    for (const px of [17, 19, 21, 22, 23, 24]) {
      expect(textSizeMark(px)).toBe("custom");
    }
  });

  it("moves the mark back onto a preset when a step lands on one", () => {
    expect(textSizeMark(stepTextSize(21, -1))).toBe("large");
  });

  it("always has exactly one mark", () => {
    for (let px = TEXT_SIZE_MIN; px <= TEXT_SIZE_MAX; px += 1) {
      expect(textSizeMark(px)).toBeTypeOf("string");
    }
  });
});

describe("the 32 px cap (Q9)", () => {
  it("multiplies the base by the respondent's scale", () => {
    expect(respondentTextSize(16, 100)).toBe(16);
    expect(respondentTextSize(16, 125)).toBe(20);
    expect(respondentTextSize(16, 150)).toBe(24);
    expect(respondentTextSize(16, 200)).toBe(32);
  });

  it("never renders above the cap", () => {
    for (const base of [16, 18, 20, 21, 24]) {
      for (const scale of RESPONDENT_SCALES) {
        expect(respondentTextSize(base, scale)).toBeLessThanOrEqual(TEXT_SIZE_PRODUCT_CAP);
      }
    }
    expect(respondentTextSize(24, 200)).toBe(TEXT_SIZE_PRODUCT_CAP);
  });

  it("names the first scale a base is capped at", () => {
    expect(cappedAtScale(16)).toBeNull();
    expect(cappedAtScale(17)).toBe(200);
    expect(cappedAtScale(22)).toBe(150);
    expect(cappedAtScale(TEXT_SIZE_MAX)).toBe(150);
  });
});
