import { describe, expect, it } from "vitest";

import type { FormSettings } from "./types.ts";

import { hasSettingsChange, settingsPatch } from "./settings.ts";

const DEFAULTS: FormSettings = { challengeRequired: false, minSubmitMs: null };

describe("the settings patch carries only what changed", () => {
  it("is empty when the drafted settings match the stored ones", () => {
    const patch = settingsPatch(DEFAULTS, { challengeRequired: false, minSubmitMs: null });

    expect(patch).toStrictEqual({});
    expect(hasSettingsChange(patch)).toBe(false);
  });

  it("sends one key when one switch moved, and leaves the other alone", () => {
    const patch = settingsPatch(DEFAULTS, { challengeRequired: true, minSubmitMs: null });

    expect(patch).toStrictEqual({ challengeRequired: true });
    expect(hasSettingsChange(patch)).toBe(true);
  });

  it("sends both keys when both moved", () => {
    const patch = settingsPatch(DEFAULTS, { challengeRequired: true, minSubmitMs: 800 });

    expect(patch).toStrictEqual({ challengeRequired: true, minSubmitMs: 800 });
  });

  it("treats a cleared override as a value to send, not as a key to drop", () => {
    const patch = settingsPatch({ challengeRequired: false, minSubmitMs: 800 }, DEFAULTS);

    expect(patch).toStrictEqual({ minSubmitMs: null });
    expect("minSubmitMs" in patch).toBe(true);
  });

  it("sends a zero override, which is falsy and must not be mistaken for absent", () => {
    const patch = settingsPatch(DEFAULTS, { challengeRequired: false, minSubmitMs: 0 });

    expect(patch).toStrictEqual({ minSubmitMs: 0 });
    expect(hasSettingsChange(patch)).toBe(true);
  });
});
