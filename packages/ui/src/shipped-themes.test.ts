// The data is hand-held rather than generated, so every value is pinned here: the accents to
// `theme.css`, the palettes and the face to the core appearance module, and the whole set to the
// contrast check. A hand edit fails rather than drifts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkPalettes, deriveAppearance } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { SHIPPED_THEMES } from "./shipped-themes.ts";

const THEME_CSS = readFileSync(join(import.meta.dirname, "theme.css"), "utf8");

const DEFAULT_THEME_HEAD = "/* slate - the shipped default */";

/** The sheet's own order: the default first, then each `data-theme` block as it is declared. */
function themesInSheet(): readonly string[] {
  const keys = ["slate"];
  for (const match of THEME_CSS.matchAll(/\[data-theme="([a-z]+)"\]\s*\{/gu)) {
    const key = match[1] ?? "";
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function accentsOf(theme: string): { primary: string; secondary: string } {
  const head =
    theme === "slate"
      ? DEFAULT_THEME_HEAD
      : `:is(:root, [data-qcms-theme-scope])[data-theme="${theme}"] {`;
  const at = THEME_CSS.indexOf(head);
  expect(at, `${theme} is not declared in the sheet`).toBeGreaterThanOrEqual(0);
  const block = THEME_CSS.slice(at, THEME_CSS.indexOf("}", at));
  const read = (token: string): string => {
    const match = new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`, "u").exec(block);
    expect(match, `${theme} declares no --color-${token}`).not.toBeNull();
    return match?.[1] ?? "";
  };
  return { primary: read("primary"), secondary: read("secondary") };
}

describe("the shipped themes as data", () => {
  it("cover every theme the sheet declares, in the sheet's order", () => {
    expect(SHIPPED_THEMES.map((theme) => theme.key)).toEqual([...themesInSheet()]);
  });

  it("carry the accents the sheet declares", () => {
    for (const theme of SHIPPED_THEMES) {
      expect(theme.accents, theme.key).toEqual(accentsOf(theme.key));
    }
  });

  it("are what the shared appearance module derives from those accents", () => {
    for (const theme of SHIPPED_THEMES) {
      const derived = deriveAppearance(theme.accents);
      expect(theme.palettes, theme.key).toEqual(derived.palettes);
      expect(theme.face, theme.key).toBe(derived.face);
    }
  });

  it("pass the contrast check in all four palettes", () => {
    for (const theme of SHIPPED_THEMES) {
      expect(checkPalettes(theme.palettes as never), theme.key).toEqual([]);
    }
  });
});
