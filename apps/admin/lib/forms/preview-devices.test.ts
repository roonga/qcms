import { describe, expect, it } from "vitest";

import {
  DEVICE_KEYS,
  DEVICE_PRESETS,
  INITIAL_FRAME,
  RESPONSIVE_DEVICE,
  canRotate,
  deviceKind,
  frameSize,
  orientationOf,
  parseDevice,
  parseZoom,
  zoomPercent,
  type FrameState,
} from "./preview-devices.ts";

const PANE = { width: 900, height: 700 };

function frame(device: string, overrides: Partial<FrameState> = {}): FrameState {
  return { ...INITIAL_FRAME, device, ...overrides };
}

describe("the device frame", () => {
  it("fills the pane when responsive, within the fact's bounds, and cannot rotate", () => {
    expect(frameSize(INITIAL_FRAME, PANE)).toEqual(PANE);
    expect(frameSize(INITIAL_FRAME, { width: 120, height: 9_000 })).toEqual({
      width: 200,
      height: 4_000,
    });
    expect(canRotate(INITIAL_FRAME)).toBe(false);
  });

  it("takes a preset's size and swaps it when rotated", () => {
    expect(frameSize(frame("iphone-xr"), PANE)).toEqual({ width: 414, height: 896 });
    expect(frameSize(frame("iphone-xr", { rotated: true }), PANE)).toEqual({
      width: 896,
      height: 414,
    });
    expect(canRotate(frame("iphone-xr"))).toBe(true);
  });

  it("reads the orientation from the size", () => {
    expect(orientationOf({ width: 414, height: 896 })).toBe("portrait");
    expect(orientationOf({ width: 896, height: 414 })).toBe("landscape");
    expect(orientationOf({ width: 500, height: 500 })).toBe("portrait");
  });

  it("names a phone or tablet preset by its group, and anything else by its width", () => {
    const iphone = frame("iphone-se");
    expect(deviceKind(iphone, frameSize(iphone, PANE))).toBe("phone");
    const ipad = frame("ipad-pro", { rotated: true });
    expect(deviceKind(ipad, frameSize(ipad, PANE))).toBe("tablet");
    const compact = frame("compact-edge");
    expect(deviceKind(compact, frameSize(compact, PANE))).toBe("tablet");
    const rail = frame("rail-edge");
    expect(deviceKind(rail, frameSize(rail, PANE))).toBe("desktop");
    expect(deviceKind(INITIAL_FRAME, { width: 390, height: 700 })).toBe("phone");
  });

  it("fits the frame to the pane's width, never above 100, and holds a fixed zoom", () => {
    const tablet = frame("ipad-pro");
    expect(zoomPercent(tablet, frameSize(tablet, PANE), PANE)).toBe(87);
    const phone = frame("iphone-se");
    expect(zoomPercent(phone, frameSize(phone, PANE), PANE)).toBe(100);
    const fixed = frame("ipad-pro", { zoom: "150" });
    expect(zoomPercent(fixed, frameSize(fixed, PANE), PANE)).toBe(150);
    const tiny = frame("rail-edge");
    expect(zoomPercent(tiny, frameSize(tiny, PANE), { width: 100, height: 100 })).toBe(25);
  });

  it("falls back for an unknown device or zoom", () => {
    expect(parseDevice("nokia")).toBe(RESPONSIVE_DEVICE);
    expect(parseDevice("pixel-7")).toBe("pixel-7");
    expect(parseZoom("33")).toBe("fit");
    expect(parseZoom("75")).toBe("75");
  });

  it("keys every preset uniquely", () => {
    expect(new Set(DEVICE_KEYS).size).toBe(DEVICE_PRESETS.length + 1);
  });
});
