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

const ACCEPT_TOKEN = "acc.tok";

function applyDraftStep(draft: {
  readonly definition: unknown;
  readonly newQuestions?: readonly unknown[];
  readonly acceptToken?: string | null;
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
      ...(draft.acceptToken === null ? {} : { acceptToken: draft.acceptToken ?? ACCEPT_TOKEN }),
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

  it("saves a confirmed draft through the builder's own autosave path, under its accept token", async () => {
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
      { token: string; newQuestions: readonly unknown[] },
    ];
    const [savedDraft, accept] = call;
    expect(accept).toEqual({ token: ACCEPT_TOKEN, newQuestions: [] });
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

    const [, accept] = actions.saveDraft.mock.calls[0] as [
      unknown,
      { token: string; newQuestions: readonly unknown[] },
    ];
    expect(accept).toEqual({ token: ACCEPT_TOKEN, newQuestions: [newQuestion] });
  });

  it("refuses a proposal that carries no accept token, and saves nothing", async () => {
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
      applyDraftStep({ definition: renamedDraft("Untokened"), acceptToken: null }),
    );
    expect(result.outcome).toBe("failed");
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(actions.saveDraft).not.toHaveBeenCalled();
  });

  it("retries a failed accept with its token on the next edit, then saves plainly", async () => {
    const actions = builderActions();
    actions.saveDraft
      .mockResolvedValueOnce({
        status: "error" as const,
        issues: [],
        warnings: [],
        code: "INTERNAL",
        message: "down",
      })
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );
    await confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Accepted") }));
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(1), { timeout: 2000 });

    fireEvent.change(screen.getByLabelText(t("forms.builder.formTitle")), {
      target: { value: "First edit" },
    });
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(actions.saveDraft.mock.calls[1]?.[1]).toEqual({ token: ACCEPT_TOKEN, newQuestions: [] });

    fireEvent.change(screen.getByLabelText(t("forms.builder.formTitle")), {
      target: { value: "Second edit" },
    });
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(3), { timeout: 2000 });
    expect(actions.saveDraft.mock.calls[2]?.[1]).toBeUndefined();
  });

  it("withdraws the proposal when the accept token is refused, rather than saving it plainly", async () => {
    const actions = builderActions();
    actions.saveDraft
      .mockResolvedValueOnce({
        status: "error" as const,
        issues: [],
        warnings: [],
        code: "AGENT_ACCEPT_EXPIRED",
        message: "That proposal is more than ten minutes old. Ask the assistant again.",
      })
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );
    await confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Expired") }));
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(2), { timeout: 3000 });

    const [restored, accept] = actions.saveDraft.mock.calls[1] as [
      { steps: readonly { title: Record<string, string> }[] },
      unknown,
    ];
    expect(accept).toBeUndefined();
    expect(restored.steps[0]?.title["en"]).toBe("Basics");
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
