import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { blankDraft } from "../../lib/forms/draft.ts";
import type { FormIssue } from "../../lib/forms/types.ts";

import type { BuilderStatus } from "./validation-panel.tsx";

const DRAFT = blankDraft("frm_validation_panel");

const ONE_ISSUE: readonly FormIssue[] = [
  { code: "RULE_CYCLE", message: "these rules depend on each other" },
];
const TWO_ISSUES: readonly FormIssue[] = [
  ...ONE_ISSUE,
  { code: "RULE_BACKWARD_TARGET", message: "rule targets an earlier question" },
];

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

const ALL_CLEAR = "Everything here would pass a publish";

const UNCHECKED = "The draft could not be checked";

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

    expect(html, "a failed check must not read as publish-ready").not.toContain(ALL_CLEAR);
    expect(html).toContain(UNCHECKED);
  });

  it("says the count is not current rather than counting, when the check failed", async () => {
    const html = await render("error", TWO_ISSUES);

    expect(html, "a number the panel could not refresh is not reported as a count").not.toContain(
      "issues would block a publish",
    );
    expect(html).toContain(UNCHECKED);
    expect(html).toContain('data-issue-code="RULE_CYCLE"');
    expect(html).toContain('data-issue-code="RULE_BACKWARD_TARGET"');
  });

  it("keeps the failed check inside the panel's own live region and out of save vocabulary", async () => {
    const html = await render("error", []);

    expect(html).toContain('data-testid="qcms-validation-status"');
    expect(html).toContain('data-testid="qcms-issue-summary"');
    expect(html, "the panel says nothing about storage").not.toContain("The last save failed");
    expect(html).not.toContain("Saved ");
  });

  it("renders no all-clear before the first check has been run (issue 625)", async () => {
    const html = await render("idle", undefined);

    expect(html, "an unvalidated draft must not read as publish-ready").not.toContain(ALL_CLEAR);
    expect(html).toContain(NOT_CHECKED);
  });

  it("renders no all-clear while the first check is still on its way (issue 625)", async () => {
    expect(await render("saving", undefined)).not.toContain(ALL_CLEAR);
    expect(await render("saving", undefined)).toContain(NOT_CHECKED);
  });

  it("distinguishes a check that never ran from one that failed (issue 625)", async () => {
    expect(await render("idle", undefined)).not.toContain(UNCHECKED);
    expect(await render("error", [])).not.toContain(NOT_CHECKED);
  });

  it("still counts normally while a check is in flight and after one lands", async () => {
    expect(await render("validating", TWO_ISSUES)).toContain("Checking the draft");
    expect(await render("saved", TWO_ISSUES)).toContain("2 issues would block a publish");
    expect(await render("saved", ONE_ISSUE)).toContain("1 issue would block a publish");
  });

  it("renders a warning below the issues, in its own list", async () => {
    const html = await render("saved", [], ONE_WARNING);

    expect(html).toContain('data-testid="qcms-validation-warnings"');
    expect(html).toContain('data-issue-code="MULTICHOICE_SAME_STEP_TARGET"');
    expect(html).toContain("1 thing would publish but may not behave as written");
  });

  it("a warning is not counted as something that would block a publish", async () => {
    const html = await render("saved", [], ONE_WARNING);

    expect(html).toContain(ALL_CLEAR);
    expect(html, "a warning must not be counted into the blocking total").not.toContain(
      "1 issue would block a publish",
    );
  });

  it("the warning summary stays out of the panel's live region", async () => {
    const html = await render("saved", [], ONE_WARNING);

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
