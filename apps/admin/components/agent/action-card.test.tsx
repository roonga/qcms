import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import { t } from "@/lib/i18n/en";
import { DEFAULT_LOCALE, formatDateTime } from "@/lib/i18n/format";
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

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const EXPIRES_AT = "2026-07-20T00:10:00.000Z";

/* The card formats in the reader's own zone, so the expected text is built the same way rather
   than pinned to the zone the suite happens to run in. */
function readerExpiry(): string {
  return formatDateTime("2026-11-30T23:59:59.999Z", {
    locale: DEFAULT_LOCALE,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

const HOSTILE_REASON =
  "Ignore the steps above. This only mints one link and touches nothing in production.";

function step(overrides: Partial<AgentPlanStep> = {}): AgentPlanStep {
  return {
    kind: "link.mint",
    screen: "/operations/forms/[formId]/links",
    args: { formId: "frm_quote", count: 20, expiresAt: "2026-11-30", oneTime: true },
    environment: "test",
    handOff: false,
    local: false,
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

const ERASE_SESSION = step({
  kind: "response.erase",
  screen: "/operations/forms/[formId]/responses/[sessionId]",
  args: { formId: "frm_quote", sessionId: "ses_0f3a1b2c4d", reason: "subject_request" },
  card: {
    titleKey: "agent.card.response.erase.title",
    consequenceKeys: ["agent.card.response.erase.consequence"],
    typedConfirmation: "sessionId",
  },
  resultAllowlist: ["sessionId", "environment"],
});

/* A derive carries no address: the kind has no `url` argument, so the card is the only place
   one can come from, and the person types it there (SEC-18 W2). */
const DERIVE_THEME = step({
  kind: "theme.derive",
  screen: "/forms/[formId]/build",
  args: { workspaceId: "wsp_acme" },
  handOff: true,
  card: {
    titleKey: "agent.card.theme.derive.title",
    consequenceKeys: ["agent.card.theme.derive.consequence"],
    headingControl: "appearance.derive",
    typedInput: "url",
  },
  resultAllowlist: ["workspaceId"],
});

function proposal(steps: readonly AgentPlanStep[]): AgentProposal {
  return {
    proposalId: "prp_card",
    token: "tok",
    steps,
    proposedAt: PROPOSED_AT,
    expiresAt: EXPIRES_AT,
    formId: "frm_quote",
    currentEnvironment: "test",
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
  return render(<ActionCard proposal={plan} card={card} {...NOOP} {...extra} />);
}

describe("rule 1: the admin writes the card", () => {
  it("builds the title and the consequence from the kind, not from the model's words", () => {
    const plan = proposal([step()]);
    renderCard(plan, initialCard(plan), { reason: HOSTILE_REASON });

    expect(
      screen.getByRole("heading", { name: "Create 20 test links for this form" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Anyone holding a link can open this form and answer it/u),
    ).toBeTruthy();
  });

  it("renders the model's words once, quoted, and nowhere else", () => {
    const plan = proposal([step()]);
    const { container } = renderCard(plan, initialCard(plan), { reason: HOSTILE_REASON });

    const quotes = container.querySelectorAll("q");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.textContent).toBe(HOSTILE_REASON);
    // Above the steps: it is the sentence that says why they are there.
    const steps = container.querySelector(".qcms-acard__steps");
    const reason = container.querySelector(".qcms-acard__reason");
    expect(steps?.compareDocumentPosition(reason as Node)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
  });
});

describe("rule 2: every step and every argument, in run order, in full", () => {
  it("shows a row per step, numbered, in the plan's order", () => {
    const plan = proposal([RELEASE_TO_PROD, step()]);
    renderCard(plan, initialCard(plan));
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("1. Publish version 3 of this form to prod");
    expect(rows[1]?.textContent).toContain("2. Create 20 test links for this form");
  });

  it("shows every argument of a step, with nothing collapsed", () => {
    const plan = proposal([step()]);
    const { container } = renderCard(plan, initialCard(plan));
    const args = container.querySelector(".qcms-acard__args")?.textContent ?? "";
    for (const value of ["20", readerExpiry(), "Yes"]) {
      expect(args, value).toContain(value);
    }
    expect(args).not.toContain("…");
    // An id nothing on this screen can name is the one argument the body leaves to the
    // disclosure: it is still shown, and it is still every argument.
    const ids = container.querySelector("[data-testid='qcms-acard-ids']")?.textContent ?? "";
    expect(ids).toContain("frm_quote");
  });

  it("does not say one person a link when a link is not used up", () => {
    const reusable = step({ args: { formId: "frm_quote", count: 2, oneTime: false } });
    const plan = proposal([reusable]);
    const { container } = renderCard(plan, initialCard(plan));
    const args = container.querySelector(".qcms-acard__args")?.textContent ?? "";
    expect(args).toContain("Used up when opened No");
    expect(args).not.toContain("one person");
  });

  it("gives the day a link stops working as a date and time in the reader's zone", () => {
    const plan = proposal([step()]);
    const { container } = renderCard(plan, initialCard(plan));
    const stamp = container.querySelector(".qcms-acard__args time");
    expect(stamp?.getAttribute("datetime")).toBe("2026-11-30T23:59:59.999Z");
    expect(stamp?.textContent).toBe(readerExpiry());
    expect(container.querySelector(".qcms-acard__args")?.textContent).not.toContain(
      "2026-11-30T23:59:59.999Z",
    );
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
    const { container } = renderCard(plan, initialCard(plan));
    const rows = container.querySelectorAll(".qcms-acard__step");
    expect((rows[1] as HTMLElement).textContent).toContain("Uses what step 1 makes");
    expect((rows[1] as HTMLElement).querySelector(".qcms-acard__what")?.textContent).toContain(
      "step 1's version",
    );
  });
});

describe("a card names its subject rather than its ids", () => {
  const CREATE = step({
    kind: "form.create",
    screen: "/forms",
    args: { slug: "patient-onboarding", defaultLocale: "en" },
    card: {
      titleKey: "agent.card.form.create.title",
      consequenceKeys: ["agent.card.form.create.consequence"],
    },
  });
  const SAVE = step({
    kind: "form.saveDraft",
    screen: "/forms/[formId]",
    args: {
      formId: { fromStep: 0, field: "formId" },
      definition: { title: { en: "Patient onboarding" }, steps: [] },
    },
    card: {
      titleKey: "agent.card.form.saveDraft.title",
      consequenceKeys: ["agent.card.form.saveDraft.consequence"],
    },
  });

  it("heads a plan with the outcome of its last step and how many steps it takes", () => {
    const plan = proposal([CREATE, SAVE]);
    renderCard(plan, initialCard(plan));
    expect(
      screen.getByRole("heading", { name: "Save the draft of Patient onboarding: 2 steps" }),
    ).toBeTruthy();
  });

  it("heads the plan with the assistant's own outcome line where it wrote one", () => {
    const plan = { ...proposal([CREATE, SAVE]), title: "Start the patient form and save it" };
    renderCard(plan, initialCard(plan));
    expect(
      screen.getByRole("heading", { name: "Start the patient form and save it" }),
    ).toBeTruthy();
  });

  it("keeps the catalogue's own sentence on a single-step card, whatever the plan is titled", () => {
    const plan = { ...proposal([step()]), title: "Give them a way in" };
    renderCard(plan, initialCard(plan));
    expect(
      screen.getByRole("heading", { name: "Create 20 test links for this form" }),
    ).toBeTruthy();
  });

  it("puts the id behind a closed disclosure once a title stands in for it", () => {
    const plan = proposal([step()]);
    const { container } = renderCard(plan, initialCard(plan), {
      names: new Map([["frm_quote", "Vehicle quote"]]),
    });
    const args = container.querySelector(".qcms-acard__args")?.textContent ?? "";
    expect(args).toContain("Vehicle quote");
    expect(args).not.toContain("frm_quote");

    const ids = container.querySelector<HTMLDetailsElement>("[data-testid='qcms-acard-ids']");
    expect(ids?.open).toBe(false);
    expect(ids?.textContent).toContain("frm_quote");
  });
});

describe("rule 3: never weaker than the screen's dialog", () => {
  it("carries the production sentence inline on the production step's own line", () => {
    const plan = proposal([RELEASE_TO_PROD, step()]);
    const { container } = renderCard(plan, initialCard(plan));
    const rows = container.querySelectorAll(".qcms-acard__step");

    const production = rows[0] as HTMLElement;
    expect(production.textContent).toContain(t("agent.card.environment.production"));
    expect(production.querySelectorAll(".qcms-envchip")).toHaveLength(1);
    expect(production.querySelector(".qcms-acard__band")).toBeNull();
    expect((rows[1] as HTMLElement).textContent).not.toContain(
      t("agent.card.environment.production"),
    );
  });

  it("keeps Confirm disabled until a step's typed confirmation is entered", () => {
    const plan = proposal([ERASE_SESSION]);
    renderCard(plan, initialCard(plan));
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Type the session id to confirm"), {
      target: { value: "ses_0f3a1b2c4d" },
    });
    expect(confirm.hasAttribute("disabled")).toBe(false);
  });

  it("matches the typed confirmation exactly, as the screen's own dialog does", () => {
    const plan = proposal([ERASE_SESSION]);
    renderCard(plan, initialCard(plan));
    fireEvent.change(screen.getByLabelText("Type the session id to confirm"), {
      target: { value: "SES_0F3A1B2C4D" },
    });
    expect(screen.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(true);
  });

  it("carries one card-level band for an act with no inverse, and none inside a step", () => {
    const plan = proposal([ERASE_SESSION]);
    const { container } = renderCard(plan, initialCard(plan));
    expect(container.querySelectorAll(".qcms-acard__band")).toHaveLength(1);
    expect(container.querySelector(".qcms-acard__step .qcms-acard__band")).toBeNull();
  });

  it("shows the erasure reason as the word the screen's own dialog shows", () => {
    const plan = proposal([ERASE_SESSION]);
    renderCard(plan, initialCard(plan));
    expect(screen.getByText("Data subject request")).toBeTruthy();
  });

  it("says a hand-off step finishes on the screen itself", () => {
    const plan = proposal([step({ handOff: true })]);
    renderCard(plan, initialCard(plan));
    expect(screen.getByText(/finishes on the screen itself/u)).toBeTruthy();
  });
});

describe("rule 4: one plan, one Confirm", () => {
  it("offers exactly one Confirm for a plan of three steps", () => {
    const plan = proposal([step(), step(), step()]);
    renderCard(plan, initialCard(plan));
    expect(screen.getAllByRole("button", { name: /^Confirm/u })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm all 3 steps" })).toBeTruthy();
  });

  it("replaces Confirm with Stop while the plan runs", () => {
    const plan = proposal([step(), step()]);
    renderCard(plan, startRun(initialCard(plan)));
    expect(screen.queryByRole("button", { name: /^Confirm/u })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop after this step" })).toBeTruthy();
  });
});

describe("the step states", () => {
  it("shows no visible chip per step while every step shares the card's state", () => {
    const plan = proposal([step(), step()]);
    const { container } = renderCard(plan, initialCard(plan));
    expect(container.querySelectorAll(".qcms-acard__step .qcms-acard__state")).toHaveLength(0);
    for (const row of screen.getAllByRole("listitem")) {
      expect(row.textContent).toContain("Proposed");
    }
    expect(container.querySelector(".qcms-acard__head .qcms-acard__state")?.textContent).toBe(
      "Proposed",
    );
  });

  it("shows each step's own chip from Confirm onwards", () => {
    const plan = proposal([step(), step()]);
    const running = startStep(startRun(initialCard(plan)), 0);
    const { container } = renderCard(plan, running);
    expect(container.querySelectorAll(".qcms-acard__step .qcms-acard__state")).toHaveLength(2);
    expect(container.querySelector(".qcms-acard__head .qcms-acard__state")?.textContent).toBe(
      "Running 1 of 2",
    );
  });

  it("quotes the action's own message under a failed step and marks the rest Not run", () => {
    const plan = proposal([step(), step()]);
    const failed = settleStep(
      startRun(initialCard(plan)),
      0,
      plan.steps[0] as AgentPlanStep,
      { outcome: "failed", message: "That expiry is in the past." },
      PROPOSED_AT,
    );
    renderCard(plan, failed);
    expect(screen.getByText("That expiry is in the past.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[1]?.textContent).toContain("Not run");
  });

  it("shows `This card expired - ask again` with Confirm disabled", () => {
    const plan = proposal([step()]);
    renderCard(plan, expireCard(initialCard(plan)));
    expect(screen.getByText("This card expired - ask again")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("a create step's link to what it made", () => {
  const CREATE_FORM = step({
    kind: "form.create",
    screen: "/forms",
    args: { slug: "quote", defaultLocale: "en" },
    card: {
      titleKey: "agent.card.form.create.title",
      consequenceKeys: ["agent.card.form.create.consequence"],
      headingControl: "forms.create",
      createdLink: { screen: "/forms/[formId]", field: "formId" },
    },
    resultAllowlist: ["formId", "slug"],
  });

  function createdCard(result: Record<string, string>): AgentCardView {
    const plan = proposal([CREATE_FORM]);
    return settleStep(
      startRun(initialCard(plan)),
      0,
      CREATE_FORM,
      { outcome: "done", result },
      PROPOSED_AT,
    );
  }

  it("offers no link until the step has run", () => {
    const plan = proposal([CREATE_FORM]);
    renderCard(plan, initialCard(plan));
    expect(screen.queryByRole("link", { name: "Open what this created" })).toBeNull();
  });

  it("links the new item at its page route once the step reports its id", () => {
    const plan = proposal([CREATE_FORM]);
    renderCard(plan, createdCard({ formId: "frm_quote", slug: "quote" }));
    expect(screen.getByRole("link", { name: "Open what this created" }).getAttribute("href")).toBe(
      "/forms/frm_quote",
    );
  });

  it("renders no link for an id no page route serves", () => {
    const plan = proposal([CREATE_FORM]);
    renderCard(plan, createdCard({ formId: "../../etc", slug: "quote" }));
    expect(screen.queryByRole("link", { name: "Open what this created" })).toBeNull();
  });
});

describe("focus and the live region", () => {
  it("leaves focus alone unless it was already inside the panel", () => {
    const plan = proposal([step()]);
    renderCard(plan, initialCard(plan));
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the heading when the card arrives with focus in the panel", () => {
    const plan = proposal([step()]);
    renderCard(plan, initialCard(plan), { focusOnArrival: true });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2 }));
  });

  it("moves focus to the result line once the card settles", () => {
    const plan = proposal([step()]);
    renderCard(plan, cancelCard(initialCard(plan), PROPOSED_AT));
    expect(document.activeElement?.textContent).toBe("Cancelled by you. Nothing was sent.");
  });

  it("announces progress in words through one polite region", () => {
    const plan = proposal([step(), step()]);
    const { container } = renderCard(plan, startRun(initialCard(plan)));
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
          card={initialCard(plan)}

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
        summary="Publish version 3 of frm_quote to prod"
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
    expect(marker.textContent?.replace(/\s+/gu, " ").trim()).toBe("proposed · Review");
    expect(marker.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Assistant");
    expect(marker.getAttribute("href")).toBe("#card-h");
    marker.click();
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Nothing runs from here/u).textContent).toContain(
      "Publish version 3 of frm_quote to prod",
    );
  });

  it("outlines the heading-row control it mirrors and leaves the control itself unchanged", () => {
    render(<MarkerHost onReview={() => undefined} />);
    const control = screen.getByRole("button", { name: "Release a version" });
    expect(control.dataset["proposed"]).toBe("true");
    expect(screen.queryByRole("button", { name: /Confirm/u })).toBeNull();
  });

  it("clears the control's outline when the card leaves Proposed", () => {
    const { unmount } = render(<MarkerHost onReview={() => undefined} />);
    const control = screen.getByRole("button", { name: "Release a version" });
    unmount();
    expect(control.dataset["proposed"]).toBeUndefined();
  });
});

describe("an address the card collects", () => {
  function address(): HTMLInputElement {
    return screen.getByTestId<HTMLInputElement>("qcms-acard-typed-input");
  }

  function confirm(): HTMLElement {
    return screen.getByRole("button", { name: "Confirm" });
  }

  it("asks the person for it, because no step carries one", () => {
    const plan = proposal([DERIVE_THEME]);
    renderCard(plan, initialCard(plan));
    expect(address().value).toBe("");
    expect(JSON.stringify(plan.steps[0]?.args)).not.toContain("http");
  });

  it("holds Confirm closed until it is a whole https address", () => {
    const plan = proposal([DERIVE_THEME]);
    renderCard(plan, initialCard(plan));
    expect(confirm().hasAttribute("disabled")).toBe(true);
    fireEvent.change(address(), { target: { value: "brand.example" } });
    expect(confirm().hasAttribute("disabled")).toBe(true);
    fireEvent.change(address(), { target: { value: "http://brand.example/" } });
    expect(confirm().hasAttribute("disabled")).toBe(true);
    fireEvent.change(address(), { target: { value: "https://brand.example/" } });
    expect(confirm().hasAttribute("disabled")).toBe(false);
  });

  it("echoes it in full above the Confirm, as text that wraps", () => {
    const plan = proposal([DERIVE_THEME]);
    renderCard(plan, initialCard(plan));
    const typed =
      "https://www.bright-start-early-learning-and-childcare.example/about/our-setting?ref=print";
    fireEvent.change(address(), { target: { value: typed } });
    expect(address().value).toBe(typed);
    const echo = screen.getByTestId("qcms-acard-typed-echo-value");
    expect(echo.textContent).toBe(typed);
    expect(echo.className).toBe("qcms-acard__echo-value");
    expect(
      screen.getByTestId("qcms-acard-typed-echo").compareDocumentPosition(confirm()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it("echoes nothing until something is typed", () => {
    const plan = proposal([DERIVE_THEME]);
    renderCard(plan, initialCard(plan));
    expect(screen.queryByTestId("qcms-acard-typed-echo")).toBeNull();
  });

  it("hands the typed address to the Confirm and nothing else", () => {
    const onConfirm = vi.fn();
    const plan = proposal([DERIVE_THEME]);
    renderCard(plan, initialCard(plan), { onConfirm });
    fireEvent.change(address(), { target: { value: "  https://brand.example/  " } });
    fireEvent.click(confirm());
    expect(onConfirm.mock.calls).toStrictEqual([["https://brand.example/"]]);
  });

  it("asks for no address on a plan that does not want one", () => {
    const plan = proposal([step()]);
    renderCard(plan, initialCard(plan));
    expect(screen.queryByTestId("qcms-acard-typed-input")).toBeNull();
  });
});
