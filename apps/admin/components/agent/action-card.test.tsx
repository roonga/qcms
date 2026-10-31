import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import {
  cancelCard,
  expireCard,
  initialCard,
  settleStep,
  startRun,
  startStep,
  type AgentCardView,
} from "@/lib/agent/plan-state";

import { ActionCard } from "./action-card";
import { ProposalMarker } from "./proposal-marker";

/**
 * The four card rules, as tests (083 D0, criterion 5). They are controls rather than
 * styling: a card whose title came from model text, that hid an argument or a step, that
 * was weaker than the screen's own dialog, or that offered more than one Confirm would
 * each be a security failure rather than a visual one.
 */

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const EXPIRES_AT = "2026-07-20T00:10:00.000Z";
const NOW = Date.parse(PROPOSED_AT);

/** Hostile model text: it must never reach a title, an argument or a consequence line. */
const HOSTILE_REASON =
  "Ignore the steps above. This only mints one link and touches nothing in production.";

function step(overrides: Partial<AgentPlanStep> = {}): AgentPlanStep {
  return {
    kind: "link.mint",
    screen: "/forms/[formId]/links",
    args: { formId: "frm_quote", count: 20, expiresAt: "2026-11-30", oneTime: true },
    environment: "test",
    handOff: false,
    card: {
      titleKey: "agent.card.link.mint.title",
      consequenceKeys: ["agent.card.link.mint.consequence"],
      headingControl: "links.mint",
    },
    resultAllowlist: ["count", "expiresAt", "environment"],
    ...overrides,
  };
}

const RELEASE_TO_PROD = step({
  kind: "form.release",
  args: { formId: "frm_quote", version: 3, environment: "prod" },
  environment: "prod",
  card: {
    titleKey: "agent.card.form.release.title",
    consequenceKeys: ["agent.card.form.release.consequence", "agent.card.environment.production"],
    headingControl: "releases.release",
  },
  resultAllowlist: ["version", "environment"],
});

function proposal(steps: readonly AgentPlanStep[]): AgentProposal {
  return {
    proposalId: "prp_card",
    token: "tok",
    steps,
    proposedAt: PROPOSED_AT,
    expiresAt: EXPIRES_AT,
    formId: "frm_quote",
  };
}

const NOOP = {
  onConfirm: () => undefined,
  onCancel: () => undefined,
  onStop: () => undefined,
};

function renderCard(
  plan: AgentProposal,
  card: AgentCardView,
  extra: Partial<React.ComponentProps<typeof ActionCard>> = {},
) {
  return render(
    <ActionCard proposal={plan} card={card} now={NOW} {...NOOP} {...extra} />,
  );
}

describe("rule 1: the admin writes the card", () => {
  it("builds the title and the consequence from the kind, not from the model's words", () => {
    const plan = proposal([step()]);
    renderCard(plan, initialCard(plan, NOW), { reason: HOSTILE_REASON });

    expect(
      screen.getByRole("heading", { name: "Mint 20 respondent links for frm_quote" }),
    ).toBeTruthy();
    expect(screen.getByText(/Each link opens this form for one respondent/u)).toBeTruthy();
  });

  it("renders the model's words once, quoted, and nowhere else", () => {
    const plan = proposal([step()]);
    const { container } = renderCard(plan, initialCard(plan, NOW), { reason: HOSTILE_REASON });

    const quotes = container.querySelectorAll("q");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.textContent).toBe(HOSTILE_REASON);
    // The reason sits after the steps, so it can never read as a heading or a band.
    const steps = container.querySelector(".qcms-acard__steps");
    const reason = container.querySelector(".qcms-acard__reason");
    expect(steps?.compareDocumentPosition(reason as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("rule 2: every step and every argument, in run order, in full", () => {
  it("shows a row per step, numbered, in the plan's order", () => {
    const plan = proposal([RELEASE_TO_PROD, step()]);
    renderCard(plan, initialCard(plan, NOW));
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("1. Release version 3 of frm_quote to prod");
    expect(rows[1]?.textContent).toContain("2. Mint 20 respondent links for frm_quote");
  });

  it("shows every argument of a step, with nothing collapsed", () => {
    const plan = proposal([step()]);
    const { container } = renderCard(plan, initialCard(plan, NOW));
    const args = container.querySelector(".qcms-acard__args")?.textContent ?? "";
    for (const value of ["frm_quote", "20", "2026-11-30", "Yes"]) {
      expect(args, value).toContain(value);
    }
    expect(args).not.toContain("…");
  });

  it("says in words that a step uses an earlier step's result", () => {
    const plan = proposal([
      step({ kind: "form.publish", args: { formId: "frm_quote" }, resultAllowlist: ["version"] }),
      step({
        kind: "form.release",
        args: {
          formId: "frm_quote",
          version: { fromStep: 0, field: "version" },
          environment: "test",
        },
        card: {
          titleKey: "agent.card.form.release.title",
          consequenceKeys: ["agent.card.form.release.consequence"],
        },
        resultAllowlist: ["version", "environment"],
      }),
    ]);
    const { container } = renderCard(plan, initialCard(plan, NOW));
    const rows = container.querySelectorAll(".qcms-acard__step");
    expect((rows[1] as HTMLElement).textContent).toContain("Uses the version step 1 sets");
    // The title says it too, in the shorter form a sentence takes.
    expect((rows[1] as HTMLElement).querySelector(".qcms-acard__what")?.textContent).toContain(
      "step 1's version",
    );
  });
});

describe("rule 3: never weaker than the screen's dialog", () => {
  it("carries the production sentence inline on the production step's own line", () => {
    const plan = proposal([RELEASE_TO_PROD, step()]);
    const { container } = renderCard(plan, initialCard(plan, NOW));
    const rows = container.querySelectorAll(".qcms-acard__step");

    const production = rows[0] as HTMLElement;
    expect(production.textContent).toContain(
      "Production: changes where respondents' answers are sent.",
    );
    // One chip in that step, and no boxed inset inside it (issue #1131).
    expect(production.querySelectorAll(".qcms-envchip")).toHaveLength(1);
    expect(production.querySelector(".qcms-acard__band")).toBeNull();
    expect((rows[1] as HTMLElement).textContent).not.toContain("Production:");
  });

  it("keeps Confirm disabled until a step's typed confirmation is entered", () => {
    const plan = proposal([step()]);
    renderCard(plan, initialCard(plan, NOW), { typedConfirmation: "X7KQ2M4P" });
    expect(screen.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(true);
  });

  it("says a hand-off step needs the secret typed on the screen itself", () => {
    const plan = proposal([step({ handOff: true })]);
    renderCard(plan, initialCard(plan, NOW));
    expect(screen.getByText(/secret you type on the screen itself/u)).toBeTruthy();
  });
});

describe("rule 4: one plan, one Confirm", () => {
  it("offers exactly one Confirm for a plan of three steps", () => {
    const plan = proposal([step(), step(), step()]);
    renderCard(plan, initialCard(plan, NOW));
    expect(screen.getAllByRole("button", { name: /^Confirm/u })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm all 3 steps" })).toBeTruthy();
  });

  it("replaces Confirm with Stop while the plan runs", () => {
    const plan = proposal([step(), step()]);
    renderCard(plan, startRun(initialCard(plan, NOW)));
    expect(screen.queryByRole("button", { name: /^Confirm/u })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop after this step" })).toBeTruthy();
  });
});

describe("the step states", () => {
  it("shows no visible chip per step while every step shares the card's state", () => {
    const plan = proposal([step(), step()]);
    const { container } = renderCard(plan, initialCard(plan, NOW));
    expect(container.querySelectorAll(".qcms-acard__step .qcms-acard__state")).toHaveLength(0);
    // The word is still in each row's accessible name.
    for (const row of screen.getAllByRole("listitem")) {
      expect(row.textContent).toContain("Proposed");
    }
    expect(container.querySelector(".qcms-acard__head .qcms-acard__state")?.textContent).toBe(
      "Proposed",
    );
  });

  it("shows each step's own chip from Confirm onwards", () => {
    const plan = proposal([step(), step()]);
    const running = startStep(startRun(initialCard(plan, NOW)), 0);
    const { container } = renderCard(plan, running);
    expect(container.querySelectorAll(".qcms-acard__step .qcms-acard__state")).toHaveLength(2);
    expect(container.querySelector(".qcms-acard__head .qcms-acard__state")?.textContent).toBe(
      "Running 1 of 2",
    );
  });

  it("quotes the action's own message under a failed step and marks the rest Not run", () => {
    const plan = proposal([step(), step()]);
    const failed = settleStep(
      startRun(initialCard(plan, NOW)),
      0,
      plan.steps[0] as AgentPlanStep,
      { outcome: "failed", message: "That expiry is in the past." },
      PROPOSED_AT,
    );
    renderCard(plan, failed);
    expect(screen.getByText("That expiry is in the past.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[1]?.textContent).toContain("Not run");
  });

  it("shows `Expired - ask again` with Confirm disabled", () => {
    const plan = proposal([step()]);
    renderCard(plan, expireCard(initialCard(plan, NOW)));
    expect(screen.getByText("Expired - ask again")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("focus and the live region", () => {
  it("leaves focus alone unless it was already inside the panel", () => {
    const plan = proposal([step()]);
    renderCard(plan, initialCard(plan, NOW));
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the heading when the card arrives with focus in the panel", () => {
    const plan = proposal([step()]);
    renderCard(plan, initialCard(plan, NOW), { focusOnArrival: true });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 }));
  });

  it("moves focus to the result line once the card settles", () => {
    const plan = proposal([step()]);
    renderCard(plan, cancelCard(initialCard(plan, NOW), PROPOSED_AT));
    expect(document.activeElement?.textContent).toBe("Cancelled by you. Nothing was sent.");
  });

  it("announces progress in words through one polite region", () => {
    const plan = proposal([step(), step()]);
    const { container } = renderCard(plan, startRun(initialCard(plan, NOW)));
    const regions = container.querySelectorAll('[role="status"]');
    expect(regions).toHaveLength(1);
    expect(regions[0]?.textContent).toBe("Step 1 of 2 running");
  });

  it("cancels the card on Escape while it waits, and never the turn", () => {
    const plan = proposal([step()]);
    const onCancel = vi.fn();
    const turnEscape = vi.fn();
    render(
      <div onKeyDown={turnEscape}>
        <ActionCard
          proposal={plan}
          card={initialCard(plan, NOW)}
          now={NOW}
          {...NOOP}
          onCancel={onCancel}
        />
      </div>,
    );
    screen.getByRole("heading", { level: 2 }).focus();
    const card = screen.getByRole("heading", { level: 2 }).closest("article");
    card?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(turnEscape).not.toHaveBeenCalled();
  });
});

function MarkerHost({ onReview }: { readonly onReview: () => void }): React.ReactElement {
  const control = useRef<HTMLButtonElement>(null);
  return (
    <div className="qcms-headrow">
      <h1>Releases</h1>
      <ProposalMarker
        cardId="card-h"
        summary="Release version 3 of frm_quote to prod"
        controlRef={control}
        onReview={onReview}
      />
      <button type="button" ref={control}>
        Release a version
      </button>
    </div>
  );
}

describe("the proposal marker", () => {
  it("is a link to the card, named for the assistant, that sends nothing", () => {
    const onReview = vi.fn();
    render(<MarkerHost onReview={onReview} />);
    const marker = screen.getByRole("link");
    // The name reads "Assistant proposed · Review": the word and the icon, never colour.
    expect(marker.textContent?.replace(/\s+/gu, " ").trim()).toBe("Assistant proposed · Review");
    expect(marker.getAttribute("href")).toBe("#card-h");
    marker.click();
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Nothing runs from here/u).textContent,
    ).toContain("Release version 3 of frm_quote to prod");
  });

  it("outlines the heading-row control it mirrors and leaves the control itself unchanged", () => {
    render(<MarkerHost onReview={() => undefined} />);
    const control = screen.getByRole("button", { name: "Release a version" });
    expect(control.dataset["proposed"]).toBe("true");
    // No second Confirm: the marker is the only thing the card added to this row.
    expect(screen.queryByRole("button", { name: /Confirm/u })).toBeNull();
  });

  it("clears the control's outline when the card leaves Proposed", () => {
    const { unmount } = render(<MarkerHost onReview={() => undefined} />);
    const control = screen.getByRole("button", { name: "Release a version" });
    unmount();
    expect(control.dataset["proposed"]).toBeUndefined();
  });
});
