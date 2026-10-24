// The browser suite measures what these rules do; what it cannot show is the claims
// about what the blocks may not contain, each of them a state the portal does not
// render on the happy path or a property whose absence is the decision:
//
//  - no `forced-color-adjust`, because every colour that carries meaning has a
//    system-colour pair and opting an element out only takes the user's choice away;
//  - only system colours under forced colours, because anything else is forced away
//    and the rule silently stops doing anything rather than erroring;
//  - the `prefers-contrast` block moves edges and rings and nothing else, since it
//    runs with the palette intact and a `--color-*` or `--type-*` token there could
//    lower a pair or a floor that is asserted only against the base blocks;
//  - an invalid control keeps its danger edge, rather than trading the error signal
//    for a contrast step.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = readFileSync(join(import.meta.dirname, "theme-components.css"), "utf8");

/** Brace-matched, because the block contains rule bodies of its own. */
function mediaBlock(css: string, condition: string): string {
  const header = `@media (${condition})`;
  const start = css.indexOf(header);
  expect(start, `no ${header} block in theme-components.css`).toBeGreaterThan(-1);
  expect(
    css.indexOf(header, start + 1),
    `more than one ${header} block: the contrast story must have one home`,
  ).toBe(-1);
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(css.indexOf("{", start) + 1, index);
    }
  }
  throw new Error(`unterminated ${header} block`);
}

function declarations(block: string): readonly { property: string; value: string }[] {
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//gu, "");
  const bodies = [...withoutComments.matchAll(/\{([^{}]*)\}/gu)].map((match) => match[1] ?? "");
  return bodies.flatMap((body) =>
    body
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        const split = entry.indexOf(":");
        return { property: entry.slice(0, split).trim(), value: entry.slice(split + 1).trim() };
      }),
  );
}

/** Split rather than matched, because that pattern is the shape the lint refuses. */
function selectors(block: string): readonly string[] {
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//gu, "");
  return withoutComments
    .split("}")
    .map((chunk) => (chunk.split("{")[0] ?? "").trim().replace(/\s+/gu, " "))
    .filter((selector) => selector.length > 0);
}

/**
 * The subset this sheet uses rather than the whole CSS list, so a new keyword arrives
 * with the rule that needs it and the reason it is the right pair.
 */
const SYSTEM_COLORS = ["Canvas", "CanvasText", "Highlight", "HighlightText", "GrayText"];

const COLOR_PROPERTIES = ["color", "background-color", "border-color", "outline-color", "fill"];

const FORCED = mediaBlock(COMPONENTS_CSS, "forced-colors: active");
const MORE = mediaBlock(COMPONENTS_CSS, "prefers-contrast: more");

describe("forced-colors: active", () => {
  it("reads the disabled state off the element react-aria marks", () => {
    // Asserted at the stylesheet level because no fixture renders a disabled vendored
    // control: nothing in the renderer ever passes `isDisabled`.
    const disabled = selectors(FORCED).filter((selector) => selector.includes("data-disabled"));
    expect(disabled.length).toBeGreaterThan(0);
    const onTheLabel = disabled.filter((selector) =>
      selector.includes("label[data-rac][data-disabled]"),
    );
    expect(onTheLabel, "the option row's state is not read off its label root").not.toHaveLength(0);
    for (const selector of disabled) {
      expect(
        selector.includes("label[data-rac] > div"),
        `${selector} tests the indicator for an attribute react-aria never puts there`,
      ).toBe(false);
    }
  });

  it("names only system colours, so no declaration is silently forced away", () => {
    const colorDeclarations = declarations(FORCED).filter((declaration) =>
      COLOR_PROPERTIES.includes(declaration.property),
    );
    expect(colorDeclarations.length).toBeGreaterThan(0);
    for (const declaration of colorDeclarations) {
      expect(
        SYSTEM_COLORS,
        `${declaration.property}: ${declaration.value} is not a system colour`,
      ).toContain(declaration.value);
    }
  });

  it("draws its focus ring as an outline, never as a shadow", () => {
    const outline = declarations(FORCED).filter(
      (declaration) => declaration.property === "outline",
    );
    expect(outline.length).toBeGreaterThan(0);
    for (const declaration of outline) {
      const keyword = declaration.value.split(/\s+/u).at(-1) ?? "";
      expect(SYSTEM_COLORS).toContain(keyword);
    }
    expect(declarations(FORCED).map((declaration) => declaration.property)).not.toContain(
      "box-shadow",
    );
  });

  it("never uses forced-color-adjust", () => {
    // Declarations only: the sheet's own comment explains why the property is absent,
    // and a guard that matched prose would fail on its own reasoning.
    const withoutComments = COMPONENTS_CSS.replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(withoutComments).not.toContain("forced-color-adjust");
  });
});

describe("prefers-contrast: more", () => {
  it("moves border colours and focus rings and nothing else", () => {
    const allowed = new Set(["border-color", "outline", "outline-offset", "outline-width"]);
    const seen = declarations(MORE);
    expect(seen.length).toBeGreaterThan(0);
    for (const declaration of seen) {
      expect(allowed, `${declaration.property} is not an edge or a ring`).toContain(
        declaration.property,
      );
    }
  });

  it("steps onto the stronger half of an authored pair, never onto a new value", () => {
    const allowed = ["var(--color-border-strong)", "var(--color-focus-ring)"];
    for (const declaration of declarations(MORE)) {
      if (declaration.property === "border-color") {
        expect(allowed).toContain(declaration.value);
      }
      if (declaration.property === "outline") {
        expect(declaration.value).toBe("3px solid var(--color-focus-ring)");
      }
    }
  });

  it("leaves an invalid control's danger edge alone", () => {
    const edgeRules = selectors(MORE).filter((selector) => selector.includes("[data-qcms-field]"));
    expect(edgeRules.length).toBeGreaterThan(1);
    for (const selector of edgeRules) {
      // By shape rather than by literal, because the element carrying the invalid
      // state is not always the one drawing the edge.
      expect(selector, `${selector} would flatten an invalid control's edge`).toMatch(
        /:not\([^)]*\[data-invalid\][^)]*\)/u,
      );
    }
  });

  it("steps the UNSELECTED option indicator up, and only that one", () => {
    // The rule has to reach the indicator and leave the three states whose edge colour
    // is the state itself; without it they stayed near 1.5:1.
    const indicator = selectors(MORE).filter((selector) => selector.includes("label[data-rac]"));
    expect(indicator, "no rule steps the option indicator's edge up").toHaveLength(1);
    for (const state of ["[data-selected]", "[data-indeterminate]", "[data-invalid]"]) {
      expect(indicator[0], `${state} must keep its own edge colour`).toContain(state);
    }
    expect(indicator[0]).toContain("> div");
  });
});
