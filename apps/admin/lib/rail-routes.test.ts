import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Which screens carry a rail, and what each one's section carries, checked against the route
 * tree rather than claimed.
 *
 * ## The property this file pins gained a second half, and it is the load-bearing one
 *
 * Issue 561 asserted that the eight form-scoped screens have a slot page and that no fourth
 * rail root appears. Ten screens have a rail and seven do not, and that has not changed.
 * What changed is that all seventeen now have a PAGE under `app/(shell)/@rail`: the seven
 * without a rail have one that returns `null`, which is a different thing from having no
 * page at all.
 *
 * **That is a correctness requirement, not tidiness.** On a soft navigation Next keeps the
 * previously active state of any slot the new URL does not match, and consults `default.tsx`
 * only after a full-page load. So a route with no page in the slot did not render an empty
 * rail: it rendered the PREVIOUS screen's section. Walking from Settings to the question
 * library left the Settings rail standing beside a screen it says nothing about, which is
 * the defect this coverage removes. A screen added without a slot page fails here rather
 * than being found months later as a rail that will not go away.
 *
 * ## All eight form screens carry the same tree, and the builder's alone is interactive
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
  "/forms/[formId]/preview": "preview",
  "/forms/[formId]/versions": "versions",
  "/forms/[formId]/versions/[version]": "versions",
  "/forms/[formId]/links": "links",
  "/forms/[formId]/responses": "responses",
  "/forms/[formId]/responses/[sessionId]": "responses",
  "/forms/[formId]/webhooks": "webhooks",
};

/**
 * The routes that carry NO rail, restated rather than read off the tree.
 *
 * `plan/admin-ux-audit.md` §3 and §5.4 reject a rail on each of them and give the reason: a
 * rail there would either be empty or would repeat the page's own body, "and now there are
 * two of them and they can disagree". Each still has a page in the slot, returning `null`,
 * because a route that matches nothing keeps the previous screen's rail on a soft
 * navigation. Written down here, granting one a rail is a change to this list and therefore
 * a change someone reviews.
 */
const NO_SECTION = [
  "/forms",
  "/forms/new",
  "/questions",
  "/questions/new",
  "/responses",
  "/responses/erasures",
  "/webhooks",
];

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
    const withRail = [...Object.keys(CURRENT_SECTION), "/questions/[questionId]", "/settings"];
    expect(sorted([...withRail, ...NO_SECTION])).toEqual(sorted(shellScreens()));
  });

  it("returns null from every slot page that carries no section, and only those", () => {
    // Read off the files rather than trusted: a page that quietly grew a section would
    // still be listed in `NO_SECTION` and nobody would be asked about it.
    const empty = railSlotRoutes().filter((route) => slotSource(route).includes("NoRailSection"));
    expect(sorted(empty)).toEqual(sorted(NO_SECTION));
  });
});

describe("which screens carry the form-subtree section", () => {
  it("counts the eight form-scoped screens the audit counts", () => {
    // `plan/admin-ux-audit.md` §1: "of the sixteen authenticated screens, eight are
    // form-scoped and would get a populated rail". A ninth appearing is the moment the
    // question of what its section carries has to be asked, so it fails here.
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

  it("keeps the three section-bearing roots to the three that were argued for", () => {
    // Each was granted separately and the grants are not one rule:
    //
    // - `forms/` is the form-subtree section (issue 559, rolled out by 561).
    // - `settings/` was §7a's single named exception (issue 562, rebuilt to its POC by 655).
    // - `questions/` is issue 650, and its authority is the screen's own POC
    //   (`plan/admin-shell-poc/question-editor-poc.html`), which draws a rail carrying the
    //   question's versions.
    //
    // A fourth is the moment a section on a new screen has to be argued rather than
    // assumed, which is what the `NO_SECTION` list above keeps honest for the rest.
    const roots = new Set(
      railSlotRoutes()
        .filter((route) => !slotSource(route).includes("NoRailSection"))
        .map((route) => route.split("/")[1] ?? ""),
    );
    expect(sorted([...roots])).toEqual(["forms", "questions", "settings"]);
  });
});

describe("which of the rail's rows each screen's section carries", () => {
  it("makes the steps workable on the builder and only there", () => {
    // The builder is the one screen with a draft to change, so it is the one screen whose
    // rail rows select, rename, reorder and remove. On the other seven a step row stays
    // what it has always been: a link to the builder's anchor for that step. A screen that
    // turned this on without an editor would offer commands with nothing to run them.
    const interactive = Object.keys(CURRENT_SECTION).filter((route) =>
      slotSource(route).includes("interactiveSteps"),
    );
    expect(interactive).toEqual(["/forms/[formId]"]);
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
