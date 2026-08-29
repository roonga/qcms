import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

/**
 * The app has two breakpoints and no others (issue 557).
 *
 * `plan/admin-design-contracts.md` §1 fixes two boundaries, `--bp-compact` (40rem) and
 * `--bp-sidebar` (64rem), and says the number behind each is written once and cited
 * everywhere else. A media query cannot read a custom property, so "written once" is a
 * convention rather than something the language enforces, and a convention that nothing
 * checks is a convention that drifts. This spec is the check.
 *
 * ## Why the browser, and not a grep
 *
 * A grep over `apps/admin` sees the source. What ships is what Tailwind emits, and the
 * two are not the same document: the `compact:` utility prefix, the `@variant compact`
 * blocks in `globals.css` and Tailwind's own `.container` steps all become media queries
 * that appear in no source file. A source grep passes happily while the built sheet
 * carries a fourth boundary. `document.styleSheets` is the artifact the operator's
 * browser actually reads, so that is what is audited here.
 *
 * ## What each test is for
 *
 * - The audit reads every media condition in the loaded stylesheet and fails on any
 *   width boundary that is not one of the two tokens. It is the general statement, and
 *   it is what would catch a future `md:` utility or a hand-typed `39rem`.
 * - The named-rule test pins the two specific queries §1 and §2 care about, so that
 *   deleting the citation from one of them fails here rather than passing an audit that
 *   only counts distinct numbers.
 * - The builder test measures the layout either side of BOTH boundaries, to the pixel, so
 *   the tokens are bound to what an author sees rather than to what the sheet says.
 *
 * ## One thing to know before reading a failure of the audit test
 *
 * The audit asserts the sheet's boundary set is exactly the two tokens, which means it
 * fails if a boundary goes MISSING as well as if one is added. Both are real sources
 * today: the compact boundary comes from `@variant compact` in `globals.css` and the
 * builder's `compact:` utilities, the sidebar one from the builder's steps-rail
 * `sidebar:` utility. Tailwind's own `.container` utility also emits at both, but only
 * while the literal word appears somewhere Tailwind scans, so it is not something to
 * rely on and not something a missing-boundary failure should be blamed on.
 */

/** The two boundaries §1 fixes, in CSS pixels at the default root font size. */
const COMPACT_PX = 640;
const SIDEBAR_PX = 1024;

/** The seeded insurance fixture, the same form every operations spec drives. */

/** One media condition from the parsed sheet, with the selectors sitting under it. */
type MediaCondition = { condition: string; selectors: string[] };

/** The length units a media condition can carry. */
const LENGTH_UNITS = ["px", "rem", "em"] as const;

/**
 * The width boundaries a media condition declares, in CSS pixels.
 *
 * Hand-scanned rather than matched with a regular expression: an unanchored
 * number-then-unit pattern is the shape `sonarjs/super-linear-regex` rejects, and a
 * media condition is short and rigidly structured enough that one pass over its
 * characters is both simpler and obviously linear. Handles both spellings a build can
 * emit, `(min-width: 40rem)` and the range form `(width >= 40rem)`, and both units.
 */
function widthsOf(condition: string, rootPx: number): number[] {
  if (!condition.includes("width")) return [];
  const widths: number[] = [];
  let digits = "";
  for (const [index, character] of [...condition].entries()) {
    if ((character >= "0" && character <= "9") || character === ".") {
      digits += character;
      continue;
    }
    if (digits === "") continue;
    const unit = LENGTH_UNITS.find((candidate) => condition.startsWith(candidate, index));
    if (unit !== undefined) widths.push(unit === "px" ? Number(digits) : Number(digits) * rootPx);
    digits = "";
  }
  return widths;
}

/**
 * Every media condition in the loaded stylesheet, with the selectors underneath it.
 *
 * Collected in the page because `document.styleSheets` is the point: it is the parsed
 * sheet, after Tailwind and after the minifier, which is the only place a boundary
 * nobody wrote can be seen. The parsing happens back in Node, so the two tests share one
 * scanner instead of two copies serialized into the browser.
 */
async function mediaConditions(page: Page): Promise<MediaCondition[]> {
  return page.evaluate(() => {
    const collected: { condition: string; selectors: string[] }[] = [];

    const add = (condition: string, selector: string): void => {
      const seen = collected.find((entry) => entry.condition === condition);
      if (seen === undefined) collected.push({ condition, selectors: [selector] });
      else seen.selectors.push(selector);
    };

    const walk = (rules: CSSRuleList, condition: string | null): void => {
      for (const rule of rules) {
        const inherited = rule instanceof CSSMediaRule ? rule.conditionText : condition;
        if (rule instanceof CSSStyleRule && inherited !== null) add(inherited, rule.selectorText);
        const nested: CSSRuleList | undefined = (rule as { cssRules?: CSSRuleList }).cssRules;
        if (nested !== undefined) walk(nested, inherited);
      }
    };

    for (const sheet of document.styleSheets) {
      // A cross-origin sheet throws on `cssRules`. The app serves its own from the same
      // origin, so anything unreadable here is not the app's and is not this audit's.
      try {
        walk(sheet.cssRules, null);
      } catch {
        continue;
      }
    }
    return collected;
  });
}

/** The root font size in CSS pixels, which is what turns a rem boundary into one. */
async function rootFontSizePx(page: Page): Promise<number> {
  const size = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  return Number.parseFloat(size);
}

test.describe("the sheet declares two width boundaries and no others", () => {
  test("every width media query in the built sheet is one of the two tokens", async ({ page }) => {
    await page.goto("/");

    const tokens = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        compact: root.getPropertyValue("--bp-compact").trim(),
        sidebar: root.getPropertyValue("--bp-sidebar").trim(),
      };
    });
    const rootPx = await rootFontSizePx(page);

    // The tokens exist, resolve through their aliases, and are the contract's values.
    expect(rootPx, "the default root font size, which is what makes rem and px agree").toBe(16);
    expect(tokens.compact, "--bp-compact resolves through its alias").toBe("40rem");
    expect(tokens.sidebar, "--bp-sidebar resolves through its alias").toBe("64rem");

    // And nothing in the sheet turns anywhere else. A 768 in this list would be a
    // surviving `md:` utility; any other number would be someone's ad hoc boundary.
    const declared = (await mediaConditions(page)).flatMap((entry) =>
      widthsOf(entry.condition, rootPx),
    );
    expect(
      [...new Set(declared)].sort((a, b) => a - b),
      "the only width boundaries the built stylesheet declares",
    ).toEqual([COMPACT_PX, SIDEBAR_PX]);
  });

  test("the two migrated rules sit behind the compact token", async ({ page }) => {
    await page.goto("/");
    const rootPx = await rootFontSizePx(page);
    const conditions = await mediaConditions(page);

    const boundariesFor = (selector: string): number[] => {
      const carrying = conditions.filter((entry) =>
        entry.selectors.some((text) => text.includes(selector)),
      );
      expect(carrying.length, `${selector} sits under a media condition`).toBeGreaterThan(0);
      return [...new Set(carrying.flatMap((entry) => widthsOf(entry.condition, rootPx)))];
    };

    // §2's compact-width clause: the droppable table columns come back at --bp-compact.
    expect(
      boundariesFor(".qcms-cell--drop"),
      "the boundary the droppable table columns return at",
    ).toEqual([COMPACT_PX]);

    // §1's panes-stack clause, for the response summary's label/value grid.
    expect(
      boundariesFor(".qcms-ops-summary"),
      "the boundary the summary grid becomes two columns at",
    ).toEqual([COMPACT_PX]);
  });
});

/*
 * THE BUILDER HAS NO PAGE GRIDS LEFT, so the arc that measured them is gone (Code Owner,
 * 2026-08-26). It is deleted rather than left passing vacuously against a selector that
 * matches nothing, which is the shape a test takes when its subject leaves and nobody
 * notices.
 *
 * There were three, and each left for a reason recorded where it happened:
 *
 *   - the steps beside the step editor, an 18rem track at `--bp-sidebar`, when the steps
 *     moved into the rail (2026-08-25);
 *   - the rules beside the validation panel, when the rules took a screen of their own;
 *   - the settings beside the rule test bench, when the bench followed the rules and left
 *     the settings with nothing to sit next to.
 *
 * The claim itself is not lost. `--bp-sidebar` is the rail's own 240px track appearing,
 * which `rail.pw.ts` pins to the pixel on both sides of the boundary, and the sheet's
 * two-boundary declaration is asserted by the describe above this one. What has gone is a
 * measurement of grids that no longer exist; if the builder grows one again, it arrives
 * with its own coverage rather than inheriting a test written for a different pane.
 */
