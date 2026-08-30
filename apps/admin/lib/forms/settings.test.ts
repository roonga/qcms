import { describe, expect, it } from "vitest";

import type { FormSettings } from "./types.ts";

import { hasSettingsChange, settingsPatch } from "./settings.ts";

/**
 * The patch the settings autosave sends.
 *
 * This used to be a private helper inside `FormSettingsPanel`, where its only exercise was
 * a button press in a browser. The settings autosave now runs off it on a debounce, so the
 * two properties it has always had are the ones the loop depends on and are asserted here:
 * an unchanged settings pair produces nothing to send, and `null` is a value.
 *
 * The empty case is the load-bearing one. `UpdateFormSettingsBody` refuses a body carrying
 * neither key, so a patch that reported "changed" when nothing had would turn every
 * settled render into a 400, and a patch that reported "unchanged" after a real edit would
 * lose the edit silently.
 */

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
    // `null` means "use the deployment's floor". Dropping the key would mean "leave the
    // override where it was", which is the opposite instruction.
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
