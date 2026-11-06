import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PWA_ACCENT_COLOR,
  PWA_GROUND_COLOR,
  PWA_MARK_COLOR,
  PWA_PAGE_COLOR_DARK,
  PWA_PAGE_COLOR_LIGHT,
} from "./brand";

const SHEET = readFileSync(fileURLToPath(new URL("../../app/theme.css", import.meta.url)), "utf8");

function token(selector: string, name: string): string | undefined {
  const block = new RegExp(`^${selector.replace(".", "\\.")} \\{([\\s\\S]*?)^\\}`, "m").exec(SHEET);
  if (block?.[1] === undefined) return undefined;
  return new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(block[1])?.[1]?.trim();
}

describe("the colours the manifest and the generated icons carry", () => {
  it("names the modes the sheet actually declares", () => {
    expect(token(":root", "--color-background")).toBeDefined();
    expect(token(":root.dark", "--color-background")).toBeDefined();
  });

  it("takes each page colour from its mode in the token sheet", () => {
    expect(PWA_PAGE_COLOR_LIGHT).toBe(token(":root", "--color-background"));
    expect(PWA_PAGE_COLOR_DARK).toBe(token(":root.dark", "--color-background"));
    expect(PWA_GROUND_COLOR).toBe(token(":root.dark", "--color-background"));
  });

  it("takes the accent and the mark from the primary of their mode", () => {
    expect(PWA_ACCENT_COLOR).toBe(token(":root", "--color-primary"));
    expect(PWA_MARK_COLOR).toBe(token(":root.dark", "--color-primary"));
  });
});
