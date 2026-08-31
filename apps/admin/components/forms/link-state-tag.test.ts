import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { LinkState } from "@/lib/forms/types";

/**
 * Contrast evidence for the four secure-link state tints, computed from the shipped
 * stylesheets (issue #276, carried out of task 034).
 *
 * ## Why this is the right layer, and end-to-end fixtures are not
 *
 * `LinkStateTag` is state-generic: one markup path, one class per state
 * (`qcms-tag--link-${state}`), and the state is always spelled out as text, so colour
 * is never the only signal (WCAG 1.4.1). Task 034's screenshot gate and the axe sweep
 * therefore exercise the same structure whichever states they happen to render, and
 * reaching **Consumed** and **Expired** end to end needs a respondent session and a
 * clock. The PO seat ruled against building that machinery, because there is no fourth
 * code path waiting to fail.
 *
 * What was genuinely missing is what this file supplies: the four tints have contrast
 * evidence in none of the three modes. That is checkable from the CSS without a
 * browser, without a respondent and without time travel, exactly the way task 051
 * computed contrast across twelve theme/mode combinations
 * (`packages/ui/src/theme-tokens.test.ts`).
 *
 * ## What is read, and what that buys
 *
 * Both halves come off disk. `app/globals.css` supplies the MAPPING (which semantic
 * token family each state wears), so re-pointing `consumed` at the danger family is a
 * change this test sees rather than one it assumes; `app/theme.css` supplies the
 * VALUES, so a palette edit that drops a pair below its floor fails here. Neither is
 * restated in this file, which is the property that keeps it honest: a copy of the
 * numbers would certify itself.
 *
 * ## Floors
 *
 * The same targets `theme-tokens.test.ts` uses: Light and Dark are the AA layer at
 * 4.5:1 for text, high contrast is the AAA layer at 7:1. The border is checked in high
 * contrast only, and at the UI floor of 3:1, because that is the one mode where it does
 * work: `:root.hc .qcms-tag` swaps the tint border for `--color-border-strong` precisely
 * because the subtle backgrounds collapse toward the page background there. In light and
 * dark the border is the tint itself and differentiates nothing, which is why the word
 * carries the state in every mode.
 */

const ADMIN_APP = join(import.meta.dirname, "..", "..", "app");
const GLOBALS_CSS = readFileSync(join(ADMIN_APP, "globals.css"), "utf8");
const THEME_CSS = readFileSync(join(ADMIN_APP, "theme.css"), "utf8");

/** Every state the badge can be in, as the union spells them. */
const STATES: readonly LinkState[] = ["active", "consumed", "expired", "revoked"];

/** The sheet's three mode layers. Light is the bare `:root`, so it has no class. */
const MODES = [
  { name: "light", selector: ":root", textFloor: 4.5 },
  { name: "dark", selector: ":root.dark", textFloor: 4.5 },
  { name: "high contrast", selector: ":root.hc", textFloor: 7 },
] as const;

/** WCAG 1.4.11, for the high-contrast border that carries the differentiation there. */
const UI_FLOOR = 3;

/** The declarations of one top-level rule, by selector, from a flat token sheet. */
function declarationsOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `no \`${selector}\` block in the sheet`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const declarations: Record<string, string> = {};
  // Split rather than matched: these blocks are one flat `name: value;` per line, and a
  // regex over the pair trips `sonarjs/super-linear-regex` for no benefit here.
  for (const line of css.slice(open + 1, close).split("\n")) {
    const at = line.indexOf(":");
    if (at === -1 || !line.trimEnd().endsWith(";")) continue;
    declarations[line.slice(0, at).trim()] = line.slice(at + 1, line.lastIndexOf(";")).trim();
  }
  return declarations;
}

/**
 * The token a `qcms-tag--link-*` rule assigns to one property, e.g.
 * `--color-success-subtle` for `active`'s `background-color`.
 *
 * Read from `globals.css` rather than restated here, so re-pointing a state at another
 * semantic family is a change this test follows instead of one it silently agrees with.
 */
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

/** A `#rrggbb` token value, resolved in one mode layer (light is the base). */
function colorIn(mode: (typeof MODES)[number]["selector"], token: string): string {
  const base = declarationsOf(THEME_CSS, ":root");
  const layer = mode === ":root" ? base : { ...base, ...declarationsOf(THEME_CSS, mode) };
  const value = layer[token];
  expect(value, `${token} is undefined in ${mode}`).toMatch(/^#[0-9a-f]{6}$/i);
  return value as string;
}

/** WCAG 2.x relative luminance of an opaque `#rrggbb`. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/** The WCAG 2.2 contrast ratio of two opaque colours, 1:1 to 21:1. */
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
    // `:root.hc .qcms-tag` overrides the tint border with the universal strong-border
    // token, so THAT is the pair to measure here - not the `border-color` the state rule
    // declares, which high contrast has already replaced.
    const border = colorIn(":root.hc", "--color-border-strong");
    const background = colorIn(":root.hc", tokenFor(state, "background-color"));
    const ratio = contrast(border, background);

    expect(
      ratio,
      `qcms-tag--link-${state} in high contrast: border ${border} on ${background} is ${ratio.toFixed(2)}:1, under the ${String(UI_FLOOR)}:1 floor`,
    ).toBeGreaterThanOrEqual(UI_FLOOR);
  });

  it("measures every state the union declares, so a new one cannot be added unmeasured", () => {
    // The union is the source of truth for how many badges exist; the sweep above is
    // driven from it. This pins the count so a fifth state added to `LinkState` without
    // a tint (or with an unmeasured one) shows up here rather than shipping unchecked.
    const declared = [...GLOBALS_CSS.matchAll(/\.qcms-tag--link-([\w-]+)\s*\{/g)].map(
      (match) => match[1],
    );
    expect(new Set(declared)).toEqual(new Set(STATES));
  });
});
