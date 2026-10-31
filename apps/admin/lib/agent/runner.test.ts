import { describe, expect, it, vi } from "vitest";

import type { AgentPlanStep, AgentProposal } from "../forms/assist-stream.ts";

import { initialCard, startRun, type AgentCardView } from "./plan-state.ts";
import { hasUnresolvedReference, resolveArgs, runPlan, type RunStepRequest } from "./runner.ts";

/**
 * The sequential runner (083 D0, section 6.4, criterion 4): in order, one at a time,
 * stop at the first failure, never retry, and send nothing after a hold or a Stop.
 */

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const EXPIRES_AT = "2026-07-20T00:10:00.000Z";
const NOW = new Date(PROPOSED_AT);

function step(overrides: Partial<AgentPlanStep> = {}): AgentPlanStep {
  return {
    kind: "link.mint",
    screen: "/forms/[formId]/links",
    args: { formId: "frm_a", count: 2 },
    environment: "test",
    handOff: false,
    card: { titleKey: "agent.card.link.mint.title", consequenceKeys: [] },
    resultAllowlist: ["count"],
    ...overrides,
  };
}

const PUBLISH = step({
  kind: "form.publish",
  args: { formId: "frm_a" },
  resultAllowlist: ["version"],
});
const RELEASE = step({
  kind: "form.release",
  args: { formId: "frm_a", version: { fromStep: 0, field: "version" }, environment: "test" },
  resultAllowlist: ["version", "environment"],
});

function proposal(steps: readonly AgentPlanStep[], token: string | undefined = "tok"): AgentProposal {
  return {
    proposalId: "prp_run",
    token,
    steps,
    proposedAt: PROPOSED_AT,
    expiresAt: EXPIRES_AT,
    formId: "frm_a",
  };
}

function started(plan: AgentProposal): AgentCardView {
  return startRun(initialCard(plan, NOW.getTime()));
}

describe("runPlan", () => {
  it("calls each step's action in order, with the token and that step's index", async () => {
    const plan = proposal([PUBLISH, RELEASE, step()]);
    const seen: RunStepRequest[] = [];
    const card = await runPlan({
      proposal: plan,
      card: started(plan),
      now: () => NOW,
      runStep: (request) => {
        seen.push(request);
        return Promise.resolve({ outcome: "done", result: { version: 7, count: 2 } });
      },
    });

    expect(seen.map((request) => [request.index, request.step.kind])).toEqual([
      [0, "form.publish"],
      [1, "form.release"],
      [2, "link.mint"],
    ]);
    expect(seen.every((request) => request.agentProposal === "tok")).toBe(true);
    expect(card.state).toBe("done");
  });

  it("resolves a reference from what the earlier step reported", async () => {
    const plan = proposal([PUBLISH, RELEASE]);
    const seen: RunStepRequest[] = [];
    await runPlan({
      proposal: plan,
      card: started(plan),
      now: () => NOW,
      runStep: (request) => {
        seen.push(request);
        return Promise.resolve({ outcome: "done", result: { version: 7, environment: "test" } });
      },
    });
    expect(seen[1]?.args).toEqual({ formId: "frm_a", version: 7, environment: "test" });
  });

  it("stops at the first failure and never sends the next step", async () => {
    const plan = proposal([PUBLISH, RELEASE, step()]);
    const runStep = vi
      .fn<
        (request: RunStepRequest) => Promise<{
          outcome: "done" | "failed";
          message?: string;
          result?: Record<string, unknown>;
        }>
      >()
      .mockResolvedValueOnce({ outcome: "done", result: { version: 3 } })
      .mockResolvedValueOnce({ outcome: "failed", message: "Refused." });

    const card = await runPlan({
      proposal: plan,
      card: started(plan),
      now: () => NOW,
      runStep,
    });
    expect(runStep).toHaveBeenCalledTimes(2);
    expect(card.steps.map((view) => view.state)).toEqual(["done", "failed", "not-run"]);
  });

  it("sends nothing further once a step is held for a second approver", async () => {
    const plan = proposal([PUBLISH, step()]);
    const runStep = vi
      .fn<(request: RunStepRequest) => Promise<{ outcome: "pending-approval" }>>()
      .mockResolvedValue({ outcome: "pending-approval" });
    const card = await runPlan({ proposal: plan, card: started(plan), now: () => NOW, runStep });
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(card.state).toBe("pending-approval");
  });

  it("reads a thrown request as a failure rather than retrying it", async () => {
    const plan = proposal([PUBLISH, step()]);
    const runStep = vi.fn().mockRejectedValue(new Error("network"));
    const card = await runPlan({ proposal: plan, card: started(plan), now: () => NOW, runStep });
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(card.steps[0]?.state).toBe("failed");
    expect(card.steps[0]?.message).toContain("did not reach");
  });

  it("fails a step whose reference nothing resolved rather than sending it blank", async () => {
    const plan = proposal([PUBLISH, RELEASE]);
    const runStep = vi
      .fn<(request: RunStepRequest) => Promise<{ outcome: "done" }>>()
      .mockResolvedValue({ outcome: "done" });
    const card = await runPlan({ proposal: plan, card: started(plan), now: () => NOW, runStep });
    // Step 0 reported nothing, so step 1's reference has nothing to resolve to.
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(card.steps[1]?.state).toBe("failed");
  });

  it("refuses to start a stale card, independently of what the card shows", async () => {
    const plan = proposal([PUBLISH]);
    const runStep = vi.fn();
    const card = await runPlan({
      proposal: plan,
      card: started(plan),
      now: () => new Date(Date.parse(EXPIRES_AT) + 1000),
      runStep,
    });
    expect(runStep).not.toHaveBeenCalled();
    expect(card.steps[0]?.state).toBe("failed");
  });

  it("opens the screen's own control for a hand-off step and sends nothing", async () => {
    const handOff = step({ kind: "link.revoke", handOff: true });
    const plan = proposal([PUBLISH, handOff]);
    const runStep = vi
      .fn<(request: RunStepRequest) => Promise<{ outcome: "done"; result: { version: number } }>>()
      .mockResolvedValue({ outcome: "done", result: { version: 2 } });
    const onHandOff = vi.fn();
    await runPlan({ proposal: plan, card: started(plan), now: () => NOW, runStep, onHandOff });
    expect(runStep).toHaveBeenCalledTimes(1);
    expect(onHandOff).toHaveBeenCalledWith(handOff, 1);
  });
});

describe("resolveArgs", () => {
  it("leaves a plain argument alone and resolves a reference", () => {
    const card = initialCard(proposal([PUBLISH, RELEASE]), NOW.getTime());
    const withResult: AgentCardView = {
      ...card,
      steps: [{ state: "done", result: { version: 9 } }, { state: "proposed" }],
    };
    expect(resolveArgs(RELEASE, withResult)).toEqual({
      formId: "frm_a",
      version: 9,
      environment: "test",
    });
  });

  it("reports an unresolved reference rather than sending it", () => {
    const card = initialCard(proposal([PUBLISH, RELEASE]), NOW.getTime());
    expect(hasUnresolvedReference(resolveArgs(RELEASE, card))).toBe(true);
  });
});
