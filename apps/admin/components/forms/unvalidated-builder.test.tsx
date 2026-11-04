import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import type { DraftForm, DraftStep, FormIssue, PinnableQuestion } from "../../lib/forms/types.ts";

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

const NONE = ">None<";

const NOT_CHECKED = "Not checked";

async function renderStepEditor(issues: readonly FormIssue[] | undefined): Promise<string> {
  const { StepEditor } = await import("./step-editor.tsx");
  return renderToStaticMarkup(
    <StepEditor
      draft={DRAFT}
      step={STEP}
      library={{ ok: true, data: LIBRARY }}
      issues={issues}
      onAddPins={() => undefined}
      onMovePin={() => undefined}
      onRemovePin={() => undefined}
      onReorderPin={() => undefined}
      onAddGroup={() => undefined}
      onOpenGroup={() => undefined}
      onMoveGroup={() => undefined}
      onRemoveGroup={() => undefined}
    />,
  );
}

/* Warm both import graphs before timing assertions; cold imports can otherwise exhaust the shared test
   timeout. */
beforeAll(async () => {
  await renderStepEditor(undefined);
}, 60_000);

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
});
