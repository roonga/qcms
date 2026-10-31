import { describe, expect, it } from "vitest";

import type { HeldGrant } from "../../membership/policy.js";
import { offeredActionKinds } from "../grant-filter.js";
import { verifyProposalToken } from "../proposal-token.js";
import { buildProposal, MAX_PLAN_STEPS, type ProposedStep } from "./propose.js";

const APP_KEY = "test-app-key-0123456789abcdefghijklmn";
const issuedAt = new Date("2026-10-31T09:00:00.000Z");

const APPROVER: HeldGrant = { role: "forms.approver", environments: ["all"], forms: ["all"] };
const EDITOR: HeldGrant = { role: "forms.editor", environments: ["all"], forms: ["all"] };
const VIEWER: HeldGrant = { role: "forms.viewer", environments: ["all"], forms: ["all"] };

function propose(args: {
  readonly steps: readonly ProposedStep[];
  readonly grants?: readonly HeldGrant[];
  readonly current?: string;
  readonly requireSecondApprover?: boolean;
  readonly proposalsThisTurn?: number;
}) {
  const grants = args.grants ?? [EDITOR, APPROVER];
  return buildProposal({
    steps: args.steps,
    subject: "user_1",
    appKey: APP_KEY,
    current: args.current ?? "test",
    offered: offeredActionKinds({
      memberRole: undefined,
      grants,
      environments: ["test", "prod"],
      current: args.current ?? "test",
      formId: "frm_a",
    }),
    requireSecondApprover: args.requireSecondApprover ?? false,
    productionEnvironment: "prod",
    formId: "frm_a",
    issuedAt,
    proposalsThisTurn: args.proposalsThisTurn ?? 0,
  });
}

const publish: ProposedStep = { kind: "form.publish", args: { formId: "frm_a" } };

const mint: ProposedStep = {
  kind: "link.mint",
  args: { formId: "frm_a", count: 20, expiresAt: "2026-11-30T00:00:00.000Z", oneTime: true },
};

function releaseTo(environment: string, version: unknown): ProposedStep {
  return { kind: "form.release", args: { formId: "frm_a", version, environment } };
}

describe("buildProposal: a step with more than one reference", () => {
  it("is refused at proposal time with a reason the model can act on", async () => {
    const outcome = await propose({
      steps: [
        publish,
        {
          kind: "form.release",
          args: {
            formId: "frm_a",
            version: { fromStep: 0, field: "version" },
            environment: { fromStep: 0, field: "version" },
          },
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("more than one");
  });

  it("accepts one reference per step", async () => {
    const outcome = await propose({
      steps: [publish, releaseTo("test", { fromStep: 0, field: "version" })],
    });
    expect(outcome.ok).toBe(true);
  });
});

describe("buildProposal: the caps (criterion 15)", () => {
  it("refuses a second proposal in one turn and says to use one plan (P1)", async () => {
    const outcome = await propose({ steps: [mint], proposalsThisTurn: 1 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("one plan");
  });

  it("refuses a plan of more than 25 steps (P2)", async () => {
    const outcome = await propose({
      steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, () => mint),
    });
    expect(outcome.ok).toBe(false);
  });

  it("accepts a plan of exactly 25 steps", async () => {
    const outcome = await propose({
      steps: Array.from({ length: MAX_PLAN_STEPS }, () => mint),
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses an empty step list", async () => {
    expect((await propose({ steps: [] })).ok).toBe(false);
  });
});

describe("buildProposal: the grant filter behind it (criterion 3)", () => {
  it("refuses every kind for a `forms.viewer` and tells the model to explain instead", async () => {
    const outcome = await propose({ steps: [mint], grants: [VIEWER] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("Explain and navigate");
  });

  it("refuses a production release step proposed by an editor, split and all", async () => {
    const outcome = await propose({ steps: [releaseTo("prod", 3)], grants: [EDITOR] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("prod");
  });

  it("refuses a name outside the registry without ending the turn", async () => {
    const outcome = await propose({ steps: [{ kind: "form.obliterate", args: {} }] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("no action kind named");
  });
});

describe("buildProposal: the token it mints (criterion 1)", () => {
  it("binds the ordered steps, each with its own environment", async () => {
    const outcome = await propose({
      steps: [releaseTo("test", 3), releaseTo("prod", 3)],
      grants: [APPROVER],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const verified = await verifyProposalToken(APP_KEY, outcome.proposal.token ?? "");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.steps.map((step) => step.environment)).toEqual(["test", "prod"]);
    expect(verified.payload.pid).toBe(outcome.proposal.proposalId);
    expect(verified.payload.sub).toBe("user_1");
  });

  it("takes a switcher kind's environment from the turn's switcher, not its arguments", async () => {
    const outcome = await propose({ steps: [mint], current: "prod", grants: [APPROVER] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.steps[0]?.environment).toBe("prod");
  });

  it("keeps a reference symbolic rather than resolving it into the digest", async () => {
    const outcome = await propose({
      steps: [publish, releaseTo("test", { fromStep: 0, field: "version" })],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.steps[1]?.args.version).toEqual({ fromStep: 0, field: "version" });
  });

  it("refuses a reference to a later step or to a field that step cannot return", async () => {
    const forward = await propose({
      steps: [releaseTo("test", { fromStep: 1, field: "version" }), publish],
    });
    expect(forward.ok).toBe(false);

    const unknownField = await propose({
      steps: [publish, releaseTo("test", { fromStep: 0, field: "secret" })],
    });
    expect(unknownField.ok).toBe(false);
    if (unknownField.ok) return;
    expect(unknownField.reason).toContain("does not return a field");
  });

  it("gives every proposal a distinct id", async () => {
    const one = await propose({ steps: [mint] });
    const two = await propose({ steps: [mint] });
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(one.proposal.proposalId).not.toBe(two.proposal.proposalId);
  });

  it("expires ten minutes after it is proposed", async () => {
    const outcome = await propose({ steps: [mint] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Date.parse(outcome.proposal.expiresAt) - Date.parse(outcome.proposal.proposedAt)).toBe(
      600_000,
    );
  });
});

describe("buildProposal: never weaker than the screen (criterion 9)", () => {
  it("refuses a publish-then-release-to-prod plan while the second approver switch is on", async () => {
    const outcome = await propose({
      steps: [publish, releaseTo("prod", { fromStep: 0, field: "version" })],
      grants: [EDITOR, APPROVER],
      requireSecondApprover: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("second approver");
  });

  it("offers the same plan with the switch off", async () => {
    const outcome = await propose({
      steps: [publish, releaseTo("prod", { fromStep: 0, field: "version" })],
      grants: [EDITOR, APPROVER],
      requireSecondApprover: false,
    });
    expect(outcome.ok).toBe(true);
  });

  it("leaves a publish-then-release-to-test plan alone with the switch on", async () => {
    const outcome = await propose({
      steps: [publish, releaseTo("test", { fromStep: 0, field: "version" })],
      requireSecondApprover: true,
    });
    expect(outcome.ok).toBe(true);
  });
});

describe("buildProposal: the card's own data (criterion 5)", () => {
  it("carries the admin's template keys rather than any model text", async () => {
    const outcome = await propose({ steps: [mint] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const [step] = outcome.proposal.steps;
    expect(step?.card.titleKey).toBe("agent.card.link.mint.title");
    expect(step?.card.consequenceKeys.length).toBeGreaterThan(0);
  });

  it("displays every argument the step will run with, in full", async () => {
    const outcome = await propose({ steps: [mint] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.steps[0]?.args).toEqual(mint.args);
  });

  it("refuses arguments the kind's own schema does not accept", async () => {
    const outcome = await propose({
      steps: [{ kind: "link.mint", args: { formId: "frm_a", count: 20 } }],
    });
    expect(outcome.ok).toBe(false);
  });
});

describe("buildProposal: a referenced step's other arguments", () => {
  it("checks every argument the step does not defer to an earlier result", async () => {
    const outcome = await propose({
      steps: [
        publish,
        {
          kind: "form.release",
          args: {
            formId: "frm_a",
            version: { fromStep: 0, field: "version" },
            environment: "test",
            fromEnvironment: 7,
          },
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("arguments are invalid");
  });

  it("refuses an unknown argument beside a reference", async () => {
    const outcome = await propose({
      steps: [
        publish,
        {
          kind: "form.release",
          args: {
            formId: "frm_a",
            version: { fromStep: 0, field: "version" },
            environment: "test",
            approve: true,
          },
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("arguments are invalid");
  });

  it("refuses a reference whose own shape is wrong", async () => {
    const outcome = await propose({
      steps: [publish, releaseTo("test", { fromStep: 0, field: "version", resolve: "now" })],
    });
    expect(outcome.ok).toBe(false);
  });
});

describe("buildProposal: the one field a step's audit row records", () => {
  it("refuses a reference to a release step's environment, which no row verifies", async () => {
    const outcome = await propose({
      steps: [
        releaseTo("test", 3),
        {
          kind: "form.release",
          args: {
            formId: "frm_a",
            version: 3,
            environment: { fromStep: 0, field: "environment" },
          },
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('does not return a field named "environment"');
  });
});

describe("buildProposal: `link.mint`'s expiry is the instant the request carries", () => {
  it("accepts the full UTC instant the descriptor advertises", async () => {
    const outcome = await propose({ steps: [mint] });
    expect(outcome.ok).toBe(true);
  });

  it("refuses a calendar day, which the mint dialog would widen before posting it", async () => {
    const outcome = await propose({
      steps: [
        {
          kind: "link.mint",
          args: { formId: "frm_a", count: 2, expiresAt: "2026-12-31", oneTime: true },
        },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("arguments are invalid");
  });
});
