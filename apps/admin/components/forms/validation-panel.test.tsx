import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { blankDraft } from "../../lib/forms/draft.ts";
import type { FormIssue } from "../../lib/forms/types.ts";

import type { BuilderStatus } from "./validation-panel.tsx";

/**
 * The validation panel must never report an all-clear it did not compute (issue 518, and
 * the defect the review of PR #585 found in it; `plan/admin-ux-audit.md` §5.6).
 *
 * The builder does two round trips on one debounce: `PUT .../draft` stores and returns
 * issues, then `POST .../draft/validate` recomputes them without storing. The second is
 * what makes the count current. When it fails, the builder sets `status` to `"error"` -
 * and before this file existed nothing rendered that status at all, so the panel fell
 * through to its count branches with the empty issue list a failed read supplies and
 * announced:
 *
 * > No issues. Everything here would pass a publish.
 *
 * Beside the Publish button, at the moment the app knew least. The count was not stale,
 * it was reset. This is the same family as issue 513's rule that a failed read renders
 * its alert and nothing else, with no "no items" claim (`plan/admin-design-contracts.md`
 * §3), and it is the worst instance of it: the claim is about publish-readiness rather
 * than about the length of a list.
 *
 * ## Why this layer
 *
 * The same reason `app/(shell)/empty-and-table-states.test.tsx` gives. `validateDraft`
 * reaches the panel as a server action bound in the page and executed in the Next server
 * process, so `page.route()` cannot make it fail and no browser gesture can either: there
 * is no way to drive this branch from Playwright. Rendering the panel in each of its
 * states and asserting over the HTML it emits is the highest layer that can see the
 * failure branch at all (ADR-23's "highest layer that exists for it"). What the panel
 * looks like in its ordinary states stays with the browser spec and the committed
 * capture.
 *
 * ## Red-first
 *
 * Against the panel as it stood before issue 518's change (`git show HEAD:` the panel over
 * the fixed one and run this file), 2 of the 5 then here fail and 3 pass. "renders no
 * all-clear when the check failed" fails on the all-clear assertion, and "says the count
 * is not current rather than counting" fails on the count one. The three that pass
 * unchanged are the point of including them: the fix adds a branch rather than moving the
 * existing ones.
 *
 * The three issue-625 cases were measured the same way against the panel before that fix:
 * all three failed and the other five passed. They failed by TypeError rather than by
 * assertion, which is the defect stated precisely - the panel took `readonly FormIssue[]`,
 * so there was no value the builder could have passed to mean "nothing has checked this".
 * Handed instead the empty array the builder really did seed, the pre-fix panel rendered
 * `No issues. Everything here would pass a publish.` for `status="idle"`.
 */

/**
 * The panel's two value imports are left real rather than stubbed: the sentence the panel
 * renders IS the subject here, so a fake `t` returning its own key would assert nothing
 * about what an author reads.
 */
// The bridge the panel reads to find out which step screen is showing, so an issue link
// naming an unrendered pin can switch to it. Left real rather than stubbed: with no
// builder mounted it publishes nothing and `useBuilderRail` returns `undefined`, which is
// exactly the state these assertions render in.

const DRAFT = blankDraft("frm_validation_panel");

/** Real issue codes, so `messageForIssue` renders its mapped sentence rather than a fallback. */
const ONE_ISSUE: readonly FormIssue[] = [
  { code: "RULE_CYCLE", message: "these rules depend on each other" },
];
const TWO_ISSUES: readonly FormIssue[] = [
  ...ONE_ISSUE,
  { code: "RULE_BACKWARD_TARGET", message: "rule targets an earlier question" },
];

/** Real warning codes, so the panel renders their mapped sentences too (issue #123). */
const ONE_WARNING: readonly FormIssue[] = [
  {
    code: "MULTICHOICE_SAME_STEP_TARGET",
    message: "rule reveals a same-step question from a multiChoice answer",
  },
];
const TWO_WARNINGS: readonly FormIssue[] = [
  ...ONE_WARNING,
  { code: "PATTERN_CLASS_SET_AMBIGUOUS", message: "pattern class reads two ways" },
];

/** The exact sentence the panel may only ever render about a count it actually has. */
const ALL_CLEAR = "Everything here would pass a publish";

/** The sentence that replaces it when the check did not land. */
const UNCHECKED = "The draft could not be checked";

/** And the one that replaces it before any check has been attempted (issue 625). */
const NOT_CHECKED = "has not been checked yet";

async function render(
  status: BuilderStatus,
  issues: readonly FormIssue[] | undefined,
  warnings: readonly FormIssue[] = [],
): Promise<string> {
  const { ValidationPanel } = await import("./validation-panel.tsx");
  return renderToStaticMarkup(
    <ValidationPanel draft={DRAFT} issues={issues} warnings={warnings} status={status} />,
  );
}

describe("the validation panel states what it knows", () => {
  it("renders the all-clear only when a check actually returned no issues", async () => {
    const html = await render("saved", []);

    expect(html).toContain(ALL_CLEAR);
  });

  it("renders no all-clear when the check failed", async () => {
    const html = await render("error", []);

    // The whole point. An empty issue list plus a failed check is not an all-clear, and
    // this is the assertion that fails if anyone reorders `issueSummary`'s branches so
    // the count is read before the status again.
    expect(html, "a failed check must not read as publish-ready").not.toContain(ALL_CLEAR);
    expect(html).toContain(UNCHECKED);
  });

  it("says the count is not current rather than counting, when the check failed", async () => {
    const html = await render("error", TWO_ISSUES);

    // The entries survive a failed refresh (the store leg returned them moments earlier),
    // but the summary above them stops asserting that the number is current.
    expect(html, "a number the panel could not refresh is not reported as a count").not.toContain(
      "issues would block a publish",
    );
    expect(html).toContain(UNCHECKED);
    expect(html).toContain('data-issue-code="RULE_CYCLE"');
    expect(html).toContain('data-issue-code="RULE_BACKWARD_TARGET"');
  });

  it("keeps the failed check inside the panel's own live region and out of save vocabulary", async () => {
    const html = await render("error", []);

    // Issue vocabulary stays here and save vocabulary stays in the ambient strip, in both
    // directions: an author must not hear a failed validate as a failed save, which is
    // the misattribution issue 518 removed.
    expect(html).toContain('data-testid="qcms-validation-status"');
    expect(html).toContain('data-testid="qcms-issue-summary"');
    expect(html, "the panel says nothing about storage").not.toContain("The last save failed");
    expect(html).not.toContain("Saved ");
  });

  it("renders no all-clear before the first check has been run (issue 625)", async () => {
    const html = await render("idle", undefined);

    // The same defect as the failed check, through a different door: the count the panel
    // was seeded with is an initial value rather than a verdict, and rendering it as one
    // asserts publish-readiness the app has not asked anybody about.
    expect(html, "an unvalidated draft must not read as publish-ready").not.toContain(ALL_CLEAR);
    expect(html).toContain(NOT_CHECKED);
  });

  it("renders no all-clear while the first check is still on its way (issue 625)", async () => {
    // `status` alone cannot carry this: the builder sets "saving" the moment the author
    // touches anything, so a panel keyed on `status === "idle"` would announce the
    // all-clear for the whole of the first debounce and round trip.
    expect(await render("saving", undefined)).not.toContain(ALL_CLEAR);
    expect(await render("saving", undefined)).toContain(NOT_CHECKED);
  });

  it("distinguishes a check that never ran from one that failed (issue 625)", async () => {
    // Two different things the panel does not know, and an author can act on the second
    // (retry, look at the network) in a way the first does not call for.
    expect(await render("idle", undefined)).not.toContain(UNCHECKED);
    expect(await render("error", [])).not.toContain(NOT_CHECKED);
  });

  it("still counts normally while a check is in flight and after one lands", async () => {
    expect(await render("validating", TWO_ISSUES)).toContain("Checking the draft");
    expect(await render("saved", TWO_ISSUES)).toContain("2 issues would block a publish");
    expect(await render("saved", ONE_ISSUE)).toContain("1 issue would block a publish");
  });

  // --- warnings (issue #123) ------------------------------------------------

  it("renders a warning below the issues, in its own list", async () => {
    const html = await render("saved", [], ONE_WARNING);

    expect(html).toContain('data-testid="qcms-validation-warnings"');
    expect(html).toContain('data-issue-code="MULTICHOICE_SAME_STEP_TARGET"');
    expect(html).toContain("1 thing would publish but may not behave as written");
  });

  it("a warning is not counted as something that would block a publish", async () => {
    const html = await render("saved", [], ONE_WARNING);

    // The whole distinction the two channels exist for. A draft with warnings and no
    // errors publishes, so the authoritative count above still reads as an all-clear.
    expect(html).toContain(ALL_CLEAR);
    expect(html, "a warning must not be counted into the blocking total").not.toContain(
      "1 issue would block a publish",
    );
  });

  it("the warning summary stays out of the panel's live region", async () => {
    const html = await render("saved", [], ONE_WARNING);

    // The `aria-live` region is the single authority on the blocking count, and a
    // warning blocks nothing. Re-announcing it there would make the number a reader
    // hears mean two things at once.
    const live = html.slice(0, html.indexOf('data-testid="qcms-validation-warnings"'));
    expect(live).not.toContain("may not behave as written");
  });

  it("renders nothing at all when there are no warnings", async () => {
    const html = await render("saved", TWO_ISSUES, []);

    expect(html).not.toContain('data-testid="qcms-validation-warnings"');
    expect(html).not.toContain("Worth a look");
  });

  it("counts more than one warning", async () => {
    const html = await render("saved", [], TWO_WARNINGS);

    expect(html).toContain("2 things would publish but may not behave as written");
  });
});
