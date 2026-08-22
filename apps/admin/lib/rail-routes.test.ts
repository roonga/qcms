import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Which screens carry the §7 rail and what each one's carries, checked against the route
 * tree rather than claimed (issue 561).
 *
 * Issue 559 built the rail and wired one screen; 561 rolls it across the rest. "All eight
 * form-subtree screens carry the rail" is the acceptance, and a sentence in a PR body is
 * not a mechanism: a ninth form-scoped screen added next quarter would inherit no rail and
 * nobody would be asked about it. So the pairing is read off the filesystem here, the same
 * way `measure.test.ts` reads the cap table against the route tree, and a screen without a
 * slot fails this file until someone wires it.
 *
 * ## The builder carries the sibling group and no children, and that is §7
 *
 * It is asserted here rather than left as a shape someone might "fix", because it looks
 * like an inconsistency and is not one (PM seat ruling on issue 561). A rail step item is
 * `/forms/{formId}#step-{stepId}`. On the other seven screens that is a cross-route link;
 * on the builder the route part is that same route, so the item is a bare same-page
 * fragment, and §7 says the rail "never carries same-page section switches". The children
 * group there is forbidden rather than merely redundant beside the builder's own step
 * editor, which is content rather than navigation and stays exactly as it is.
 *
 * §7's "two groups, in that order, with one divider" describes the rail where both groups
 * exist. One group means no divider, which is what `form-subtree-rail.tsx` already does
 * when there is nothing to separate.
 */

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

/**
 * Which sibling row each slot marks as current, restated rather than derived.
 *
 * A table read out of the files it is checking passes on any files, which is the same
 * reason `subtree-rail.test.ts` restates §7's section list instead of importing it. The
 * two detail routes are the rows worth reading twice: neither is a row of the rail, so
 * each marks the section it lives under, which is how the section strip this rail replaced
 * resolved those same two URLs from task 034 onward.
 */
const CURRENT_SECTION: Readonly<Record<string, string>> = {
  "/forms/[formId]": "builder",
  "/forms/[formId]/preview": "preview",
  "/forms/[formId]/versions": "versions",
  "/forms/[formId]/versions/[version]": "versions",
  "/forms/[formId]/links": "links",
  "/forms/[formId]/responses": "responses",
  "/forms/[formId]/responses/[sessionId]": "responses",
  "/forms/[formId]/webhooks": "webhooks",
};

/** The screens whose rail carries §7's sibling group alone. */
const SIBLINGS_ONLY = ["/forms/[formId]"];

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

function slotSource(route: string): string {
  return readFileSync(`${SHELL}/@rail${route}/page.tsx`, "utf8");
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

  it("gives every one of them a rail, with no screen left out", () => {
    expect(sorted(railSlotRoutes())).toEqual(sorted(formScopedScreens()));
  });

  it("puts no rail outside the three screens that have been granted one", () => {
    // The tripwire is that the slot root holds exactly these three roots, and it keeps its
    // teeth where they matter: a FOURTH appearing fails here, which is the moment a rail on
    // a new screen has to be argued rather than assumed. The other authenticated screens
    // would still get an empty rail or one duplicating their own body
    // (`plan/admin-ux-audit.md` §3 and §5.4), which is why the default is nothing.
    //
    // Each of the three was granted separately and the grants are not one rule:
    //
    // - `forms/` is the form-subtree rail (issue 559, rolled out by 561).
    // - `settings/` was §7a's single named exception (issue 562, rebuilt to its POC by 655).
    // - `questions/` is issue 650, and its authority is the screen's own POC
    //   (`plan/admin-shell-poc/question-editor-poc.html`), which draws a rail carrying the
    //   question's versions. `docs/admin-constraints.md` is what makes that the ruling: the
    //   POCs are the design, one per screen, and the contracts document is description. §7a
    //   asked for a ruling recorded in the contracts document because that document was the
    //   authority when it was written; the drawing is now where a screen's answer lives.
    //
    // None of the three is checked below by the rest of this file: every other assertion
    // here walks `@rail/forms` alone, because the other two are different contracts that
    // happen to share the column. Their own coverage is `lib/settings-sections.test.ts` and
    // `components/settings-section-rail.test.tsx`, and `lib/questions/version-rail.test.ts`
    // and `components/questions/question-versions-rail.test.tsx`.
    const slotRoot = readdirSync(`${SHELL}/@rail`, { withFileTypes: true });
    expect(
      sorted(slotRoot.filter((entry) => entry.isDirectory()).map((entry) => entry.name)),
    ).toEqual(["forms", "questions", "settings"]);
  });
});

describe("which of §7's groups each screen's rail carries", () => {
  it("asks for the siblings alone on the builder, and nowhere else", () => {
    const asked = railSlotRoutes().filter((route) => slotSource(route).includes('"none"'));
    expect(sorted(asked)).toEqual(sorted(SIBLINGS_ONLY));
  });

  it("keeps the siblings-only list to the builder, whose step item would be a same-page fragment", () => {
    expect(SIBLINGS_ONLY).toEqual(["/forms/[formId]"]);
  });
});

describe("which row of the rail each screen marks", () => {
  it("marks the section the screen is, and marks a detail route's parent section", () => {
    for (const [route, section] of Object.entries(CURRENT_SECTION)) {
      expect(slotSource(route), `${route} marks ${section} as the current rail row`).toContain(
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
      expect(slotSource(route)).not.toContain('kind: "step"');
    }
  });
});
