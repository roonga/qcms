import { describe, expect, it } from "vitest";

import {
  agentActionPlans,
  agentActLabel,
  agentScreenLabel,
  agentStepDetail,
  auditKindLabel,
  emailsById,
  groupTitlesById,
  type AgentAuditNames,
} from "./audit-wording.ts";
import type { AgentAuditRow } from "./types.ts";

const NAMES: AgentAuditNames = {
  groups: groupTitlesById([{ teamId: "tm_1", roles: ["forms.editor"], environments: [] }]),
  people: emailsById([{ userId: "usr_2", email: "held@qcms.test" }]),
};

function row(overrides: Partial<AgentAuditRow> = {}): AgentAuditRow {
  return {
    id: "aa_1",
    proposalId: "prp_1",
    stepIndex: 0,
    stepCount: 1,
    actor: "usr_1",
    actorEmail: "owner@qcms.test",
    environment: "test",
    formId: null,
    kind: "access.grant",
    screen: "/workspaces/[workspaceId]/access-groups",
    proposedAt: "2026-07-20T00:00:00.000Z",
    confirmedAt: "2026-07-20T00:01:00.000Z",
    detail: "tm_1",
    ...overrides,
  };
}

describe("audit wording", () => {
  it("says each access-audit act in words and leaves an unfamiliar one as it arrived", () => {
    expect(auditKindLabel("grant")).toBe("Granted");
    expect(auditKindLabel("erasure")).toBe("Erased responses");
    expect(auditKindLabel("something.new")).toBe("something.new");
  });

  it("says each assistant act in words and leaves an unfamiliar kind as it arrived", () => {
    expect(agentActLabel("access.groupCreate")).toBe("Created an access group");
    expect(agentActLabel("link.mint")).toBe("Created respondent links");
    expect(agentActLabel("something.new")).toBe("something.new");
  });

  it("names the screen a step reached, and an unknown route reads as its pattern", () => {
    expect(agentScreenLabel("/workspaces/[workspaceId]/members")).toBe("Members");
    expect(agentScreenLabel("/forms/[formId]/rules")).toBe("Rules");
    expect(agentScreenLabel("/nowhere")).toBe("/nowhere");
  });

  it("labels the one detail a kind records and resolves the group or person it names", () => {
    expect(agentStepDetail("access.grant", "tm_1", NAMES)).toEqual({
      label: "Access group",
      value: "Form editor, in every environment",
    });
    expect(agentStepDetail("access.revoke", "usr_2", NAMES)).toEqual({
      label: "Person",
      value: "held@qcms.test",
    });
    expect(agentStepDetail("link.mint", "4", NAMES)).toEqual({
      label: "How many",
      value: "4",
    });
  });

  it("marks a group or person taken down since as removed rather than hiding the act", () => {
    expect(agentStepDetail("access.groupRemove", "tm_gone", NAMES)?.value).toBe(
      "tm_gone (removed)",
    );
  });

  it("offers no detail for a kind that records none, or for a row that carries none", () => {
    expect(agentStepDetail("response.export", "whatever", NAMES)).toBeUndefined();
    expect(agentStepDetail("access.grant", null, NAMES)).toBeUndefined();
  });

  it("groups rows into plans, newest plan first, each plan's steps in the order they ran", () => {
    const plans = agentActionPlans([
      row({ id: "a", proposalId: "prp_2", stepIndex: 1, stepCount: 2 }),
      row({ id: "b", proposalId: "prp_2", stepIndex: 0, stepCount: 2 }),
      row({ id: "c", proposalId: "prp_1", stepIndex: 0, stepCount: 1 }),
    ]);
    expect(plans.map((plan) => plan.proposalId)).toEqual(["prp_2", "prp_1"]);
    expect(plans[0]?.steps.map((step) => step.id)).toEqual(["b", "a"]);
    expect(plans[0]?.heading).toBe("Plan of 2 steps, confirmed by owner@qcms.test");
    expect(plans[1]?.heading).toBe("One step, confirmed by owner@qcms.test");
  });

  it("names a removed account by its id in the plan heading", () => {
    const plans = agentActionPlans([row({ actorEmail: null })]);
    expect(plans[0]?.heading).toBe("One step, confirmed by usr_1 (account removed)");
  });
});
