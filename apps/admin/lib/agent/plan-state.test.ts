import { describe, expect, it, vi } from "vitest";

import type { AgentPlanStep, AgentProposal } from "../forms/assist-stream.ts";

import {
  actionResultTurn,
  cancelCard,
  canConfirm,
  dismissReveal,
  expireCard,
  firstPendingStep,
  headingChip,
  holdsReveal,
  initialCard,
  liveLine,
  proposalWindowMs,
  requestStop,
  resultLine,
  settleStep,
  showsMarker,
  showsStepChips,
  startRun,
  startStep,
  STEP_STATE_WORDS,
  type AgentCardView,
} from "./plan-state.ts";

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const EXPIRES_AT = "2026-07-20T00:10:00.000Z";

function step(overrides: Partial<AgentPlanStep> = {}): AgentPlanStep {
  return {
    kind: "link.mint",
    screen: "/operations/forms/[formId]/links",
    args: { formId: "frm_a", count: 2 },
    environment: "test",
    handOff: false,
    local: false,
    card: { titleKey: "agent.card.link.mint.title", consequenceKeys: [] },
    resultAllowlist: ["count", "expiresAt", "environment"],
    ...overrides,
  };
}

function proposal(steps: readonly AgentPlanStep[]): AgentProposal {
  return {
    proposalId: "prp_test",
    token: "tok",
    steps,
    proposedAt: PROPOSED_AT,
    expiresAt: EXPIRES_AT,
    formId: "frm_a",
    currentEnvironment: "test",
  };
}

const THREE = proposal([
  step({ kind: "form.publish", args: { formId: "frm_a" }, resultAllowlist: ["version"] }),
  step({
    kind: "form.release",
    args: { formId: "frm_a", version: { fromStep: 0, field: "version" } },
    environment: "prod",
    resultAllowlist: ["version", "environment"],
  }),
  step(),
]);

function run(card: AgentCardView, outcomes: readonly Parameters<typeof settleStep>[3][]) {
  let next = startRun(card);
  for (const [index, outcome] of outcomes.entries()) {
    next = startStep(next, index);
    next = settleStep(next, index, THREE.steps[index] as AgentPlanStep, outcome, PROPOSED_AT);
  }
  return next;
}

describe("a fresh card", () => {
  it("proposes every step and offers Confirm", () => {
    const card = initialCard(THREE);
    expect(card.steps.map((view) => view.state)).toEqual(["proposed", "proposed", "proposed"]);
    expect(card.state).toBe("proposed");
    expect(canConfirm(card)).toBe(true);
    expect(showsMarker(card)).toBe(true);
    expect(firstPendingStep(card)).toBe(0);
  });

  it("takes the window's length from the server", () => {
    expect(proposalWindowMs(THREE)).toBe(10 * 60 * 1000);
  });

  it("arrives Confirmable however far out the browser's own clock is", () => {
    vi.useFakeTimers({ now: Date.parse(EXPIRES_AT) + 24 * 60 * 60 * 1000 });
    try {
      const card = initialCard(THREE);
      expect(card.state).toBe("proposed");
      expect(canConfirm(card)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("arrives expired when the server gave it no window at all", () => {
    const card = initialCard({ ...THREE, expiresAt: PROPOSED_AT });
    expect(card.state).toBe("expired");
    expect(canConfirm(card)).toBe(false);
    expect(resultLine(card)?.key).toBe("agent.card.result.expired");
    expect(proposalWindowMs({ ...THREE, expiresAt: "not a date" })).toBe(0);
  });
});

describe("step chips appear only once the plan runs", () => {
  it("hides them in the three states every step shares", () => {
    const fresh = initialCard(THREE);
    expect(showsStepChips(fresh)).toBe(false);
    expect(showsStepChips(cancelCard(fresh, PROPOSED_AT))).toBe(false);
    expect(showsStepChips(expireCard(fresh))).toBe(false);
  });

  it("shows them from Confirm onwards", () => {
    expect(showsStepChips(startRun(initialCard(THREE)))).toBe(true);
  });

  it("gives every state a word, so a hidden chip still has one", () => {
    for (const state of Object.keys(STEP_STATE_WORDS)) {
      expect(STEP_STATE_WORDS[state as keyof typeof STEP_STATE_WORDS]).toMatch(
        /^agent\.card\.state\./,
      );
    }
  });
});

describe("one plan, one Confirm, stopping at the first failure (criterion 4)", () => {
  it("runs every step and settles Done", () => {
    const card = run(initialCard(THREE), [
      { outcome: "done", result: { version: 3 } },
      { outcome: "done", result: { version: 3, environment: "prod" } },
      { outcome: "done", result: { count: 2 } },
    ]);
    expect(card.state).toBe("done");
    expect(card.steps.map((view) => view.state)).toEqual(["done", "done", "done"]);
    expect(resultLine(card)).toEqual({ key: "agent.card.result.done", params: { count: 3 } });
  });

  it("stops at step 2, leaves step 3 Not run and never retries", () => {
    const card = run(initialCard(THREE), [
      { outcome: "done", result: { version: 3 } },
      { outcome: "failed", message: "That version is already released to prod." },
    ]);
    expect(card.steps.map((view) => view.state)).toEqual(["done", "failed", "not-run"]);
    expect(card.state).toBe("stopped");
    expect(card.steps[1]?.message).toBe("That version is already released to prod.");
    expect(headingChip(card)).toEqual({ key: "agent.card.chip.stopped", params: { step: 2 } });
    expect(resultLine(card)).toEqual({
      key: "agent.card.result.stopped",
      params: { step: 2, ran: 1, count: 3 },
    });
  });

  it("treats Pending approval as terminal for the plan", () => {
    const card = run(initialCard(THREE), [
      { outcome: "done", result: { version: 3 } },
      { outcome: "pending-approval", message: "Another approver confirms this release." },
    ]);
    expect(card.steps.map((view) => view.state)).toEqual(["done", "pending-approval", "not-run"]);
    expect(card.state).toBe("pending-approval");
    expect(resultLine(card)).toEqual({
      key: "agent.card.result.held",
      params: { step: 2, ran: 1, count: 3 },
    });
  });

  it("lets the running step finish after Stop and sends no further step", () => {
    let card = startRun(initialCard(THREE));
    card = requestStop(card);
    card = settleStep(card, 0, THREE.steps[0] as AgentPlanStep, { outcome: "done" }, PROPOSED_AT);
    expect(card.steps.map((view) => view.state)).toEqual(["done", "not-run", "not-run"]);
    expect(card.state).toBe("stopped");
    expect(resultLine(card)?.key).toBe("agent.card.result.stoppedByYou");
  });
});

describe("Cancel is local", () => {
  it("cancels every step, sends nothing and tells the next turn", () => {
    const card = cancelCard(initialCard(THREE), PROPOSED_AT);
    expect(card.steps.map((view) => view.state)).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(resultLine(card)?.key).toBe("agent.card.result.cancelled");
    expect(showsMarker(card)).toBe(false);
    expect(actionResultTurn(THREE, card)?.steps.map((entry) => entry.outcome)).toEqual([
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
  });

  it("refuses to cancel a card that has already run", () => {
    const running = startRun(initialCard(THREE));
    expect(cancelCard(running, PROPOSED_AT)).toBe(running);
  });
});

describe("progress is announced in words", () => {
  it("names the running step, then the result line", () => {
    const running = startRun(initialCard(THREE));
    expect(liveLine(running)).toEqual({
      key: "agent.card.live.running",
      params: { step: 1, count: 3 },
    });
    const done = run(initialCard(THREE), [
      { outcome: "done" },
      { outcome: "done" },
      { outcome: "done" },
    ]);
    expect(liveLine(done)).toEqual(resultLine(done));
  });

  it("says nothing while the card waits, so an arrival is not announced twice", () => {
    expect(liveLine(initialCard(THREE))).toBeUndefined();
  });
});

describe("the `action-result` turn (criterion 8)", () => {
  it("reports only the fields the kind allowlists", () => {
    const card = run(initialCard(THREE), [
      { outcome: "done", result: { version: 3, url: "https://forms.example.test/l/abc" } },
      { outcome: "done", result: { version: 3, environment: "prod" } },
      { outcome: "done", result: { count: 2, links: ["https://forms.example.test/l/d"] } },
    ]);
    const turn = actionResultTurn(THREE, card);
    expect(turn?.steps).toEqual([
      { kind: "form.publish", outcome: "done", result: { version: 3 } },
      { kind: "form.release", outcome: "done", result: { version: 3, environment: "prod" } },
      { kind: "link.mint", outcome: "done", result: { count: 2 } },
    ]);
    expect(JSON.stringify(turn)).not.toContain("forms.example.test");
  });

  it("drops a non-scalar even when the field is allowlisted", () => {
    const one = proposal([step({ resultAllowlist: ["count"] })]);
    const card = settleStep(
      startRun(initialCard(one)),
      0,
      one.steps[0] as AgentPlanStep,
      { outcome: "done", result: { count: { nested: 2 } } },
      PROPOSED_AT,
    );
    expect(actionResultTurn(one, card)?.steps[0]?.result).toBeUndefined();
  });

  it("is withheld while the card is still waiting or running", () => {
    expect(actionResultTurn(THREE, initialCard(THREE))).toBeUndefined();
    expect(actionResultTurn(THREE, startRun(initialCard(THREE)))).toBeUndefined();
  });
});

describe("a reveal the card is holding", () => {
  const ONE = proposal([step()]);
  const LINKS = [
    {
      linkId: "lnk_a",
      environment: "test",
      url: "https://forms.example.test/l/aaa",
      expiresAt: "2026-11-30T23:59:59.000Z",
    },
  ];

  function settled(revealed: string | typeof LINKS): AgentCardView {
    return settleStep(
      startRun(initialCard(ONE)),
      0,
      ONE.steps[0] as AgentPlanStep,
      { outcome: "done", result: { count: 1 }, revealed },
      PROPOSED_AT,
    );
  }

  it("carries a list of addresses as readily as a single secret", () => {
    expect(settled(LINKS).steps[0]?.revealed).toEqual(LINKS);
    expect(settled("whsec_abc").steps[0]?.revealed).toBe("whsec_abc");
  });

  it("is what marks the card as one nothing else may sweep away", () => {
    expect(holdsReveal(settled(LINKS))).toBe(true);
    expect(holdsReveal(initialCard(ONE))).toBe(false);
  });

  it("goes when the person dismisses it, and the rest of the step stays", () => {
    const cleared = dismissReveal(settled(LINKS), 0);
    expect(cleared.steps[0]?.revealed).toBeUndefined();
    expect(cleared.steps[0]?.state).toBe("done");
    expect(cleared.steps[0]?.result).toEqual({ count: 1 });
    expect(holdsReveal(cleared)).toBe(false);
  });

  it("is untouched by a dismissal of some other step", () => {
    const card = settled(LINKS);
    expect(dismissReveal(card, 1)).toBe(card);
  });

  it("never reaches the turn the next prompt replays", () => {
    expect(JSON.stringify(actionResultTurn(ONE, settled(LINKS)))).not.toContain("forms.example");
  });
});
