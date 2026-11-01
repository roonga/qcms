import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialCard, startRun } from "@/lib/agent/plan-state";
import { runPlan } from "@/lib/agent/runner";
import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import type { DraftForm } from "@/lib/forms/types";

/**
 * The step a plan runs locally and the step index the API is told.
 *
 * `apply-draft` reaches no route, so the token binds only the steps that do and a card
 * index is no longer the token's step index. A publish that followed a local step and sent
 * its own card index would be checked against the wrong step's digest and refused, which
 * is a failure the runner cannot report as anything but the screen's own refusal. This
 * file runs the two-step plan the ruling describes through the real runner and the real
 * step dispatch, with the screen's own actions as the only doubles.
 */

type ActionDouble = (...args: readonly unknown[]) => Promise<unknown>;

const reviewReleaseAction = vi.fn<ActionDouble>();
const confirmPublishAction = vi.fn<ActionDouble>();
const accept = vi.fn<(...args: readonly unknown[]) => Promise<unknown>>();

vi.mock("@/app/(shell)/forms/actions", () => ({
  confirmPublishAction: (...args: readonly unknown[]): Promise<unknown> =>
    confirmPublishAction(...args),
  reviewReleaseAction: (...args: readonly unknown[]): Promise<unknown> =>
    reviewReleaseAction(...args),
  createFormForCardAction: vi.fn(),
  mintLinksAction: vi.fn(),
  releaseVersionAction: vi.fn(),
  revokeLinkAction: vi.fn(),
  setFormStatusAction: vi.fn(),
  updateSettingsAction: vi.fn(),
}));

const DRAFT: DraftForm = {
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

vi.mock("@/lib/agent/builder-assist-bridge", () => ({
  builderAssistSnapshot: () => ({
    endpoint: "/forms/frm_quote/assist",
    canPropose: true,
    draft: DRAFT,
    draftUpdatedAt: undefined,
    accept: (...args: readonly unknown[]): Promise<unknown> => accept(...args),
  }),
}));

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const NOW = new Date(PROPOSED_AT);
const WINDOW_LEFT = 10 * 60 * 1000;

const APPLY_DRAFT: AgentPlanStep = {
  kind: "apply-draft",
  screen: "/forms/[formId]",
  args: { formId: "frm_quote" },
  environment: "test",
  handOff: false,
  local: true,
  draft: {
    definition: { ...DRAFT, title: { en: "Vehicle insurance quote v2" } },
    newQuestions: [],
    issues: [],
    warnings: [],
  },
  card: { titleKey: "agent.card.apply-draft.title", consequenceKeys: [] },
  resultAllowlist: ["changes", "newQuestions"],
};

const PUBLISH: AgentPlanStep = {
  kind: "form.publish",
  screen: "/forms/[formId]",
  args: { formId: "frm_quote" },
  environment: "test",
  handOff: false,
  local: false,
  card: { titleKey: "agent.card.form.publish.title", consequenceKeys: [] },
  resultAllowlist: ["version", "environment"],
};

const PLAN: AgentProposal = {
  proposalId: "prp_apply_then_publish",
  token: "tok",
  steps: [APPLY_DRAFT, PUBLISH],
  proposedAt: PROPOSED_AT,
  expiresAt: "2026-07-20T00:10:00.000Z",
  formId: "frm_quote",
  currentEnvironment: "test",
};

beforeEach(() => {
  vi.clearAllMocks();
  reviewReleaseAction.mockResolvedValue({
    ok: true,
    data: {
      source: { kind: "draft", draftRevision: 4 },
      workflowRevision: 2,
      workflowSource: "configured",
      targets: [
        {
          environment: "test",
          currentVersion: null,
          currentSequence: 9,
          closed: false,
          evidence: [],
          blockers: [],
          twoPerson: { applies: false, refusedAsAuthor: false },
          protected: false,
        },
      ],
    },
  });
  confirmPublishAction.mockResolvedValue({ status: "done", version: 1, froze: true });
  accept.mockResolvedValue({ ok: true, changes: 1, newQuestions: 0 });
});

describe("a plan of apply-draft then form.publish", () => {
  it("runs end to end and sends the publish as token step 0", async () => {
    const { runStepAction } = await import("./step-actions");
    const started = startRun(initialCard(PLAN));

    const card = await runPlan({
      proposal: PLAN,
      card: started,
      runStep: runStepAction,
      now: () => NOW,
      windowLeftMs: () => WINDOW_LEFT,
    });

    expect(accept).toHaveBeenCalledTimes(1);
    expect(card.steps.map((step) => step.state)).toEqual(["done", "done"]);
    expect(card.state).toBe("done");
    expect(card.steps[1]?.result).toEqual({ version: 1, environment: "test" });

    expect(confirmPublishAction).toHaveBeenCalledTimes(1);
    const [formId, request, proposal] = confirmPublishAction.mock.calls[0] as readonly unknown[];
    expect(formId).toBe("frm_quote");
    expect(proposal).toEqual({ agentProposal: "tok", step: 0 });
    expect(request).toMatchObject({
      expectedWorkflowRevision: 2,
      source: { kind: "draft", draftRevision: 4 },
      targets: [{ environment: "test", expectedSequence: 9 }],
    });
  });

  it("carries no token on the local step, because it reaches no route", async () => {
    const { runStepAction } = await import("./step-actions");
    const seen: (string | undefined)[] = [];

    await runPlan({
      proposal: PLAN,
      card: startRun(initialCard(PLAN)),
      runStep: (request) => {
        seen.push(request.agentProposal);
        return runStepAction(request);
      },
      now: () => NOW,
      windowLeftMs: () => WINDOW_LEFT,
    });

    expect(seen).toEqual([undefined, "tok"]);
  });
});

describe("the step that applies a draft waits for the save", () => {
  it("reports Done only once the accept has stored the draft, and stops the plan when it has not", async () => {
    const { runStepAction } = await import("./step-actions");
    let settled = false;
    accept.mockImplementation(async () => {
      await Promise.resolve();
      settled = true;
      return { ok: true, changes: 3, newQuestions: 2 };
    });

    const card = await runPlan({
      proposal: PLAN,
      card: startRun(initialCard(PLAN)),
      runStep: (request) => {
        // The publish must not be sent while the accept is still in flight: the draft it
        // publishes, and the questions it pins, exist only once that save has landed.
        if (request.step.kind === "form.publish") expect(settled).toBe(true);
        return runStepAction(request);
      },
      now: () => NOW,
      windowLeftMs: () => WINDOW_LEFT,
    });

    expect(card.steps[0]?.result).toEqual({ changes: 3, newQuestions: 2 });
    expect(card.steps.map((step) => step.state)).toEqual(["done", "done"]);
  });

  it("fails the step with the store's own sentence when the accept is refused", async () => {
    const { runStepAction } = await import("./step-actions");
    accept.mockResolvedValue({ ok: false, message: "That question id is already in use." });

    const card = await runPlan({
      proposal: PLAN,
      card: startRun(initialCard(PLAN)),
      runStep: runStepAction,
      now: () => NOW,
      windowLeftMs: () => WINDOW_LEFT,
    });

    expect(card.steps[0]?.state).toBe("failed");
    expect(card.steps[0]?.message).toBe("That question id is already in use.");
    expect(card.steps[1]?.state).toBe("not-run");
    expect(confirmPublishAction).not.toHaveBeenCalled();
  });
});
