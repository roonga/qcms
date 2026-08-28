import { describe, expect, it } from "vitest";

import type { DraftStep } from "./types.ts";
import { formSubtreeRail, railIssueTotal, railSummary, RAIL_SECTIONS } from "./subtree-rail.ts";

/**
 * What the rail carries, as a decision rather than as pixels (`plan/admin-design-
 * contracts.md` §7, issue 559).
 *
 * §7 is four sentences and three of them are answerable without a DOM: which two groups,
 * in which order, with which row marked current, and which count on which step. Testing
 * those through rendered markup would test them through a second thing at the same time,
 * so they are tested here and the markup is tested next door for being markup.
 *
 * The section list is restated below rather than imported from the module, for the same
 * reason `measure.pw.ts` restates its own table: a list checked against itself passes on
 * any list. In particular VALIDATION IS ABSENT, and that is the clause most likely to be
 * "fixed" by someone reading `rules-screen-poc.html`, which draws it as a rail route
 * (`plan/admin-ux-audit.md` §5.5 is why it is not one).
 */

const STEPS: readonly DraftStep[] = [
  { stepId: "stp_about", title: { en: "About you" }, items: [] },
  { stepId: "stp_health", title: { en: "Health" }, items: [] },
  { stepId: "stp_blank", title: { en: "" }, items: [] },
];

const FORM_ID = "frm_life";
const SLUG = "life-insurance";
// A form that HAS a title: the rail shows what an author called it, and falls back to the
// slug only when there is nothing to show. Both branches are asserted below.
const TITLE = "Life insurance";

function rail(current: Parameters<typeof formSubtreeRail>[0]["current"], counts = new Map()) {
  return formSubtreeRail({
    formId: FORM_ID,
    slug: SLUG,
    title: TITLE,
    steps: STEPS,
    issueCounts: counts,
    current,
  });
}

describe("the form-subtree rail's contents", () => {
  it("carries the six sibling routes in §7's order, and Validation is not one of them", () => {
    expect([...RAIL_SECTIONS]).toStrictEqual([
      "builder",
      "preview",
      "versions",
      "links",
      "responses",
      "webhooks",
    ]);
  });

  it("puts the form's children first and its siblings second", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.map((item) => item.label)).toStrictEqual([
      "About you",
      "Health",
      // A step an author has added but not named yet still has to be clickable and
      // readable, so it takes the same stand-in the builder's own step list gives it.
      "Untitled step",
    ]);
    expect(groups.siblings.map((item) => item.label)).toStrictEqual([
      // The form's own name, not "Builder" and not "Form details": that row opens the
      // form's own screen, and the rail's summary line above it stopped saying the same
      // thing on 2026-08-26. The TITLE where there is one - what an author called the
      // form is what a reader recognises - with the slug as the fallback, which
      // `formDisplayName` is tested for below.
      TITLE,
      "Preview",
      // "Version history" since issue 679, which named the version list's screen and so,
      // by §7's rule that the rail carries the screen's own name, named this row too.
      "Version history",
      "Links",
      "Responses",
      "Webhooks",
    ]);
  });

  it("points each sibling at its own route, with the builder as the form itself", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.siblings.map((item) => item.href)).toStrictEqual([
      "/forms/frm_life",
      "/forms/frm_life/preview",
      "/forms/frm_life/versions",
      "/forms/frm_life/links",
      "/forms/frm_life/responses",
      "/forms/frm_life/webhooks",
    ]);
  });

  it("points a step at the builder's anchor for it, which is the only address a step has", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.map((item) => item.href)).toStrictEqual([
      "/forms/frm_life#step-stp_about",
      "/forms/frm_life#step-stp_health",
      "/forms/frm_life#step-stp_blank",
    ]);
  });

  it("makes a step row the destination for the id it points at, and a sibling row no destination", () => {
    // The other half of the href above, and the half that went missing when the step list
    // moved into the rail: something has to CARRY `step-{stepId}` or every link naming it
    // lands nowhere - the rail's own rows from seven screens, and the validation panel's
    // "jump to the offending step" links, which is what `lib/forms/issues.ts` mints the id
    // for. A sibling is a route rather than a fragment, so it is a destination for nothing.
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.map((item) => item.anchorId)).toStrictEqual([
      "step-stp_about",
      "step-stp_health",
      "step-stp_blank",
    ]);
    expect(groups.siblings.every((item) => item.anchorId === undefined)).toBe(true);
  });

  it("numbers the steps in document order and leaves the sections unnumbered", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.map((item) => item.position)).toStrictEqual([1, 2, 3]);
    expect(groups.siblings.every((item) => item.position === undefined)).toBe(true);
  });

  it("marks exactly one row current, and marks the right one", () => {
    const groups = rail({ kind: "section", section: "responses" });
    const current = [...groups.children, ...groups.siblings].filter((item) => item.isCurrent);
    expect(current.map((item) => item.key)).toStrictEqual(["section:responses"]);
  });

  it("marks a step current when the screen is that step", () => {
    const groups = rail({ kind: "step", stepId: "stp_health" });
    const current = [...groups.children, ...groups.siblings].filter((item) => item.isCurrent);
    expect(current.map((item) => item.key)).toStrictEqual(["step:stp_health"]);
  });

  it("badges a step with its own issue count and never badges a section", () => {
    const groups = rail({ kind: "section", section: "links" }, new Map([["stp_health", 2]]));
    expect(groups.children.map((item) => item.issueCount)).toStrictEqual([0, 2, 0]);
    expect(groups.siblings.every((item) => item.issueCount === 0)).toBe(true);
  });

  it("renders without badges rather than claiming a clean form when there is no verdict", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(groups.children.every((item) => item.issueCount === 0)).toBe(true);
  });

  it("escapes a form id on its way into an href", () => {
    const groups = formSubtreeRail({
      formId: "frm_a b",
      slug: "a b",
      title: "",
      steps: [],
      issueCounts: new Map(),
      current: { kind: "section", section: "builder" },
    });
    expect(groups.siblings[0]?.href).toBe("/forms/frm_a%20b");
  });
});

describe("the collapsed summary", () => {
  // Issue 693. It named the active ITEM until now - a step label, a section label, or the
  // slug only when neither was current - so one line meant three things and disagreed with
  // the other two rails, both of which name their scope. It names the FORM at every
  // position now, which is also what `admin-shell-poc.html` draws on every screen.
  it("names the form on a section screen, not the section", () => {
    const groups = rail({ kind: "section", section: "links" }, new Map([["stp_health", 2]]));
    expect(railSummary(groups, "life", "")).toStrictEqual({ text: "life", issueCount: 2 });
  });

  it("names the form on a step screen, not the step", () => {
    const groups = rail({ kind: "step", stepId: "stp_health" }, new Map([["stp_health", 2]]));
    expect(railSummary(groups, "life", "")).toStrictEqual({ text: "life", issueCount: 2 });
  });

  it("names the form when nothing is current, which was the only branch that ever did", () => {
    const groups = rail({ kind: "step", stepId: "stp_gone" });
    expect(railSummary(groups, "life", "")).toStrictEqual({ text: "life", issueCount: 0 });
  });

  it("prefers what the author called the form over how it is addressed", () => {
    // The slug is in the URL and the breadcrumb; the title is the thing a person
    // recognises, and until now the rail never showed it at all.
    const groups = rail({ kind: "section", section: "links" });
    expect(railSummary(groups, "life", "Life insurance").text).toBe("Life insurance");
  });

  it("falls back to the slug for a form nobody has named yet, rather than an empty row", () => {
    const groups = rail({ kind: "section", section: "links" });
    expect(railSummary(groups, "life", "").text).toBe("life");
    expect(railSummary(groups, "life", "   ").text, "whitespace is not a name").toBe("life");
  });

  it("counts every step's issues, not the current row's", () => {
    // The number a shut rail can usefully carry about a form is how much is wrong with it,
    // and that is a different number from whichever row happens to be marked.
    const groups = rail(
      { kind: "section", section: "links" },
      new Map([
        ["stp_about", 1],
        ["stp_health", 2],
      ]),
    );
    expect(railIssueTotal(groups)).toBe(3);
    expect(railSummary(groups, "life", "").issueCount).toBe(3);
  });
});
