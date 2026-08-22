import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Which screens carry the §7 rail, checked against the route tree rather than claimed
 * (issue 561).
 *
 * Issue 559 built the rail and wired one screen; 561 rolls it across the rest. "All eight
 * form-subtree screens carry the rail" is the acceptance, and a sentence in a PR body is
 * not a mechanism: a ninth form-scoped screen added next quarter would inherit no rail and
 * nobody would be asked about it. So the pairing is read off the filesystem here, the same
 * way `measure.test.ts` reads the cap table against the route tree, and a screen without a
 * slot fails this file until someone either wires it or writes it into the exception list
 * below with a reason.
 *
 * ## The builder is the one exception, and it is a real open question
 *
 * `plan/admin-ux-audit.md` row 5 gives the builder a rail and calls it the screen the
 * whole design language was drawn for, so its absence here is not a verdict against the
 * rail. It is an unresolved collision, and issue 561 escalated it rather than settling it:
 *
 * - The builder already carries a step list, and that list is an EDITOR
 *   (`components/forms/steps-rail.tsx`): its rows are buttons, they select a step inside
 *   the page, and they carry add, rename, move and remove. §7's children group is the same
 *   steps as read-only anchors. Two step lists on one screen would disagree about what a
 *   step row is, and folding the editor's commands into the rail breaks §7's "never
 *   carries actions" outright.
 * - The counts would be two counts of overlapping sets on one screen, which is exactly the
 *   defect `plan/admin-ux-audit.md` §1 flags in the POC. The rail's badges come from a
 *   dry-run validation of the STORED draft at render time (`lib/server/form-rail.ts`); the
 *   validation panel, which §5.6 makes the single authoritative issue count, counts the
 *   WORKING draft and refreshes on a debounce as the author types. On the seven screens
 *   wired here there is no panel, so the rail is the only count on screen and the two can
 *   never disagree in front of anyone. On the builder they would diverge on the first
 *   keystroke.
 *
 * Resolving that is a layout ruling about the builder, not a wiring job, so the row stays
 * here until one is recorded.
 */

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

/**
 * The form-scoped screens with no rail, and why.
 *
 * An entry is a decision that has been written down, not a to-do list. Adding one is how a
 * future screen opts out; the reason is the whole value of the entry.
 */
const RAIL_EXCEPTIONS: Readonly<Record<string, string>> = {
  "/forms/[formId]":
    "the builder carries an editing step list of its own; reconciling it with §7 is an open layout ruling",
};

/**
 * Which sibling row each slot marks as current, restated rather than derived.
 *
 * A table read out of the files it is checking passes on any files, which is the same
 * reason `subtree-rail.test.ts` restates §7's section list instead of importing it. The
 * two detail routes are the rows worth reading twice: neither is a row of the rail, so
 * each marks the section it lives under, and `components/forms/form-tabs.tsx` has resolved
 * those same two URLs to those same two sections since task 034.
 */
const CURRENT_SECTION: Readonly<Record<string, string>> = {
  "/forms/[formId]/preview": "preview",
  "/forms/[formId]/versions": "versions",
  "/forms/[formId]/versions/[version]": "versions",
  "/forms/[formId]/links": "links",
  "/forms/[formId]/responses": "responses",
  "/forms/[formId]/responses/[sessionId]": "responses",
  "/forms/[formId]/webhooks": "webhooks",
};

/**
 * Every Next route pattern under one directory, read from the tree.
 *
 * The same walk `measure.test.ts` makes, minus its slot skip: here the slot tree is the
 * subject rather than the thing being excluded, so the walk is pointed at one root or the
 * other and route groups still contribute no segment.
 */
function routePatternsUnder(directory: string, prefix: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const patterns = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [prefix]
    : [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("@")) continue;
    const segment = entry.name.startsWith("(") ? prefix : `${prefix}/${entry.name}`;
    patterns.push(...routePatternsUnder(`${directory}/${entry.name}`, segment));
  }
  return patterns;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** The screens under one form: everything below `/forms/[formId]`, and that route itself. */
function formScopedScreens(): string[] {
  return routePatternsUnder(`${SHELL}/forms`, "/forms").filter((pattern) =>
    pattern.startsWith("/forms/[formId]"),
  );
}

/** The routes the `@rail` slot answers for. */
function railSlotRoutes(): string[] {
  return routePatternsUnder(`${SHELL}/@rail/forms`, "/forms");
}

describe("which screens carry the form-subtree rail", () => {
  it("counts the eight form-scoped screens the audit counts", () => {
    // `plan/admin-ux-audit.md` §1: "of the sixteen authenticated screens, eight are
    // form-scoped and would get a populated rail". A ninth appearing is the moment the
    // rail question has to be asked again, so it fails here.
    expect(sorted(formScopedScreens())).toEqual([
      "/forms/[formId]",
      "/forms/[formId]/links",
      "/forms/[formId]/preview",
      "/forms/[formId]/responses",
      "/forms/[formId]/responses/[sessionId]",
      "/forms/[formId]/versions",
      "/forms/[formId]/versions/[version]",
      "/forms/[formId]/webhooks",
    ]);
  });

  it("gives every form-scoped screen a rail except the ones written down as exceptions", () => {
    const expected = formScopedScreens().filter(
      (pattern) => !Object.hasOwn(RAIL_EXCEPTIONS, pattern),
    );
    expect(sorted(railSlotRoutes())).toEqual(sorted(expected));
  });

  it("keeps the exception list to the builder, with its reason attached", () => {
    expect(Object.keys(RAIL_EXCEPTIONS)).toEqual(["/forms/[formId]"]);
    expect(RAIL_EXCEPTIONS["/forms/[formId]"]).toContain("open layout ruling");
  });

  it("puts no rail on a screen outside one form's subtree", () => {
    // §7a is explicit that the exception for Settings "does not generalise" and that the
    // other eight authenticated screens would get an empty rail or one duplicating their
    // own body. The slot tree holding nothing but `forms/` is that clause, checked.
    const slotRoot = readdirSync(`${SHELL}/@rail`, { withFileTypes: true });
    expect(
      sorted(slotRoot.filter((entry) => entry.isDirectory()).map((entry) => entry.name)),
    ).toEqual(["forms"]);
  });
});

describe("which row of the rail each screen marks", () => {
  it("marks the section the screen is, and marks a detail route's parent section", () => {
    for (const [route, section] of Object.entries(CURRENT_SECTION)) {
      const slot = `${SHELL}/@rail${route}/page.tsx`;
      const source = readFileSync(slot, "utf8");
      expect(source, `${route} marks ${section} as the current rail row`).toContain(
        `section: "${section}"`,
      );
    }
  });

  it("expects a current row for every wired slot, so a new one cannot arrive unstated", () => {
    expect(sorted(Object.keys(CURRENT_SECTION))).toEqual(sorted(railSlotRoutes()));
  });

  it("marks a step as current on no screen at all", () => {
    // `RailCurrent` also has a `step` shape, and nothing uses it: no step in this app is a
    // route (`lib/forms/subtree-rail.ts` explains why minting one was refused), so no
    // screen IS a step. It is kept because the type is what makes the rail's own summary
    // fall back honestly, and this pins that no screen has quietly started claiming to be
    // one.
    for (const route of railSlotRoutes()) {
      expect(readFileSync(`${SHELL}/@rail${route}/page.tsx`, "utf8")).not.toContain('kind: "step"');
    }
  });
});
