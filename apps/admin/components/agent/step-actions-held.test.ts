import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialCard, startRun } from "@/lib/agent/plan-state";
import { runPlan } from "@/lib/agent/runner";
import { t } from "@/lib/i18n/en";
import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";

/*
 * Criterion 91's second half: a step whose act the API stores for an Approver is not applied,
 * so the card holds the plan there. A 202 read as success would report a change nobody made.
 */

type ActionDouble = (...args: readonly unknown[]) => Promise<unknown>;

const confirmPublishAction = vi.fn<ActionDouble>();
const reviewReleaseAction = vi.fn<ActionDouble>();
const grantAccessGroupAction = vi.fn<ActionDouble>();
const saveWorkspaceSettingsAction = vi.fn<ActionDouble>();

vi.mock("@/app/(shell)/forms/actions", () => ({
  confirmPublishAction: (...args: readonly unknown[]): Promise<unknown> =>
    confirmPublishAction(...args),
  reviewReleaseAction: (...args: readonly unknown[]): Promise<unknown> =>
    reviewReleaseAction(...args),
  createFormForCardAction: vi.fn(),
  mintLinksAction: vi.fn(),
  revokeLinkAction: vi.fn(),
  saveDraftAction: vi.fn(),
  setFormStatusAction: vi.fn(),
  updateSettingsAction: vi.fn(),
}));

vi.mock("@/app/(shell)/workspaces/[workspaceId]/actions", () => ({
  createAccessGroupAction: vi.fn(),
  grantAccessGroupAction: (...args: readonly unknown[]): Promise<unknown> =>
    grantAccessGroupAction(...args),
  removeAccessGroupAction: vi.fn(),
  revokeAccessGroupAction: vi.fn(),
  saveWorkspaceSettingsAction: (...args: readonly unknown[]): Promise<unknown> =>
    saveWorkspaceSettingsAction(...args),
  setMemberRoleAction: vi.fn(),
}));

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const NOW = new Date(PROPOSED_AT);
const WINDOW_LEFT = 10 * 60 * 1000;

function proposalOf(step: AgentPlanStep): AgentProposal {
  return {
    proposalId: `prp_${step.kind}`,
    token: "tok",
    steps: [step],
    proposedAt: PROPOSED_AT,
    expiresAt: "2026-07-20T00:10:00.000Z",
    formId: "frm_quote",
    currentEnvironment: "prod",
  };
}

async function runOne(step: AgentPlanStep) {
  const { runStepAction } = await import("./step-actions");
  const proposal = proposalOf(step);
  return runPlan({
    proposal,
    card: startRun(initialCard(proposal)),
    runStep: runStepAction,
    now: () => NOW,
    windowLeftMs: () => WINDOW_LEFT,
  });
}

const PUBLISH: AgentPlanStep = {
  kind: "form.publish",
  screen: "/forms/[formId]",
  args: { formId: "frm_quote" },
  environment: "prod",
  handOff: false,
  local: false,
  card: { titleKey: "agent.card.form.publish.title", consequenceKeys: [] },
  resultAllowlist: ["version", "environment"],
};

const GRANT: AgentPlanStep = {
  kind: "access.grant",
  screen: "/workspaces/[workspaceId]/access-groups",
  args: { workspaceId: "wsp_a", teamId: "grp_viewers", email: "sam@qcms.test" },
  environment: "prod",
  handOff: false,
  local: false,
  card: { titleKey: "agent.card.access.grant.title", consequenceKeys: [] },
  resultAllowlist: ["teamId", "name"],
};

const SETTINGS: AgentPlanStep = {
  kind: "workspace.settings",
  screen: "/workspaces/[workspaceId]/settings",
  args: { workspaceId: "wsp_a", requireSecondApprover: false },
  environment: "prod",
  handOff: false,
  local: false,
  card: { titleKey: "agent.card.workspace.settings.title", consequenceKeys: [] },
  resultAllowlist: ["requireSecondApprover"],
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
          environment: "prod",
          currentVersion: null,
          currentSequence: 9,
          closed: false,
          evidence: [],
          blockers: [],
          twoPerson: { applies: true, refusedAsAuthor: false },
          protected: true,
        },
      ],
    },
  });
});

describe("a step the API held for an Approver", () => {
  it("holds the card on a draft publish answered 202, with no version reported", async () => {
    confirmPublishAction.mockResolvedValue({ status: "held" });

    const card = await runOne(PUBLISH);

    expect(card.steps[0]?.state).toBe("pending-approval");
    expect(card.state).toBe("pending-approval");
    expect(card.steps[0]?.message).toBe(t("agent.card.note.heldForApprover"));
    expect(card.steps[0]?.result).toEqual({ environment: "prod" });
  });

  it("holds the card on a self-grant answered 202", async () => {
    grantAccessGroupAction.mockResolvedValue({ status: "held", message: "waiting" });

    const card = await runOne(GRANT);

    expect(card.steps[0]?.state).toBe("pending-approval");
    expect(card.steps[0]?.message).toBe(t("agent.card.note.heldForApprover"));
  });

  it("holds the card on turning second approval off, answered 202", async () => {
    saveWorkspaceSettingsAction.mockResolvedValue({ status: "held", message: "waiting" });

    const card = await runOne(SETTINGS);

    expect(card.steps[0]?.state).toBe("pending-approval");
    expect(card.steps[0]?.message).toBe(t("agent.card.note.heldForApprover"));
  });

  it("still reports an applied act as done, so the hold is not vacuous", async () => {
    saveWorkspaceSettingsAction.mockResolvedValue({
      status: "done",
      message: "saved",
      requireSecondApprover: false,
    });

    const card = await runOne(SETTINGS);

    expect(card.steps[0]?.state).toBe("done");
    expect(card.state).toBe("done");
  });
});
