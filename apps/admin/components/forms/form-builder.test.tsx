import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runStepAction } from "@/components/agent/step-actions";
import type { AgentPlanStep } from "@/lib/forms/assist-stream";
import { AUTOSAVE_DEBOUNCE_MS } from "@/lib/forms/autosave";
import type { SaveDraftState } from "@/lib/forms/builder-state";
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

const EXPIRED = {
  status: "error" as const,
  issues: [],
  warnings: [],
  code: "AGENT_ACCEPT_EXPIRED",
  message: "That proposal is more than ten minutes old. Ask the assistant again.",
};

type SaveCall = [
  { title: Record<string, string>; steps: readonly { title: Record<string, string> }[] },
  unknown,
  unknown,
  unknown,
];

function titleField(): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(t("forms.builder.formTitle"));
}

function choice(): HTMLElement | null {
  return screen.queryByTestId("qcms-builder-accept-choice");
}

function press(key: "forms.builder.assistantChangeUndo" | "forms.builder.assistantChangeKeep") {
  fireEvent.click(screen.getByRole("button", { name: t(key) }));
}

/** Lets React commit and the debounce clock reach `ms`, in that order. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

afterEach(() => {
  vi.useRealTimers();
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

  it("pauses autosave and asks what to do when the accept is refused", async () => {
    const actions = builderActions();
    actions.saveDraft
      .mockResolvedValueOnce(EXPIRED)
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
    await waitFor(() => expect(choice()).not.toBeNull(), { timeout: 3000 });

    fireEvent.change(titleField(), { target: { value: "An edit while the choice shows" } });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(actions.saveDraft).toHaveBeenCalledTimes(1);
    expect(titleField().value).toBe("Vehicle insurance quote");
  });

  it("restores the draft the assistant replaced, and saves that, when the change is undone", async () => {
    const actions = builderActions();
    actions.saveDraft
      .mockResolvedValueOnce(EXPIRED)
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
    await waitFor(() => expect(choice()).not.toBeNull(), { timeout: 3000 });

    press("forms.builder.assistantChangeUndo");
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const [restored, accept, , adopt] = actions.saveDraft.mock.calls[1] as SaveCall;
    expect(accept).toBeUndefined();
    expect(adopt).toBeUndefined();
    expect(restored.steps[0]?.title["en"]).toBe("Basics");
    expect(choice()).toBeNull();
  });

  it("saves the content plainly under the refused token when the user keeps it as their own edit", async () => {
    const actions = builderActions();
    actions.saveDraft
      .mockResolvedValueOnce(EXPIRED)
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
    await waitFor(() => expect(choice()).not.toBeNull(), { timeout: 3000 });

    press("forms.builder.assistantChangeKeep");
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const [kept, accept, , adopt] = actions.saveDraft.mock.calls[1] as SaveCall;
    expect(accept).toBeUndefined();
    expect(adopt).toEqual({ token: ACCEPT_TOKEN });
    expect(kept.steps[0]?.title["en"]).toBe("Expired");
    await waitFor(() => expect(choice()).toBeNull(), { timeout: 3000 });
  });

  it("leaves the choice open, and the content unsaved, when the keep is not recorded", async () => {
    const actions = builderActions();
    actions.saveDraft
      .mockResolvedValueOnce(EXPIRED)
      .mockResolvedValueOnce({
        status: "error" as const,
        issues: [],
        warnings: [],
        code: "AGENT_ADOPT_SIGNATURE",
        message: "Only a proposal the assistant made can be kept as your own edit.",
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
    await waitFor(() => expect(choice()).not.toBeNull(), { timeout: 3000 });

    press("forms.builder.assistantChangeKeep");
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(
      () =>
        expect(
          screen.getByRole<HTMLButtonElement>("button", {
            name: t("forms.builder.assistantChangeUndo"),
          }).disabled,
        ).toBe(false),
      { timeout: 3000 },
    );
    expect(choice()).not.toBeNull();

    press("forms.builder.assistantChangeKeep");
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(3), { timeout: 3000 });
    const [, accept, , adopt] = actions.saveDraft.mock.calls[2] as SaveCall;
    expect(accept).toBeUndefined();
    expect(adopt).toEqual({ token: ACCEPT_TOKEN });
    await waitFor(() => expect(choice()).toBeNull(), { timeout: 3000 });
  });

  it("retries a persistently failing accept until its token expires, then keeps every edit made since", async () => {
    const actions = builderActions();
    const taken = {
      status: "error" as const,
      issues: [],
      warnings: [],
      code: "QUESTION_ID_TAKEN",
      message: "That question id is in use.",
    };
    actions.saveDraft
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(taken)
      .mockResolvedValueOnce(EXPIRED)
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );
    await confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Proposed") }));
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(1), { timeout: 3000 });

    for (const [index, title] of ["First edit", "Second edit"].entries()) {
      fireEvent.change(titleField(), { target: { value: title } });
      await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(index + 2), {
        timeout: 3000,
      });
    }

    expect(actions.saveDraft.mock.calls[1]?.[1]).toEqual({
      token: ACCEPT_TOKEN,
      newQuestions: [],
    });
    await waitFor(() => expect(choice()).not.toBeNull(), { timeout: 3000 });

    press("forms.builder.assistantChangeKeep");
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(4), { timeout: 3000 });
    const [kept, accept, , adopt] = actions.saveDraft.mock.calls[3] as SaveCall;
    expect(accept).toBeUndefined();
    expect(adopt).toEqual({ token: ACCEPT_TOKEN });
    expect(kept.title["en"]).toBe("Second edit");
    expect(kept.steps[0]?.title["en"]).toBe("Proposed");
  });

  it("reloads the stored draft when a lost accept response makes the retry a replay", async () => {
    const actions = builderActions();
    const accepted = {
      ...renamedDraft("Accepted on the server"),
      title: { en: "Accepted on the server" },
    };
    actions.saveDraft
      .mockResolvedValueOnce({
        status: "error" as const,
        issues: [],
        warnings: [],
        code: "UNREACHABLE",
        message: "",
      })
      .mockResolvedValueOnce({
        status: "error" as const,
        issues: [],
        warnings: [],
        code: "AGENT_ACCEPT_REPLAYED",
        message: "That proposal was already applied.",
      })
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    const readStoredDraft = vi
      .fn()
      .mockResolvedValue({ status: "read" as const, definition: accepted });
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        readStoredDraft={readStoredDraft}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );
    await confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Accepted on the server") }));
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(1), { timeout: 3000 });

    fireEvent.change(screen.getByLabelText(t("forms.builder.formTitle")), {
      target: { value: "An edit the user made meanwhile" },
    });
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(actions.saveDraft.mock.calls[1]?.[1]).toEqual({
      token: ACCEPT_TOKEN,
      newQuestions: [],
    });

    await waitFor(() => expect(readStoredDraft).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(3), { timeout: 3000 });
    const [reloaded, accept] = actions.saveDraft.mock.calls[2] as [
      { title: Record<string, string>; steps: readonly { title: Record<string, string> }[] },
      unknown,
    ];
    expect(accept).toBeUndefined();
    expect(reloaded.title["en"]).toBe("Accepted on the server");
    expect(reloaded.steps[0]?.title["en"]).toBe("Accepted on the server");
  });

  it("keeps the draft on screen when the reload after a replay cannot be read", async () => {
    const actions = builderActions();
    actions.saveDraft
      .mockResolvedValueOnce({
        status: "error" as const,
        issues: [],
        warnings: [],
        code: "AGENT_ACCEPT_REPLAYED",
        message: "That proposal was already applied.",
      })
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    const readStoredDraft = vi.fn().mockRejectedValue(new Error("unreachable"));
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        readStoredDraft={readStoredDraft}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );
    await confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Already applied") }));
    await waitFor(() => expect(readStoredDraft).toHaveBeenCalled(), { timeout: 3000 });

    fireEvent.change(screen.getByLabelText(t("forms.builder.formTitle")), {
      target: { value: "Still editable" },
    });
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const [kept, accept] = actions.saveDraft.mock.calls[1] as [
      { title: Record<string, string>; steps: readonly { title: Record<string, string> }[] },
      unknown,
    ];
    expect(accept).toBeUndefined();
    expect(kept.title["en"]).toBe("Still editable");
    expect(kept.steps[0]?.title["en"]).toBe("Already applied");
  });

  it("saves nothing when the refusal lands on an edit whose debounce timer is already armed", async () => {
    vi.useFakeTimers();
    const actions = builderActions();
    let settleAccept!: (state: SaveDraftState) => void;
    actions.saveDraft
      .mockImplementationOnce(
        () =>
          new Promise<SaveDraftState>((resolve) => {
            settleAccept = resolve;
          }),
      )
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );

    void confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Expired") }));
    await elapse(AUTOSAVE_DEBOUNCE_MS);
    expect(actions.saveDraft).toHaveBeenCalledTimes(1);

    // The user types while the accept is still in flight, arming a debounce timer of its own.
    fireEvent.change(titleField(), { target: { value: "Edit in flight" } });

    // The refusal lands with no render between it and that timer, which is the gap the hold closes.
    settleAccept(EXPIRED);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);

    await elapse(AUTOSAVE_DEBOUNCE_MS * 4);
    expect(actions.saveDraft, "no plain save of the assistant's content").toHaveBeenCalledTimes(1);
    expect(choice()).not.toBeNull();
  });

  it("undoes a superseding accept to the last stored draft, not to the proposal it replaced", async () => {
    const actions = builderActions();
    actions.saveDraft
      .mockResolvedValueOnce({
        status: "error" as const,
        issues: [],
        warnings: [],
        code: "QUESTION_ID_TAKEN",
        message: "That question id is in use.",
      })
      .mockResolvedValueOnce(EXPIRED)
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );

    await confirmApplyDraft(applyDraftStep({ definition: renamedDraft("First proposal") }));
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(1), { timeout: 3000 });

    await confirmApplyDraft(
      applyDraftStep({ definition: renamedDraft("Second proposal"), acceptToken: "acc.tok2" }),
    );
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(actions.saveDraft.mock.calls[1]?.[1]).toEqual({ token: "acc.tok2", newQuestions: [] });
    await waitFor(() => expect(choice()).not.toBeNull(), { timeout: 3000 });

    press("forms.builder.assistantChangeUndo");
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalledTimes(3), { timeout: 3000 });
    const [restored, accept, , adopt] = actions.saveDraft.mock.calls[2] as SaveCall;
    expect(accept).toBeUndefined();
    expect(adopt).toBeUndefined();
    expect(restored.steps[0]?.title["en"]).toBe("Basics");

    for (const call of actions.saveDraft.mock.calls as SaveCall[]) {
      const [sent, sentAccept, , sentAdopt] = call;
      if (sent.steps[0]?.title["en"] !== "First proposal") continue;
      expect(sentAccept ?? sentAdopt, "no proposal is stored without a record").toBeDefined();
    }
  });

  it("refuses an accept that arrives before the refusal it follows has rendered", async () => {
    vi.useFakeTimers();
    const actions = builderActions();
    let settleAccept!: (state: SaveDraftState) => void;
    actions.saveDraft
      .mockImplementationOnce(
        () =>
          new Promise<SaveDraftState>((resolve) => {
            settleAccept = resolve;
          }),
      )
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );

    void confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Expired") }));
    await elapse(AUTOSAVE_DEBOUNCE_MS);
    expect(actions.saveDraft).toHaveBeenCalledTimes(1);

    // The refusal raises the hold, and the accept below lands before the choice it puts up renders.
    settleAccept(EXPIRED);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    let superseding: { outcome: string } | undefined;
    void confirmApplyDraft(
      applyDraftStep({ definition: renamedDraft("Second proposal"), acceptToken: "acc.tok2" }),
    ).then((result) => {
      superseding = result;
    });

    await elapse(AUTOSAVE_DEBOUNCE_MS * 4);
    // Left pending it would never settle, and its token would ride out on the keep below.
    expect(superseding?.outcome).toBe("failed");
    expect(actions.saveDraft).toHaveBeenCalledTimes(1);
    expect(choice()).not.toBeNull();

    press("forms.builder.assistantChangeKeep");
    await elapse(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(actions.saveDraft).toHaveBeenCalledTimes(2);
    const [kept, accept, , adopt] = actions.saveDraft.mock.calls[1] as SaveCall;
    expect(accept, "the refused proposal's accept token is never sent again").toBeUndefined();
    expect(adopt).toEqual({ token: ACCEPT_TOKEN });
    expect(kept.steps[0]?.title["en"]).toBe("Expired");
  });

  it("dismisses the choice and reloads the stored draft when a lost keep response replays", async () => {
    const actions = builderActions();
    const stored = { ...renamedDraft("Expired"), title: { en: "Kept on the server" } };
    actions.saveDraft
      .mockResolvedValueOnce(EXPIRED)
      .mockResolvedValueOnce({
        status: "error" as const,
        issues: [],
        warnings: [],
        code: "AGENT_ADOPT_REPLAYED",
        message: "That change is already recorded as your own edit.",
      })
      .mockResolvedValue({ status: "saved" as const, issues: [], warnings: [] });
    const readStoredDraft = vi
      .fn()
      .mockResolvedValue({ status: "read" as const, definition: stored });
    render(
      <FormBuilder
        detail={DETAIL}
        {...CHROME}
        {...actions}
        readStoredDraft={readStoredDraft}
        assist={{ endpoint: "/forms/frm_quote/assist" }}
      />,
    );
    await confirmApplyDraft(applyDraftStep({ definition: renamedDraft("Expired") }));
    await waitFor(() => expect(choice()).not.toBeNull(), { timeout: 3000 });

    press("forms.builder.assistantChangeKeep");
    await waitFor(() => expect(readStoredDraft).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(choice()).toBeNull(), { timeout: 3000 });
    await waitFor(() => expect(titleField().value).toBe("Kept on the server"), { timeout: 3000 });
    expect(
      screen.queryByRole("button", { name: t("forms.builder.assistantChangeUndo") }),
      "no Undo over a keep the server recorded",
    ).toBeNull();
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
