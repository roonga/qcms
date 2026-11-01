import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePublishBuilderAssist } from "@/lib/agent/builder-assist-bridge";
import type { AgentDraftProposal } from "@/lib/forms/assist-stream";
import type { DraftForm } from "@/lib/forms/types";
import { t, tPlural } from "@/lib/i18n/en";

import { ApplyDraftDetail } from "./apply-draft-detail";

/**
 * What the `apply-draft` step shows: the diff against the working draft in full, and the
 * server's two advisory lists kept apart. Both were the shipped proposal panel's
 * guarantees and are now the card's.
 */

const CURRENT: DraftForm = {
  formId: "frm_quote",
  defaultLocale: "en",
  title: { en: "Vehicle insurance quote" },
  steps: [
    {
      stepId: "stp_basics",
      title: { en: "Basics" },
      items: [{ questionId: "q_name", version: 1 }],
    },
  ],
  rules: [],
};

/** Mounts the bridge the builder publishes, which is where the card reads the draft from. */
function WithBuilder({
  draft,
  current,
}: {
  readonly draft: AgentDraftProposal;
  readonly current: DraftForm | undefined;
}) {
  usePublishBuilderAssist(
    current === undefined
      ? undefined
      : {
          endpoint: "/forms/frm_quote/assist",
          canPropose: true,
          draft: current,
          draftUpdatedAt: undefined,
          accept: () => Promise.resolve({ ok: true, changes: 0, newQuestions: 0 }),
        },
  );
  return <ApplyDraftDetail draft={draft} id="card-0" />;
}

function proposed(overrides: Partial<AgentDraftProposal> = {}): AgentDraftProposal {
  return {
    definition: {
      formId: "frm_quote",
      defaultLocale: "en",
      title: { en: "Vehicle insurance quote" },
      steps: [
        {
          stepId: "stp_basics",
          title: { en: "Basics" },
          items: [{ questionId: "q_name", version: 1 }],
        },
        {
          stepId: "stp_history",
          title: { en: "Driving history" },
          items: [{ questionId: "q_accident", version: 1 }],
        },
      ],
      rules: [],
    },
    newQuestions: [],
    issues: [],
    warnings: [],
    ...overrides,
  };
}

describe("the apply-draft step's detail", () => {
  it("counts the changes and lists every one of them", () => {
    render(<WithBuilder draft={proposed()} current={CURRENT} />);
    const entries = screen.getByTestId("qcms-acard-diff").querySelectorAll("li");
    expect(entries.length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        tPlural("forms.assist.diffCount.one", "forms.assist.diffCount.other", entries.length),
      ),
    ).toBeTruthy();
    expect(screen.getByText("Added: Step: Driving history")).toBeTruthy();
  });

  it("says so when the draft changes nothing, rather than showing an empty list", () => {
    render(
      <WithBuilder
        draft={proposed({ definition: { ...CURRENT } as unknown as Record<string, unknown> })}
        current={CURRENT}
      />,
    );
    expect(screen.getByText(t("forms.assist.diffEmpty"))).toBeTruthy();
  });

  it("reads a clean verdict as a sentence, not as an empty issue list", () => {
    render(<WithBuilder draft={proposed()} current={CURRENT} />);
    expect(screen.getByText(t("forms.assist.validationClean"))).toBeTruthy();
    expect(screen.queryByTestId("qcms-acard-warnings")).toBeNull();
  });

  it("keeps the two advisory lists apart, each with its own count", () => {
    render(
      <WithBuilder
        draft={proposed({
          issues: [{ code: "DANGLING_STEP_REF", message: "No such step." }],
          warnings: [{ code: "MULTICHOICE_SAME_STEP_TARGET", message: "Reveals on its own step." }],
        })}
        current={CURRENT}
      />,
    );
    expect(screen.queryByText(t("forms.assist.validationClean"))).toBeNull();
    expect(
      screen.getByText(tPlural("forms.validation.countOne", "forms.validation.count", 1)),
    ).toBeTruthy();
    const warnings = screen.getByTestId("qcms-acard-warnings");
    expect(warnings.textContent).toContain(t("forms.warning.heading"));
    expect(warnings.textContent).toContain(
      tPlural("forms.warning.countOne", "forms.warning.count", 1),
    );
  });

  /**
   * Issue #1065: a step pin on a question this same draft invents is reported by the
   * kernel as dangling, and the builder's sentence for that code tells the author to pin a
   * question that is already pinned. Say what actually happens instead.
   */
  it("explains a pin on a question the draft itself invents", () => {
    const definition = {
      formId: "frm_quote",
      defaultLocale: "en",
      title: { en: "Vehicle insurance quote" },
      steps: [
        {
          stepId: "stp_new",
          title: { en: "About you" },
          items: [{ questionId: "q_preferred_name", version: 1 }],
        },
      ],
      rules: [],
    };
    render(
      <WithBuilder
        draft={proposed({
          definition,
          newQuestions: [
            { questionId: "q_preferred_name", type: "shortText", label: { en: "Preferred name" } },
          ],
          issues: [
            {
              code: "DANGLING_QUESTION_REF",
              message: "Pin a question that exists.",
              path: { step: "stp_new", question: "q_preferred_name" },
            },
          ],
        })}
        current={CURRENT}
      />,
    );
    expect(
      screen.getByText(t("forms.assist.newQuestionPending", { questionId: "q_preferred_name" })),
    ).toBeTruthy();
  });

  it("still shows both lists with no builder mounted, and no diff it cannot compute", () => {
    render(
      <WithBuilder
        draft={proposed({ warnings: [{ code: "MULTICHOICE_SAME_STEP_TARGET", message: "Hmm." }] })}
        current={undefined}
      />,
    );
    expect(screen.queryByTestId("qcms-acard-diff")).toBeNull();
    expect(screen.getByTestId("qcms-acard-warnings")).toBeTruthy();
  });
});
