import type { Appearance } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { shippedThemeOptions } from "../server/appearance-options.ts";
import {
  DEFAULT_CORNERS,
  DEFAULT_DENSITY,
  DEFAULT_PROGRESS,
  appearanceFromTheme,
  currentThemeKey,
  sameAppearance,
  shippedThemeKey,
  themeSwatch,
  workspaceThemeKey,
  type ThemeOption,
} from "./appearance-edit.ts";
import { DEFAULT_TEXT_SIZE } from "./text-size.ts";

const SHIPPED = shippedThemeOptions();

function dressed(key: string, from: ThemeOption | undefined): ThemeOption {
  if (from === undefined) throw new Error("the shipped themes are missing an option");
  return { ...from, key, name: key, face: "lexend", corners: "pill", pageTint: true };
}

const PLUM = dressed(
  shippedThemeKey("plum"),
  SHIPPED.find((theme) => theme.key === shippedThemeKey("plum")),
);
const HARBOR = dressed(
  workspaceThemeKey("thm_1"),
  SHIPPED.find((theme) => theme.key === shippedThemeKey("harbor")),
);
const SAND = dressed(
  "other",
  SHIPPED.find((theme) => theme.key === shippedThemeKey("sand")),
);

describe("applying a theme", () => {
  it("takes the look from the theme and the defaults for the rest", () => {
    const applied = appearanceFromTheme(PLUM, null);
    expect(applied.palettes).toEqual(PLUM.palettes);
    expect(applied.face).toBe("lexend");
    expect(applied.corners).toBe("pill");
    expect(applied.pageTint).toBe(true);
    expect(applied.density).toBe(DEFAULT_DENSITY);
    expect(applied.progress).toBe(DEFAULT_PROGRESS);
    expect(applied.textSize).toBe(DEFAULT_TEXT_SIZE);
  });

  it("leaves density, text size and progress where the author put them", () => {
    const base: Appearance = {
      ...appearanceFromTheme(PLUM, null),
      density: "compact",
      textSize: 22,
      progress: "side-rail",
    };
    const applied = appearanceFromTheme(HARBOR, base);
    expect(applied.palettes).toEqual(HARBOR.palettes);
    expect(applied.density).toBe("compact");
    expect(applied.textSize).toBe(22);
    expect(applied.progress).toBe("side-rail");
  });
});

describe("the current theme", () => {
  it("names the theme whose palettes the appearance carries", () => {
    const applied = appearanceFromTheme(HARBOR, null);
    expect(currentThemeKey(applied, [PLUM, HARBOR])).toBe(HARBOR.key);
  });

  it("names none for the deployment's look or for colours of its own", () => {
    expect(currentThemeKey(null, [PLUM, HARBOR])).toBeUndefined();
    expect(currentThemeKey(appearanceFromTheme(SAND, null), [PLUM, HARBOR])).toBeUndefined();
  });
});

describe("comparison and the chip", () => {
  it("treats the deployment's look as equal only to itself", () => {
    const applied = appearanceFromTheme(PLUM, null);
    expect(sameAppearance(null, null)).toBe(true);
    expect(sameAppearance(null, applied)).toBe(false);
    expect(sameAppearance(applied, { ...applied })).toBe(true);
    expect(sameAppearance(applied, { ...applied, textSize: 20 })).toBe(false);
  });

  it("shows the accent, the page and the ink of the light palette", () => {
    expect(themeSwatch(PLUM.palettes)).toEqual([
      PLUM.palettes.light.primary,
      PLUM.palettes.light.background,
      PLUM.palettes.light.text,
    ]);
  });

  it("defaults corners to the base block, which takes no class", () => {
    expect(DEFAULT_CORNERS).toBe("subtle");
  });
});
