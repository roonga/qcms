import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DraftForm, DraftStep, FormIssue, PinnableQuestion } from "../../lib/forms/types.ts";

/**
 * Before the builder has validated anything, no surface on it reports a count (issue 625).
 *
 * The builder seeds its issue list empty and only talks to the API once the author has
 * changed something, so on a form whose stored draft genuinely has issues the whole screen
 * read as clean until the first keystroke. `components/forms/validation-panel.test.tsx`
 * holds the sentence beside the Publish button; this file holds the two OTHER surfaces
 * that render the same list, because a panel that has learnt to say "not checked yet"
 * beside a pin grid still reading `Issues: None` would be one screen giving two answers -
 * and `plan/admin-ux-audit.md` §5.6 makes the panel the single authoritative count
 * precisely so a reader never has to reconcile two.
 *
 * ## The three surfaces and what each owes
 *
 * - The panel says the count, so with no verdict it says it has none.
 * - The pin grid's Issues cell says `None` per pin, which is the same fabricated all-clear
 *   one row at a time, so with no verdict it says the pins have not been checked.
 * - The step rail badges a step only when its count is ABOVE zero, so with no verdict it
 *   renders nothing and asserts nothing. That is already how it behaves and it is asserted
 *   here rather than assumed, because "the rail agrees with the panel" is now a property
 *   of the screen and a badge on a zero would break it silently.
 *
 * §7's form-subtree rail (`components/forms/form-subtree-rail.tsx`) is the same story on
 * the other seven screens and is not repeated here: `lib/server/form-rail.test.ts` already
 * pins that a verdict which could not be had produces an empty map "never a stand-in for
 * zero", and `form-subtree-rail.test.tsx` pins that only a step above zero gets a badge.
 * On the builder that rail carries the sibling group alone (issue 561), so it has no step
 * badge to disagree with in the first place.
 *
 * ## Why this layer
 *
 * `renderToStaticMarkup` is the highest layer that can hold all three surfaces in the same
 * state at once and read the two cells that DROP at compact width (ADR-23: the highest
 * layer that exists for it). The seeded end-to-end path is real and is covered too, in
 * `apps/admin/e2e/validation-idle.pw.ts` against the insurance form whose two pins name
 * versions the seed never publishes - a state no hand-built fixture here produces.
 *
 * ## Red-first
 *
 * Against the components as they stood before this change, 2 of the 4 cases below fail and
 * 2 pass. The first fails by `TypeError: Cannot read properties of undefined (reading
 * 'filter')` in `issuesForPin`, which is the defect stated precisely: the grid took
 * `readonly FormIssue[]`, so there was no value the builder could pass to mean "nothing
 * has checked this", and handed the empty array it really did seed the grid printed
 * `None`. The second fails on `data-pin-issues="none"`, which did not exist because there
 * was only one cell state to name. The two that pass unchanged are the step rail's, and
 * that is the point of including them: the rail was already honest and the fix had to
 * leave it that way.
 */

vi.mock("@/components/kit", () => import("../kit.tsx"));
vi.mock("@/components/empty-state", () => import("../empty-state.tsx"));
vi.mock("@/components/row-menu", () => import("../row-menu.tsx"));
vi.mock("@/lib/announce", () => import("../../lib/announce.ts"));
vi.mock("@/lib/forms/draft", () => import("../../lib/forms/draft.ts"));
vi.mock("@/lib/forms/issues", () => import("../../lib/forms/issues.ts"));
vi.mock("@/lib/forms/pin-grid", () => import("../../lib/forms/pin-grid.ts"));
vi.mock("@/lib/i18n/en", () => import("../../lib/i18n/en.ts"));
vi.mock("@/lib/questions/definition", () => import("../../lib/questions/definition.ts"));

const DEFINITION = {
  questionId: "q_at_fault_accident",
  type: "boolean" as const,
  label: { en: "Were you at fault?" },
};

const LIBRARY: readonly PinnableQuestion[] = [
  {
    questionId: "q_at_fault_accident",
    slug: "at-fault-accident",
    label: { en: "Were you at fault?" },
    type: "boolean",
    versions: [{ version: 1, status: "published", definition: DEFINITION }],
  },
];

const STEP: DraftStep = {
  stepId: "stp_history",
  title: { en: "Driving history" },
  items: [{ questionId: "q_at_fault_accident", version: 1 }],
};

const DRAFT: DraftForm = {
  formId: "frm_auto_quote",
  defaultLocale: "en",
  title: { en: "Vehicle insurance" },
  steps: [STEP],
  rules: [],
};

/** The exact word the Issues cell may only ever render about a verdict it actually has. */
const NONE = ">None<";

/** What it renders instead when nothing has been checked. */
const NOT_CHECKED = "Not checked";

async function renderStepEditor(issues: readonly FormIssue[] | undefined): Promise<string> {
  const { StepEditor } = await import("./step-editor.tsx");
  return renderToStaticMarkup(
    <StepEditor
      draft={DRAFT}
      step={STEP}
      library={{ ok: true, data: LIBRARY }}
      issues={issues}
      onAddPin={() => undefined}
      onMovePin={() => undefined}
      onRemovePin={() => undefined}
      onReorderPin={() => undefined}
    />,
  );
}

async function renderStepsRail(issueCounts: ReadonlyMap<string, number>): Promise<string> {
  const { StepsRail } = await import("./steps-rail.tsx");
  return renderToStaticMarkup(
    <StepsRail
      draft={DRAFT}
      issueCounts={issueCounts}
      selectedStepId={STEP.stepId}
      onSelect={() => undefined}
      onAdd={() => undefined}
      onRename={() => undefined}
      onMove={() => undefined}
      onRemove={() => undefined}
    />,
  );
}

describe("no builder surface reports a count it has not been given (issue 625)", () => {
  it("says the pins have not been checked rather than that they have no issues", async () => {
    const html = await renderStepEditor(undefined);

    expect(html, "an unfetched verdict is not a pin with no issues").not.toContain(NONE);
    expect(html).toContain(NOT_CHECKED);
    expect(html).toContain('data-pin-issues="unchecked"');
  });

  it("says None only when a verdict actually came back empty for that pin", async () => {
    const html = await renderStepEditor([]);

    expect(html).toContain(NONE);
    expect(html).not.toContain(NOT_CHECKED);
    expect(html).toContain('data-pin-issues="none"');
  });

  it("still renders the issues a verdict did report against the pin they name", async () => {
    const issues: readonly FormIssue[] = [
      {
        code: "UNPUBLISHED_QUESTION_PIN",
        message: "pins a version that is not published",
        path: { question: "q_at_fault_accident" },
      },
    ];

    const html = await renderStepEditor(issues);

    expect(html).toContain('data-issue-code="UNPUBLISHED_QUESTION_PIN"');
    expect(html, "a pin with an issue does not also say None").not.toContain(NONE);
  });

  it("leaves the step rail bare rather than badging a zero it was never given", async () => {
    const withoutVerdict = await renderStepsRail(new Map());
    const withVerdict = await renderStepsRail(new Map([[STEP.stepId, 2]]));

    // Absence rather than a claim: the rail has no "0 issues" state to render, which is
    // what lets the panel's "not checked yet" and this rail sit on one screen without
    // contradicting each other.
    expect(withoutVerdict, "no verdict, no badge").not.toContain("data-step-issues");
    expect(withVerdict).toContain('data-step-issues="2"');
  });
});
