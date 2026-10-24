import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Plain JavaScript with a hand-written declaration file beside it, imported by relative
// path the way `apps/api/e2e/support/check-fixture-domain.test.ts` imports its gate.
import { trackedFilesUnder } from "../../../scripts/tracked-files.mjs";

/**
 * Which screens carry a rail, and what each one's section carries, checked against the route
 * tree rather than claimed.
 *
 * ## Every screen has one now, and that is what this file pins
 *
 * Issue 561 asserted that the eight form-scoped screens have a slot page and that no fourth
 * rail root appears. §7.0 of `plan/admin-design-contracts.md` (Code Owner, 2026-10-24)
 * retires the second half of that: **every screen has a rail by default**, and a screen goes
 * without one only by a per-screen ruling recorded in §7.0's own table. None is ruled, so
 * issue #1117 built the remaining nine and `no-section.ts` has no caller left.
 *
 * The file is kept, and so is the `NO_SECTION` list below, now empty. Both are the gate the
 * ruling needs: granting a screen an exception is an edit to that list and therefore a change
 * somebody reviews, rather than a slot page quietly exporting `NoRailSection` again.
 *
 * What has not changed is that EVERY screen has a PAGE under `app/(shell)/@rail`.
 *
 * **That is a correctness requirement, not tidiness.** On a soft navigation Next keeps the
 * previously active state of any slot the new URL does not match, and consults `default.tsx`
 * only after a full-page load. So a route with no page in the slot did not render an empty
 * rail: it rendered the PREVIOUS screen's section. Walking from Settings to the question
 * library left the Settings rail standing beside a screen it says nothing about, which is
 * the defect this coverage removes. A screen added without a slot page fails here rather
 * than being found months later as a rail that will not go away.
 *
 * ## All nine form screens carry the same tree, and the builder's alone is interactive
 *
 * REVERSED 2026-08-25 (Code Owner). The builder used to carry the sibling rows and no steps,
 * because a rail step item is `/forms/{formId}#step-{stepId}` - a cross-route link on the
 * other seven screens, a bare same-page fragment on the builder - and §7 barred those. That
 * clause is retired and `loadFormRail` no longer has a mode for leaving the steps out, so
 * the shape is now pinned by the type rather than by this file.
 *
 * What is still worth asserting is the split that replaced it: the builder is the ONE screen
 * whose steps can be worked on rather than only walked to, because it is the one screen with
 * a draft to change. A second screen turning that flag on would be claiming an editor it does
 * not have.
 */

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

/**
 * Which sibling row each form slot marks as current, restated rather than derived.
 *
 * A table read out of the files it is checking passes on any files, which is the same reason
 * `subtree-rail.test.ts` restates §7's section list instead of importing it. The two detail
 * routes are the rows worth reading twice: neither is a row of the rail, so each marks the
 * section it lives under, which is how the section strip this rail replaced resolved those
 * same two URLs from task 034 onward.
 */
const CURRENT_SECTION: Readonly<Record<string, string>> = {
  "/forms/[formId]": "builder",
  "/forms/[formId]/rules": "rules",
  "/forms/[formId]/preview": "preview",
  "/forms/[formId]/versions": "versions",
  "/forms/[formId]/versions/[version]": "versions",
  "/forms/[formId]/releases": "releases",
  "/forms/[formId]/links": "links",
  "/forms/[formId]/responses": "responses",
  "/forms/[formId]/responses/[sessionId]": "responses",
  "/forms/[formId]/webhooks": "webhooks",
};

/**
 * The routes that carry NO rail, restated rather than read off the tree. **Empty, and it is
 * the Exception column of §7.0's table.**
 *
 * It held nine until issue #1117: the two library screens, their two creation screens, the
 * responses index, the erasure log, webhook operations and the two membership screens.
 * `plan/admin-ux-audit.md` §3 and §5.4 rejected a rail on each, on the reasoning that one
 * there would either be empty or would repeat the page's own body - "and now there are two of
 * them and they can disagree". §7.0 ruling 1 reverses it: every screen has a rail by default,
 * and a screen goes without one only by a per-screen ruling recorded in §7.0's table. None is
 * ruled today, and ruling 6 names New form specifically as not an exception.
 *
 * The list stays because the gate does. A screen granted an exception is an entry here and a
 * row in that table, which is two edits somebody reviews, rather than one slot page quietly
 * exporting `NoRailSection` and nobody noticing a screen lost its rail.
 */
const NO_SECTION: readonly string[] = [];

/**
 * Every Next route pattern under one directory, read from the repository.
 *
 * Pointed at one root or the other: here the slot tree is the subject rather than the thing
 * being excluded, so a `@slot` segment *inside* the enumeration is dropped while `@rail` as
 * the root itself is not. Route groups still contribute no segment.
 *
 * The set comes from `git ls-files` rather than a directory walk, so a compiled `page.tsx`
 * left under `.next-dev` by a dev server cannot be read as a screen (issue #641).
 */
function routePatternsUnder(directory: string, prefix: string): string[] {
  const patterns: string[] = [];
  for (const relative of trackedFilesUnder(directory, { match: /(?:^|\/)page\.tsx$/ })) {
    const segments = relative.split("/").slice(0, -1);
    if (segments.some((segment) => segment.startsWith("@"))) continue;
    const route = segments
      .filter((segment) => !segment.startsWith("("))
      .map((segment) => `/${segment}`)
      .join("");
    patterns.push(`${prefix}${route}`);
  }
  return patterns;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** Every authenticated screen: every route pattern with a page under `app/(shell)`. */
function shellScreens(): string[] {
  return routePatternsUnder(SHELL, "");
}

/** Every route the `@rail` slot answers for. */
function railSlotRoutes(): string[] {
  return routePatternsUnder(`${SHELL}/@rail`, "");
}

/** The screens under one form: everything below `/forms/[formId]`, and that route itself. */
function formScopedScreens(): string[] {
  return shellScreens().filter((pattern) => pattern.startsWith("/forms/[formId]"));
}

function slotSource(route: string): string {
  return readFileSync(`${SHELL}/@rail${route}/page.tsx`, "utf8");
}

describe("every screen has a page in the slot, whether or not it has a rail", () => {
  it("gives the slot a page for every authenticated route, and none for a route that is not one", () => {
    // Both directions in one assertion, and both matter. A screen with no slot page keeps
    // the previous screen's section on a soft navigation; a slot page for a route that no
    // longer exists is dead code that no screen can ever reach.
    expect(sorted(railSlotRoutes())).toEqual(sorted(shellScreens()));
  });

  it("accounts for every route as either carrying a rail or deliberately not", () => {
    const withRail = [
      ...Object.keys(CURRENT_SECTION),
      "/questions/[questionId]",
      "/settings",
      // The nine §7.0 ruling 1 added (issue #1117). Listed rather than derived, for the
      // reason the table above is: a list read out of the files it checks passes on any
      // files. A tenth screen has to be named here, which is where somebody is asked
      // whether it has a rail and which parts of one.
      "/questions",
      "/questions/new",
      "/forms",
      "/forms/new",
      "/responses",
      "/responses/erasures",
      "/webhooks",
      "/workspaces",
      "/workspaces/[workspaceId]",
    ];
    expect(sorted([...withRail, ...NO_SECTION])).toEqual(sorted(shellScreens()));
  });

  it("returns null from every slot page that carries no section, and only those", () => {
    // Read off the files rather than trusted, in both directions: a page that quietly grew
    // a section would still be listed in `NO_SECTION` and nobody would be asked about it,
    // and a page that quietly LOST one - exporting `NoRailSection` again - is a screen whose
    // rail went away without a ruling. Since #1117 both sides are empty, so this is the
    // assertion that `no-section.ts` has no caller: it stays in the tree for a route with a
    // recorded exception, and there is none.
    const empty = railSlotRoutes().filter((route) => slotSource(route).includes("NoRailSection"));
    expect(sorted(empty)).toEqual(sorted(NO_SECTION));
  });
});

describe("which screens carry the form-subtree section", () => {
  it("counts the ten form-scoped screens: the audit's eight, the rules route and releases", () => {
    // `plan/admin-ux-audit.md` §1: "of the sixteen authenticated screens, eight are
    // form-scoped and would get a populated rail". A NINTH arrived on 2026-09-05, and it
    // arrived the way this test asks a screen to: the Code Owner ruled on issue #669 that
    // `plan/admin-shell-poc/rules-screen-poc.html` is built as drawn, so rule editing left
    // the builder for `/forms/[formId]/rules` and its rail row is `rules`. A tenth is the
    // A TENTH arrived with task 065 and arrived the same way: ADR-40 makes "what is
    // released where" a question the version history cannot answer, so it is a screen. An
    // eleventh is the moment the same question has to be asked again, so it fails here.
    expect(sorted(formScopedScreens())).toEqual([
      "/forms/[formId]",
      "/forms/[formId]/links",
      "/forms/[formId]/preview",
      "/forms/[formId]/releases",
      "/forms/[formId]/responses",
      "/forms/[formId]/responses/[sessionId]",
      "/forms/[formId]/rules",
      "/forms/[formId]/versions",
      "/forms/[formId]/versions/[version]",
      "/forms/[formId]/webhooks",
    ]);
  });

  it("carries a rail on every root in the shell, with no screen left out", () => {
    // This asserted THREE roots until §7.0: `forms/` (issue 559, rolled out by 561),
    // `settings/` (§7a's single named exception, issue 562) and `questions/` (issue 650).
    // Each had been granted separately, and the point of pinning three was that a fourth
    // would have to be argued rather than assumed.
    //
    // §7.0 ruling 1 argues the whole question once and answers it for every screen, so the
    // assertion inverts: every root a screen lives under carries a rail, and a root that did
    // not would be a screen that lost one. `NO_SECTION` is where an exception is written,
    // and it is empty.
    const roots = new Set(
      railSlotRoutes()
        .filter((route) => !slotSource(route).includes("NoRailSection"))
        .map((route) => route.split("/")[1] ?? ""),
    );
    expect(sorted([...roots])).toEqual([
      "forms",
      "questions",
      "responses",
      "settings",
      "webhooks",
      "workspaces",
    ]);
  });
});

describe("which of the rail's rows each screen's section carries", () => {
  it("asks for the same rail on every one of them, with nothing per-screen to keep in step", () => {
    // There was a flag here, `interactiveSteps`, and this asserted that the builder was the
    // only page passing it. It is gone: interactivity comes from whether a builder has
    // published to `lib/forms/builder-bridge.ts`, and only the builder mounts one, so the
    // property the flag asserted is now true by construction rather than by agreement.
    //
    // What is worth pinning is what replaced it: every form slot page renders the same
    // component the same way, so a screen cannot quietly grow a rail of its own.
    for (const route of Object.keys(CURRENT_SECTION)) {
      expect(slotSource(route), `${route} renders the shared form rail`).toContain("FormRailSlot");
      expect(slotSource(route)).not.toContain("interactiveSteps");
    }
  });
});

describe("which row of the section each screen marks", () => {
  it("marks the section the screen is, and marks a detail route's parent section", () => {
    for (const [route, section] of Object.entries(CURRENT_SECTION)) {
      expect(slotSource(route), `${route} marks ${section} as the current rail row`).toContain(
        `section: "${section}"`,
      );
    }
  });

  it("expects a current row for every form-scoped slot, so a new one cannot arrive unstated", () => {
    expect(sorted(Object.keys(CURRENT_SECTION))).toEqual(sorted(formScopedScreens()));
  });

  it("marks a step as current on no screen at all", () => {
    // `RailCurrent` also has a `step` shape, and nothing uses it: no step in this app is a
    // route (`lib/forms/subtree-rail.ts` explains why minting one was refused), so no
    // screen IS a step. It is kept because the type is what makes the section's own title
    // fall back honestly, and this pins that no screen has quietly started claiming to be
    // one.
    for (const route of Object.keys(CURRENT_SECTION)) {
      expect(slotSource(route)).not.toContain('kind: "step"');
    }
  });
});
