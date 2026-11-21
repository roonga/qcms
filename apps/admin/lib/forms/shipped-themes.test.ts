import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { checkPalettes, deriveAppearance } from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { PREVIEW_THEMES } from "../preview-theme.ts";
import { SHIPPED_THEMES } from "./shipped-themes.ts";

const THEME_SHEET = fileURLToPath(
  new URL("../../../../packages/ui/src/theme.css", import.meta.url),
);

/** The accent block a shipped theme declares in the respondent sheet, light mode. */
function accentsOf(theme: string): { primary: string; secondary: string } {
  const sheet = readFileSync(THEME_SHEET, "utf8");
  const head =
    theme === "slate"
      ? "/* slate - the shipped default */"
      : `:is(:root, [data-qcms-theme-scope])[data-theme="${theme}"] {`;
  const at = sheet.indexOf(head);
  expect(at, `${theme} is not declared in the respondent sheet`).toBeGreaterThanOrEqual(0);
  const block = sheet.slice(at, sheet.indexOf("}", at));
  const read = (token: string): string => {
    const match = new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6})`, "u").exec(block);
    expect(match, `${theme} declares no --color-${token}`).not.toBeNull();
    return match?.[1] ?? "";
  };
  return { primary: read("primary"), secondary: read("secondary") };
}

const REGENERATE = "run `node scripts/build-shipped-themes.mjs`";

describe("the landed shipped themes", () => {
  it("cover every shipped theme, in the sheet's order", () => {
    expect(SHIPPED_THEMES.map((theme) => theme.key)).toEqual([...PREVIEW_THEMES]);
  });

  it("carry the accents the respondent sheet declares", () => {
    for (const theme of SHIPPED_THEMES) {
      expect(theme.accents, `${theme.key}: ${REGENERATE}`).toEqual(accentsOf(theme.key));
    }
  });

  it("are what the shared module derives from those accents", () => {
    for (const theme of SHIPPED_THEMES) {
      const derived = deriveAppearance(theme.accents);
      expect(theme.palettes, `${theme.key}: ${REGENERATE}`).toEqual(derived.palettes);
      expect(theme.face, `${theme.key}: ${REGENERATE}`).toBe(derived.face);
    }
  });

  it("pass the contrast check in all four palettes", () => {
    for (const theme of SHIPPED_THEMES) {
      expect(checkPalettes(theme.palettes as never), theme.key).toEqual([]);
    }
  });
});
