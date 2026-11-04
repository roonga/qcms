import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runStepAction } from "@/components/agent/step-actions";
import type { AgentPlanStep } from "@/lib/forms/assist-stream";
import type { FormDetail, PinnableQuestion } from "@/lib/forms/types";
import type { ReadState } from "@/lib/read-state";
import { t } from "@/lib/i18n/en";

import { useBuilderRail } from "@/lib/forms/builder-bridge";

import { FormBuilder } from "./form-builder";

function RailStandIn() {
  const rail = useBuilderRail();
  if (rail === undefined) return null;
  return (
    <div>
      {rail.draft.steps.map((step) => (
        <button
          key={step.stepId}
          type="button"
          onClick={() => {
            rail.choose(step.stepId);
          }}
        >
          {`rail: ${step.stepId}`}
        </button>
      ))}
    </div>
  );
}

const DETAIL: FormDetail = {
  formId: "frm_quote",
  slug: "vehicle-insurance-quote",
  defaultLocale: "en",
  status: "open",
  draft: {
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
  },
  draftSource: "open",
  versions: [],
  settings: { challengeRequired: false, minSubmitMs: null },
  challengeEnforceable: false,
  draftAgentAssisted: false,
  draftUpdatedAt: null,
  requiresSecondApprover: false,
  canWriteDraft: true,
};

const CHROME = {
  library: { ok: true, data: [] } as ReadState<readonly PinnableQuestion[]>,
  formActions: null,
  formMeta: null,
  concurrentNoticeRead: true,
};

function builderActions() {
  return {
    saveDraft: vi.fn().mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] }),
    validateDraft: vi
      .fn()
      .mockResolvedValue({ status: "ok" as const, valid: true, issues: [], warnings: [] }),
    updateSettings: vi.fn(),
  };
}

function applyDraftStep(draft: {
  readonly definition: unknown;
  readonly newQuestions?: readonly unknown[];
}): AgentPlanStep {
  return {
    kind: "apply-draft",
    screen: "/forms/[formId]",
    args: { formId: "frm_quote" },
    environment: "test",
    handOff: false,
    local: true,
    draft: {
      definition: draft.definition,
      newQuestions: draft.newQuestions ?? [],
      issues: [],
      warnings: [],
    },
    card: { titleKey: "agent.card.apply-draft.title", consequenceKeys: [] },
    resultAllowlist: ["changes", "newQuestions"],
  };
}

function confirmApplyDraft(step: AgentPlanStep) {
  return runStepAction({
    step,
    index: 0,
    args: step.args,
    agentProposal: undefined,
    tokenStep: 0,
    currentEnvironment: "test",
  });
}

function renamedDraft(title: string) {
  return {
    ...DETAIL.draft,
    steps: [
      {
        ...(DETAIL.draft?.steps[0] ?? { stepId: "", title: {}, items: [] }),
        title: { en: title },
      },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FormBuilder and the apply-draft card", () => {
  it("publishes nothing to the assistant when the assist prop is absent", async () => {
    render(<FormBuilder detail={DETAIL} {...CHROME} {...builderActions()} />);
    expect(screen.queryByRole("img", { name: t("agent.title") })).toBeNull();
    const result = await confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Nope") }));
    expect(result.outcome).toBe("failed");
  });

  it("saves a confirmed draft through the builder's own autosave path, agentAssisted: true", async () => {
    const actions = builderActions();
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );

    const result = await confirmApplyDraft(
      applyDraftStep({ definition: renamedDraft("Basics (renamed)") }),
    );
    expect(result.outcome).toBe("done");

    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalled(), { timeout: 2000 });

    const call = actions.saveDraft.mock.calls[0] as [
      { steps: readonly { stepId: string; title: Record<string, string> }[] },
      boolean,
    ];
    const [savedDraft, agentAssisted] = call;
    expect(agentAssisted).toBe(true);
    expect(savedDraft.steps[0]?.title["en"]).toBe("Basics (renamed)");
  });

  it("carries the draft's new question definitions into the accepting save", async () => {
    const actions = builderActions();
    const newQuestion = { questionId: "q_first_name", type: "shortText", label: { en: "First" } };
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );

    await confirmApplyDraft(
      applyDraftStep({
        definition: renamedDraft("Basics (with a new question)"),
        newQuestions: [newQuestion],
      }),
    );

    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalled(), { timeout: 2000 });

    const [, agentAssisted, newQuestions] = actions.saveDraft.mock.calls[0] as [
      unknown,
      boolean,
      readonly unknown[],
    ];
    expect(agentAssisted).toBe(true);
    expect(newQuestions).toEqual([newQuestion]);
  });

  it("returns to the form when the applied draft deletes the step on screen", async () => {
    render(
      <>
        <FormBuilder
          detail={DETAIL}
          {...CHROME}
          {...builderActions()}
          assist={{ endpoint: "/forms/frm_quote/assist" }}
        />
        <RailStandIn />
      </>,
    );

    await waitFor(() => expect(screen.getByText("rail: stp_basics")).toBeTruthy());
    fireEvent.click(screen.getByText("rail: stp_basics"));
    await waitFor(() => expect(screen.queryByLabelText(t("forms.builder.formTitle"))).toBeNull());

    await confirmApplyDraft(
      applyDraftStep({
        definition: {
          ...DETAIL.draft,
          steps: [
            {
              stepId: "stp_history",
              title: { en: "Driving history" },
              items: [{ questionId: "q_name", version: 1 }],
            },
          ],
        },
      }),
    );

    await waitFor(() => expect(screen.getByLabelText(t("forms.builder.formTitle"))).toBeTruthy());
  });
});
