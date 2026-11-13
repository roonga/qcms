import { beforeEach, describe, expect, it, vi } from "vitest";

import { actionResultTurn, initialCard, startRun } from "@/lib/agent/plan-state";
import { runPlan } from "@/lib/agent/runner";
import type { AgentPlanStep, AgentProposal } from "@/lib/forms/assist-stream";
import type { MintedLink } from "@/lib/forms/types";

type ActionDouble = (...args: readonly unknown[]) => Promise<unknown>;

const mintLinksAction = vi.fn<ActionDouble>();

vi.mock("@/app/(shell)/forms/actions", () => ({
  confirmPublishAction: vi.fn(),
  createFormForCardAction: vi.fn(),
  mintLinksAction: (...args: readonly unknown[]): Promise<unknown> => mintLinksAction(...args),
  releaseVersionAction: vi.fn(),
  reviewReleaseAction: vi.fn(),
  revokeLinkAction: vi.fn(),
  setFormStatusAction: vi.fn(),
  updateSettingsAction: vi.fn(),
}));

const PROPOSED_AT = "2026-07-20T00:00:00.000Z";
const NOW = new Date(PROPOSED_AT);
const WINDOW_LEFT = 10 * 60 * 1000;

const MINT: AgentPlanStep = {
  kind: "link.mint",
  screen: "/operations/forms/[formId]/links",
  args: { formId: "frm_quote", count: 2, expiresAt: "2026-11-30T23:59:59.000Z", oneTime: true },
  environment: "test",
  handOff: false,
  local: false,
  card: {
    titleKey: "agent.card.link.mint.title",
    consequenceKeys: ["agent.card.link.mint.consequence"],
    headingControl: "links.mint",
  },
  resultAllowlist: ["count", "expiresAt", "environment"],
};

const PROPOSAL: AgentProposal = {
  proposalId: "prp_mint",
  token: "tok",
  steps: [MINT],
  proposedAt: PROPOSED_AT,
  expiresAt: "2026-07-20T00:10:00.000Z",
  formId: "frm_quote",
  currentEnvironment: "test",
};

const LINKS: readonly MintedLink[] = [
  {
    linkId: "lnk_one",
    environment: "test",
    url: "https://forms.example/test/l/token-one",
    expiresAt: "2026-11-30T23:59:59.000Z",
  },
  {
    linkId: "lnk_two",
    environment: "test",
    url: "https://forms.example/test/l/token-two",
    expiresAt: "2026-11-30T23:59:59.000Z",
  },
];

async function runMint() {
  const { runStepAction } = await import("./step-actions");
  return runPlan({
    proposal: PROPOSAL,
    card: startRun(initialCard(PROPOSAL)),
    runStep: runStepAction,
    now: () => NOW,
    windowLeftMs: () => WINDOW_LEFT,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mintLinksAction.mockResolvedValue({ status: "minted", links: LINKS });
});

describe("the step that mints links", () => {
  it("hands the card every address it produced", async () => {
    const card = await runMint();

    expect(card.state).toBe("done");
    expect(card.steps[0]?.revealed).toEqual(LINKS);
  });

  it("reports only the allowlisted count, expiry and environment", async () => {
    const card = await runMint();

    expect(card.steps[0]?.result).toEqual({
      count: 2,
      expiresAt: "2026-11-30T23:59:59.000Z",
      environment: "test",
    });
  });

  it("leaves no address anywhere in the turn the next prompt replays", async () => {
    const card = await runMint();
    const turn = actionResultTurn(PROPOSAL, card);

    const replayed = JSON.stringify(turn);
    for (const link of LINKS) {
      expect(replayed).not.toContain(link.url);
      expect(replayed).not.toContain(link.linkId);
    }
  });

  it("reveals nothing when the mint produced nothing", async () => {
    mintLinksAction.mockResolvedValue({ status: "minted", links: [] });

    const card = await runMint();

    expect(card.steps[0]?.revealed).toBeUndefined();
  });
});
