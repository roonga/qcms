import { describe, expect, it } from "vitest";

import { parseFormDefinition, type FormDefinition } from "@roonga/qcms-core";

import type { HeldGrant } from "../../membership/policy.js";
import { offeredActionKinds } from "../grant-filter.js";
import { argumentsDigest, verifyProposalToken } from "../proposal-token.js";
import { buildProposal, MAX_PLAN_STEPS, type ProposeInput, type ProposedStep } from "./propose.js";

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
  readonly proposedDraft?: ProposeInput["proposedDraft"];
  readonly validate?: ProposeInput["validate"];
  readonly screen?: ProposeInput["screen"];
  readonly savedDraft?: ProposeInput["savedDraft"];
}) {
  const grants = args.grants ?? [EDITOR, APPROVER];
  return buildProposal({
    steps: args.steps,
    screen: args.screen ?? "/forms/[formId]",
    ...(args.savedDraft === undefined ? {} : { savedDraft: args.savedDraft }),
    ...(args.proposedDraft === undefined ? {} : { proposedDraft: args.proposedDraft }),
    validate: args.validate ?? (() => Promise.resolve({ issues: [], warnings: [] })),
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

const publish: ProposedStep = {
  kind: "form.publish",
  args: { formId: "frm_a", environment: "test" },
};

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

  it("refuses a publish straight into production while the switch is on", async () => {
    const outcome = await propose({
      steps: [{ kind: "form.publish", args: { formId: "frm_a", environment: "prod" } }],
      grants: [EDITOR, APPROVER],
      requireSecondApprover: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("second approver");
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

const applyDraft: ProposedStep = { kind: "apply-draft", args: { formId: "frm_a" } };

function draftFixture(formId: string): FormDefinition {
  const parsed = parseFormDefinition({
    formId,
    defaultLocale: "en",
    title: { en: "Quote" },
    steps: [
      {
        stepId: "stp_start",
        title: { en: "Start" },
        items: [{ questionId: "q_name", version: 1 }],
      },
    ],
    rules: [],
  });
  if (!parsed.ok) throw new Error(`fixture draft did not parse: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

const WARNING = {
  code: "MULTICHOICE_SAME_STEP_TARGET",
  message: "This rule reveals a question on the step it reads from.",
} as never;

describe("buildProposal: the kind that applies a proposed draft", () => {
  it("carries the draft and the server's own two advisory lists on the step", async () => {
    const outcome = await propose({
      steps: [applyDraft],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
      validate: () => Promise.resolve({ issues: [], warnings: [WARNING] }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const step = outcome.proposal.steps[0];
    expect(step?.local).toBe(true);
    expect(step?.draft?.definition.formId).toBe("frm_a");
    expect(step?.draft?.issues).toEqual([]);
    expect(step?.draft?.warnings).toEqual([WARNING]);
  });

  it("mints no token for it, because it reaches no route", async () => {
    const outcome = await propose({
      steps: [applyDraft],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.token).toBeUndefined();
  });

  it("keeps the token's step indexes those of the steps it binds", async () => {
    const outcome = await propose({
      steps: [applyDraft, publish],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const token = outcome.proposal.token;
    expect(token).toBeDefined();
    const verified = await verifyProposalToken(APP_KEY, token ?? "");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.steps.map((step) => step.kind)).toEqual(["form.publish"]);
  });

  it("is refused when the turn proposed no draft", async () => {
    const outcome = await propose({ steps: [applyDraft] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("propose_draft");
  });

  it("is refused when it names a form other than the one the draft is for", async () => {
    const outcome = await propose({
      steps: [applyDraft],
      proposedDraft: { definition: draftFixture("frm_other"), newQuestions: [] },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("a different form");
  });

  it("applies the draft once in a plan", async () => {
    const outcome = await propose({
      steps: [applyDraft, applyDraft],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("once");
  });

  it("is refused for a caller who may not write the draft", async () => {
    const outcome = await propose({
      steps: [applyDraft],
      grants: [VIEWER],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("form: write");
  });
});

describe("buildProposal: a reference in a plan whose earlier step carries no token", () => {
  it("digests the reference in token-index terms while the card keeps the plan's own", async () => {
    const outcome = await propose({
      steps: [applyDraft, publish, releaseTo("test", { fromStep: 1, field: "version" })],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.proposal.steps[2]?.args.version).toEqual({ fromStep: 1, field: "version" });

    const verified = await verifyProposalToken(APP_KEY, outcome.proposal.token ?? "");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.steps.map((step) => step.kind)).toEqual([
      "form.publish",
      "form.release",
    ]);
    expect(verified.payload.steps[1]?.argsDigest).toBe(
      await argumentsDigest({
        formId: "frm_a",
        version: { fromStep: 0, field: "version" },
        environment: "test",
      }),
    );
  });

  it("leaves a plan without a local step digesting the plan's own indexes", async () => {
    const outcome = await propose({
      steps: [publish, releaseTo("test", { fromStep: 0, field: "version" })],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const verified = await verifyProposalToken(APP_KEY, outcome.proposal.token ?? "");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.steps[1]?.argsDigest).toBe(
      await argumentsDigest({
        formId: "frm_a",
        version: { fromStep: 0, field: "version" },
        environment: "test",
      }),
    );
  });

  it("refuses a reference to the local step itself, which records no row", async () => {
    const outcome = await propose({
      steps: [applyDraft, releaseTo("test", { fromStep: 0, field: "changes" })],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("completes on the screen itself");
  });
});

describe("buildProposal: publishing the questions a saved draft pins (issue #1205)", () => {
  const PINS = [
    { questionId: "q_given_name", version: 1 },
    { questionId: "q_family_name", version: 1 },
  ];

  function publishQuestion(questionId: string, version: number): ProposedStep {
    return { kind: "question.publish", args: { questionId, version } };
  }

  const DRAFT_REVISION = 7;

  const saved = () => Promise.resolve({ revision: DRAFT_REVISION, pins: PINS });

  it("accepts one step per pinned version, then the form's own publish", async () => {
    const outcome = await propose({
      steps: [publishQuestion("q_given_name", 1), publishQuestion("q_family_name", 1), publish],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.proposal.steps.map((step) => step.kind)).toStrictEqual([
      "question.publish",
      "question.publish",
      "form.publish",
    ]);
    const verified = await verifyProposalToken(APP_KEY, outcome.proposal.token ?? "");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    // Its own digest per question, which is what one audit row per question rests on.
    expect(verified.payload.steps[0]?.argsDigest).toBe(
      await argumentsDigest({ questionId: "q_given_name", version: 1 }),
    );
    expect(verified.payload.steps[1]?.argsDigest).not.toBe(verified.payload.steps[0]?.argsDigest);
  });

  it("fits a realistic form: twenty questions and the form, inside the plan cap", async () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      questionId: `q_pinned_${String(index)}`,
      version: 1,
    }));
    const outcome = await propose({
      steps: [...many.map((pin) => publishQuestion(pin.questionId, 1)), publish],
      savedDraft: () => Promise.resolve({ revision: 4, pins: many }),
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses a question the saved draft does not pin, and names what it does", async () => {
    const outcome = await propose({
      steps: [publishQuestion("q_somebody_elses", 1)],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("does not");
    expect(outcome.reason).toContain("q_given_name@v1");
    expect(outcome.reason).toContain("its own page in the library");
  });

  it("refuses a version the saved draft does not pin, for a question it does", async () => {
    const outcome = await propose({
      steps: [publishQuestion("q_given_name", 2)],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(false);
  });

  it("refuses a reference in place of the version, which cannot be checked against the pins", async () => {
    const outcome = await propose({
      steps: [
        { kind: "question.newVersion", args: { questionId: "q_given_name" } },
        {
          kind: "question.publish",
          args: { questionId: "q_given_name", version: { fromStep: 0, field: "version" } },
        },
      ],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(false);
  });

  it("refuses the kind outright where the screen cannot report the draft's pins", async () => {
    const outcome = await propose({ steps: [publishQuestion("q_given_name", 1)] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("cannot say which question versions");
  });

  it("leaves the question's own page alone: no pin set is consulted there", async () => {
    const outcome = await propose({
      steps: [publishQuestion("q_anything", 3)],
      screen: "/questions/[questionId]",
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses a plan that publishes the form before a question it pins", async () => {
    const outcome = await propose({
      steps: [publish, publishQuestion("q_given_name", 1)],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("before step 2");
  });

  it("binds the whole plan to the revision the pins were read at", async () => {
    const outcome = await propose({
      steps: [publishQuestion("q_given_name", 1), publish],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const verified = await verifyProposalToken(APP_KEY, outcome.proposal.token ?? "");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.draftRevision).toBe(DRAFT_REVISION);
    expect(verified.payload.formId).toBe("frm_a");
  });

  it("binds no revision when no step is checked against the draft's pins", async () => {
    const outcome = await propose({ steps: [publish], savedDraft: saved });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const verified = await verifyProposalToken(APP_KEY, outcome.proposal.token ?? "");
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.payload.draftRevision).toBeUndefined();
  });

  it("refuses a token step after the form publish, which would outlive the bound draft", async () => {
    const outcome = await propose({
      steps: [
        publishQuestion("q_given_name", 1),
        publish,
        { kind: "form.close", args: { formId: "frm_a" } },
      ],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("deletes the saved draft");
    expect(outcome.reason).toContain("step 3");
  });

  it("accepts the same plan with the form publish last", async () => {
    const outcome = await propose({
      steps: [
        { kind: "form.close", args: { formId: "frm_a" } },
        publishQuestion("q_given_name", 1),
        publish,
      ],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(true);
  });

  it("leaves a plan bound to no revision free to act after the form publish", async () => {
    const outcome = await propose({
      steps: [publish, { kind: "form.close", args: { formId: "frm_a" } }],
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses a token step after apply-draft, whose save moves the bound revision", async () => {
    const outcome = await propose({
      steps: [applyDraft, publishQuestion("q_given_name", 1)],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("Step 1 (apply-draft) saves the form's draft");
    expect(outcome.reason).toContain("step 2 could not run");
    expect(outcome.reason).toContain("Propose apply-draft on its own");
  });

  it("refuses apply-draft before the publishes even with the form publish last", async () => {
    const outcome = await propose({
      steps: [applyDraft, publishQuestion("q_given_name", 1), publish],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(false);
  });

  it("accepts apply-draft after the bound publishes, where nothing runs on the moved revision", async () => {
    const outcome = await propose({
      steps: [publishQuestion("q_given_name", 1), applyDraft],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(true);
  });

  it("leaves a plan bound to no revision free to publish after apply-draft", async () => {
    const outcome = await propose({
      steps: [applyDraft, publish],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(true);
  });

  it("accepts apply-draft alone", async () => {
    const outcome = await propose({
      steps: [applyDraft],
      proposedDraft: { definition: draftFixture("frm_a"), newQuestions: [] },
      savedDraft: saved,
    });
    expect(outcome.ok).toBe(true);
  });

  it("refuses the kind when the form has no saved draft to read a revision from", async () => {
    const outcome = await propose({
      steps: [publishQuestion("q_given_name", 1)],
      savedDraft: () => Promise.resolve(undefined),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain("no saved draft");
  });
});
