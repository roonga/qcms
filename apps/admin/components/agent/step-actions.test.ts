import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialCard, startRun } from "@/lib/agent/plan-state";
import { runPlan } from "@/lib/agent/runner";
import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import type { DraftForm } from "@/lib/forms/types";

type ActionDouble = (...args: readonly unknown[]) => Promise<unknown>;

const reviewReleaseAction = vi.fn<ActionDouble>();
const confirmPublishAction = vi.fn<ActionDouble>();
const accept = vi.fn<(...args: readonly unknown[]) => void>();

type AcceptSettled = { saved: true } | { saved: false; message: string };
let acceptSettles: () => Promise<AcceptSettled> = () => Promise.resolve({ saved: true });

vi.mock("@/app/(shell)/forms/actions", () => ({
  confirmPublishAction: (...args: readonly unknown[]): Promise<unknown> =>
    confirmPublishAction(...args),
  reviewReleaseAction: (...args: readonly unknown[]): Promise<unknown> =>
    reviewReleaseAction(...args),
  createFormForCardAction: vi.fn(),
  mintLinksAction: vi.fn(),
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
    accept: (...args: readonly unknown[]): Promise<AcceptSettled> => {
      accept(...args);
      return acceptSettles();
    },
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
    acceptToken: "acc.tok",
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

  it("runs the publish only after the accept's own save has landed", async () => {
    const { runStepAction } = await import("./step-actions");
    const held: { land?: (value: AcceptSettled) => void } = {};
    acceptSettles = () =>
      new Promise((resolve) => {
        held.land = resolve;
      });
    try {
      const running = runPlan({
        proposal: PLAN,
        card: startRun(initialCard(PLAN)),
        runStep: runStepAction,
        now: () => NOW,
        windowLeftMs: () => WINDOW_LEFT,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(accept).toHaveBeenCalledTimes(1);
      expect(reviewReleaseAction).not.toHaveBeenCalled();
      held.land?.({ saved: true });
      expect((await running).state).toBe("done");
      expect(confirmPublishAction).toHaveBeenCalledTimes(1);
    } finally {
      acceptSettles = () => Promise.resolve({ saved: true });
    }
  });

  it("stops the plan when the accept's save fails, so nothing is published", async () => {
    const { runStepAction } = await import("./step-actions");
    acceptSettles = () => Promise.resolve({ saved: false, message: "refused" });
    try {
      const card = await runPlan({
        proposal: PLAN,
        card: startRun(initialCard(PLAN)),
        runStep: runStepAction,
        now: () => NOW,
        windowLeftMs: () => WINDOW_LEFT,
      });
      expect(card.steps.map((step) => step.state)).toEqual(["failed", "not-run"]);
      expect(confirmPublishAction).not.toHaveBeenCalled();
    } finally {
      acceptSettles = () => Promise.resolve({ saved: true });
    }
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

describe("a form.release step", () => {
  const RELEASE: AgentPlanStep = {
    kind: "form.release",
    screen: "/forms/[formId]/publish",
    args: { formId: "frm_quote", version: 3, environment: "prod" },
    environment: "prod",
    handOff: false,
    local: false,
    card: { titleKey: "agent.card.form.release.title", consequenceKeys: [] },
    resultAllowlist: ["version", "environment"],
  };
  const RELEASE_PLAN: AgentProposal = {
    proposalId: "prp_release",
    token: "tok",
    steps: [RELEASE],
    proposedAt: PROPOSED_AT,
    expiresAt: "2026-07-20T00:10:00.000Z",
    formId: "frm_quote",
    currentEnvironment: "test",
  };

  function reviewOfVersion(sequence: number | null): unknown {
    return {
      ok: true,
      data: {
        source: { kind: "version", version: 3, publishedBy: "usr_other" },
        workflowRevision: 2,
        workflowSource: "configured",
        targets: [
          {
            environment: "prod",
            currentVersion: 2,
            currentSequence: sequence,
            closed: false,
            evidence: [],
            blockers: [],
            twoPerson: { applies: true, refusedAsAuthor: false },
            protected: true,
          },
        ],
      },
    };
  }

  it("confirms on the wizard's batch route, carrying both expectations", async () => {
    const { runStepAction } = await import("./step-actions");
    reviewReleaseAction.mockResolvedValue(reviewOfVersion(11));
    confirmPublishAction.mockResolvedValue({ status: "done", version: 3, froze: false });

    const card = await runPlan({
      proposal: RELEASE_PLAN,
      card: startRun(initialCard(RELEASE_PLAN)),
      runStep: runStepAction,
      now: () => NOW,
      windowLeftMs: () => WINDOW_LEFT,
    });

    expect(card.state).toBe("done");
    expect(reviewReleaseAction).toHaveBeenCalledWith("frm_quote", { kind: "version", version: 3 });
    const [, request, proposal] = confirmPublishAction.mock.calls[0] as readonly unknown[];
    expect(proposal).toEqual({ agentProposal: "tok", step: 0 });
    expect(request).toMatchObject({
      expectedWorkflowRevision: 2,
      source: { kind: "version", version: 3 },
      targets: [{ environment: "prod", expectedSequence: 11 }],
    });
  });

  it("fails the step when the review no longer offers that destination", async () => {
    const { runStepAction } = await import("./step-actions");
    reviewReleaseAction.mockResolvedValue({
      ok: true,
      data: {
        source: { kind: "version", version: 3, publishedBy: null },
        workflowRevision: 2,
        workflowSource: "configured",
        targets: [],
      },
    });

    const card = await runPlan({
      proposal: RELEASE_PLAN,
      card: startRun(initialCard(RELEASE_PLAN)),
      runStep: runStepAction,
      now: () => NOW,
      windowLeftMs: () => WINDOW_LEFT,
    });

    expect(card.steps[0]?.state).toBe("failed");
    expect(confirmPublishAction).not.toHaveBeenCalled();
  });
});
