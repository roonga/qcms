import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import { initialCard, settleStep, startRun, type AgentCardView } from "@/lib/agent/plan-state";

import { ActionCard } from "./action-card";

/* The dialog and the panel show one card: the operator decides in whichever they opened, and the
   outcome is reported once rather than in both. */

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const EXPIRES_AT = "2026-07-20T00:10:00.000Z";

function step(overrides: Partial<AgentPlanStep> = {}): AgentPlanStep {
  return {
    kind: "link.mint",
    screen: "/operations/forms/[formId]/links",
    args: { formId: "frm_quote", count: 2, expiresAt: "2026-11-30T00:00:00.000Z", oneTime: true },
    environment: "test",
    handOff: false,
    local: false,
    card: {
      titleKey: "agent.card.link.mint.title",
      consequenceKeys: ["agent.card.link.mint.consequence"],
    },
    resultAllowlist: ["count"],
    ...overrides,
  };
}

const SAVE_DRAFT = step({
  kind: "form.saveDraft",
  screen: "/forms/[formId]",
  args: { formId: "frm_quote", definition: { defaultLocale: "en", steps: [], rules: [] } },
  card: {
    titleKey: "agent.card.form.saveDraft.title",
    consequenceKeys: ["agent.card.form.saveDraft.consequence"],
    hideEnvironment: true,
  },
  resultAllowlist: ["formId"],
});

function proposal(steps: readonly AgentPlanStep[]): AgentProposal {
  return {
    proposalId: "prp_dialog",
    token: "tok",
    steps,
    proposedAt: PROPOSED_AT,
    expiresAt: EXPIRES_AT,
    formId: "frm_quote",
    currentEnvironment: "test",
  };
}

function open(steps: readonly AgentPlanStep[], card?: AgentCardView) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = card ?? initialCard(proposal(steps));
  render(
    <ActionCard
      proposal={proposal(steps)}
      card={view}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onStop={vi.fn()}
      remainingMs={9 * 60_000}
    />,
  );
  fireEvent.click(screen.getByTestId("qcms-acard-open"));
  return { onConfirm, onCancel };
}

describe("the card's dialog", () => {
  it("titles a single-step dialog with the step, and does not repeat it inside", () => {
    open([step()]);
    const dialog = screen.getByTestId("qcms-acard-dialog");
    const titles = screen.getAllByText(/Create 2 respondent links/);
    // One in the dialog's own title, and none repeated on the step row below it.
    expect(dialog.querySelectorAll(".qcms-acard__what")).toHaveLength(0);
    expect(titles.length).toBeGreaterThan(0);
  });

  it("offers Confirm straight away for a single step", () => {
    const { onConfirm } = open([step()]);
    const dialog = screen.getByTestId("qcms-acard-dialog");
    const confirm = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent === "Confirm",
    );
    expect(confirm).toBeDefined();
    fireEvent.click(confirm as HTMLButtonElement);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("walks a plan page by page and offers Confirm on the review page alone", () => {
    open([step(), SAVE_DRAFT]);
    const dialog = screen.getByTestId("qcms-acard-dialog");
    const buttons = () => [...dialog.querySelectorAll("button")].map((b) => b.textContent);
    expect(dialog.querySelector('[data-page="1"]')).not.toBeNull();
    expect(buttons()).not.toContain("Confirm all 2 steps");

    fireEvent.click(screen.getAllByText("Next")[0] as HTMLElement);
    expect(dialog.querySelector('[data-page="2"]')).not.toBeNull();
    expect(buttons()).not.toContain("Confirm all 2 steps");

    fireEvent.click(screen.getAllByText("Next")[0] as HTMLElement);
    expect(dialog.querySelector('[data-page="review"]')).not.toBeNull();
    expect(buttons()).toContain("Confirm all 2 steps");
  });

  it("lists every step on the review page, numbered", () => {
    open([step(), SAVE_DRAFT]);
    fireEvent.click(screen.getAllByText("Next")[0] as HTMLElement);
    fireEvent.click(screen.getAllByText("Next")[0] as HTMLElement);
    const review = screen
      .getByTestId("qcms-acard-dialog")
      .querySelector('[data-page="review"]') as HTMLElement;
    expect(review.querySelectorAll(".qcms-acard__step")).toHaveLength(2);
    expect(review.textContent).toContain("1. ");
    expect(review.textContent).toContain("2. ");
  });

  it("shows no environment line for a step whose act is in no environment", () => {
    open([SAVE_DRAFT]);
    const dialog = screen.getByTestId("qcms-acard-dialog");
    expect(dialog.textContent).not.toContain("Environment");
    expect(dialog.querySelector(".qcms-envchip")).toBeNull();
  });

  // Escape closes the dialog the operator opened; the card is still waiting behind it, so
  // dismissing a view never withdraws the proposal.
  it("keeps the card waiting when the dialog is dismissed", () => {
    const { onCancel } = open([step()]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    const confirm = screen
      .getAllByRole("button")
      .find((button) => button.textContent === "Confirm");
    expect(confirm).toBeDefined();
  });

  it("shares the card's state, so a settled run reports in the dialog and not twice", () => {
    const steps = [step()];
    const settled = settleStep(
      startRun(initialCard(proposal(steps))),
      0,
      steps[0] as AgentPlanStep,
      { outcome: "failed", message: "the route refused it" },
      PROPOSED_AT,
    );
    open(steps, settled);
    // One result line: the panel behind the dialog does not report it a second time.
    expect(screen.getAllByText(/0 of 1 ran/)).toHaveLength(1);
    expect(screen.getByTestId("qcms-acard-dialog").textContent).toContain("the route refused it");
  });

  it("reports the server's own refusal detail on a failed step", () => {
    const steps = [step({ kind: "question.create", screen: "/questions" })];
    const settled = settleStep(
      startRun(initialCard(proposal(steps))),
      0,
      steps[0] as AgentPlanStep,
      {
        outcome: "failed",
        message: "refused",
        issues: [
          {
            code: "PATTERN_NOT_BROWSER_SAFE",
            message: "the v flag rejects it",
            path: "constraints.pattern",
          },
        ],
      },
      PROPOSED_AT,
    );
    open(steps, settled);
    const issues = screen.getAllByTestId("qcms-acard-step-issues")[0] as HTMLElement;
    expect(issues.textContent).toContain("constraints.pattern");
    expect(issues.textContent).toContain("the v flag rejects it");
  });
});
