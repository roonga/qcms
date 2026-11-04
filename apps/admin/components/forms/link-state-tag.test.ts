import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { LinkState } from "@/lib/forms/types";

const ADMIN_APP = join(import.meta.dirname, "..", "..", "app");
const GLOBALS_CSS = readFileSync(join(ADMIN_APP, "globals.css"), "utf8");
const THEME_CSS = readFileSync(join(ADMIN_APP, "theme.css"), "utf8");

const STATES: readonly LinkState[] = ["active", "consumed", "expired", "revoked"];

const MODES = [
  { name: "light", selector: ":root", textFloor: 4.5 },
  { name: "dark", selector: ":root.dark", textFloor: 4.5 },
  { name: "high contrast", selector: ":root.hc", textFloor: 7 },
] as const;

const UI_FLOOR = 3;

function declarationsOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `no \`${selector}\` block in the sheet`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const declarations: Record<string, string> = {};
  for (const line of css.slice(open + 1, close).split("\n")) {
    const at = line.indexOf(":");
    if (at === -1 || !line.trimEnd().endsWith(";")) continue;
    declarations[line.slice(0, at).trim()] = line.slice(at + 1, line.lastIndexOf(";")).trim();
  }
  return declarations;
}

function tokenFor(state: LinkState, property: string): string {
  const rule = declarationsOf(GLOBALS_CSS, `.qcms-tag--link-${state}`);
  const value = rule[property];
  expect(value, `.qcms-tag--link-${state} declares no ${property}`).toBeDefined();
  const token = /^var\((--[\w-]+)\)$/.exec(value ?? "")?.[1];
  expect(
    token,
    `.qcms-tag--link-${state}'s ${property} is not a single token reference`,
  ).toBeTypeOf("string");
  return token as string;
}

function colorIn(mode: (typeof MODES)[number]["selector"], token: string): string {
  const base = declarationsOf(THEME_CSS, ":root");
  const layer = mode === ":root" ? base : { ...base, ...declarationsOf(THEME_CSS, mode) };
  const value = layer[token];
  expect(value, `${token} is undefined in ${mode}`).toMatch(/^#[0-9a-f]{6}$/i);
  return value as string;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

describe("the four secure-link state tints have contrast evidence in all three modes", () => {
  const cases = MODES.flatMap((mode) => STATES.map((state) => ({ mode, state })));

  it.each(cases)("$state reads against its own tint in $mode.name", ({ mode, state }) => {
    const foreground = colorIn(mode.selector, tokenFor(state, "color"));
    const background = colorIn(mode.selector, tokenFor(state, "background-color"));
    const ratio = contrast(foreground, background);

    expect(
      ratio,
      `qcms-tag--link-${state} in ${mode.name}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, under the ${String(mode.textFloor)}:1 floor`,
    ).toBeGreaterThanOrEqual(mode.textFloor);
  });

  it.each(STATES)("%s keeps a visible edge in high contrast, where the tint cannot", (state) => {
    // Measure the universal strong border in high contrast; it overrides the state tint's declared border.
    const border = colorIn(":root.hc", "--color-border-strong");
    const background = colorIn(":root.hc", tokenFor(state, "background-color"));
    const ratio = contrast(border, background);

    expect(
      ratio,
      `qcms-tag--link-${state} in high contrast: border ${border} on ${background} is ${ratio.toFixed(2)}:1, under the ${String(UI_FLOOR)}:1 floor`,
    ).toBeGreaterThanOrEqual(UI_FLOOR);
  });

  it("measures every state the union declares, so a new one cannot be added unmeasured", () => {
    const declared = [...GLOBALS_CSS.matchAll(/\.qcms-tag--link-([\w-]+)\s*\{/g)].map(
      (match) => match[1],
    );
    expect(new Set(declared)).toEqual(new Set(STATES));
  });
});
