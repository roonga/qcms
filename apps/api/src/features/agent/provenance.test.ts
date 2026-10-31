import { describe, expect, it } from "vitest";

import type { ActionRequestFacts } from "./actions/types.js";
import { checkProvenance, type RecordedStep } from "./provenance.js";
import {
  argumentsDigest,
  signProposalToken,
  type ProposalStepBinding,
} from "./proposal-token.js";

const APP_KEY = "test-app-key-0123456789abcdefghijklmn";
const issuedAt = new Date("2026-10-31T09:00:00.000Z");
const atOnce = new Date("2026-10-31T09:00:05.000Z");

const MINT_ARGS = {
  formId: "frm_a",
  count: 20,
  expiresAt: "2026-11-30T00:00:00.000Z",
  oneTime: true,
};

const RELEASE_ARGS = { formId: "frm_a", version: 3, environment: "test" };

function mintFacts(overrides: Partial<ActionRequestFacts> = {}): ActionRequestFacts {
  return {
    path: "/admin/forms/{id}/links",
    method: "POST",
    params: { id: "frm_a" },
    body: { environment: "test", count: 20, expiresAt: MINT_ARGS.expiresAt, oneTime: true },
    environment: "test",
    ...overrides,
  };
}

function releaseFacts(
  body: Readonly<Record<string, unknown>>,
  environment: string,
): ActionRequestFacts {
  return {
    path: "/admin/forms/{id}/releases",
    method: "POST",
    params: { id: "frm_a" },
    body,
    environment,
  };
}

async function binding(
  kind: string,
  args: unknown,
  environment: string,
): Promise<ProposalStepBinding> {
  return { kind, argsDigest: await argumentsDigest(args), environment };
}

async function tokenFor(
  steps: readonly ProposalStepBinding[],
  options: { readonly sub?: string; readonly pid?: string } = {},
): Promise<string> {
  return signProposalToken(APP_KEY, {
    sub: options.sub ?? "user_1",
    pid: options.pid ?? "prp_1",
    steps,
    formId: "frm_a",
    issuedAt,
  });
}

function recorded(
  stepIndex: number,
  detail: string | null,
  confirmedAt: Date = atOnce,
): RecordedStep {
  return { stepIndex, detail, confirmedAt };
}

async function check(args: {
  readonly token: string;
  readonly rawStep?: string;
  readonly subject?: string;
  readonly facts: ActionRequestFacts;
  readonly recorded?: readonly RecordedStep[];
  readonly now?: Date;
}) {
  return checkProvenance({
    token: args.token,
    rawStep: args.rawStep ?? "0",
    appKey: APP_KEY,
    subject: args.subject ?? "user_1",
    facts: args.facts,
    recorded: args.recorded ?? [],
    now: args.now ?? atOnce,
  });
}

describe("checkProvenance: a single-step card", () => {
  it("accepts the step the token names, on its own route, with its own arguments", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")]);
    const result = await check({ token, facts: mintFacts() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal).toMatchObject({
      proposalId: "prp_1",
      stepIndex: 0,
      stepCount: 1,
      kind: "link.mint",
      screen: "/forms/[formId]/links",
      environment: "test",
      formId: "frm_a",
    });
  });

  it("refuses a tampered token", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")]);
    const result = await check({ token: `${token}x`, facts: mintFacts() });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_SIGNATURE" });
  });

  it("refuses an expired token on step 0", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")]);
    const result = await check({
      token,
      facts: mintFacts(),
      now: new Date(issuedAt.getTime() + 11 * 60 * 1000),
    });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_EXPIRED" });
  });

  it("refuses a token issued to another user", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")], {
      sub: "user_2",
    });
    const result = await check({ token, facts: mintFacts() });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_SUBJECT" });
  });

  it("refuses a token presented on a route other than its step's kind's route", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")]);
    const result = await check({
      token,
      facts: mintFacts({ path: "/admin/forms/{id}/links/{linkId}/revoke" }),
    });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_ROUTE" });
  });

  it("refuses a request whose arguments differ from the digest", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")]);
    const result = await check({
      token,
      facts: mintFacts({ body: { environment: "test", count: 200, expiresAt: MINT_ARGS.expiresAt, oneTime: true } }),
    });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_ARGUMENTS" });
  });

  it("refuses a request performed in another environment than the step's", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")]);
    const result = await check({ token, facts: mintFacts({ environment: "prod" }) });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_ENVIRONMENT" });
  });

  it("refuses a step index outside the list", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")]);
    expect(await check({ token, rawStep: "1", facts: mintFacts() })).toEqual({
      ok: false,
      code: "AGENT_PROPOSAL_STEP_RANGE",
    });
    expect(await check({ token, rawStep: "x", facts: mintFacts() })).toEqual({
      ok: false,
      code: "AGENT_PROPOSAL_MALFORMED",
    });
  });

  it("refuses a step already recorded, which is the replay the constraint also catches", async () => {
    const token = await tokenFor([await binding("link.mint", MINT_ARGS, "test")]);
    const result = await check({ token, facts: mintFacts(), recorded: [recorded(0, "20")] });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_ORDER" });
  });
});

describe("checkProvenance: a plan runs in order (criterion 4)", () => {
  async function plan(): Promise<string> {
    return tokenFor([
      await binding("link.mint", MINT_ARGS, "test"),
      await binding("form.release", RELEASE_ARGS, "test"),
    ]);
  }

  it("refuses step 1 while step 0 is unrecorded", async () => {
    const result = await check({
      token: await plan(),
      rawStep: "1",
      facts: releaseFacts({ version: 3, environment: "test" }, "test"),
    });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_ORDER" });
  });

  it("accepts step 1 once step 0 is recorded", async () => {
    const result = await check({
      token: await plan(),
      rawStep: "1",
      facts: releaseFacts({ version: 3, environment: "test" }, "test"),
      recorded: [recorded(0, "20")],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a step whose list was reordered, because the digest moves with it", async () => {
    const reordered = await tokenFor([
      await binding("form.release", RELEASE_ARGS, "test"),
      await binding("link.mint", MINT_ARGS, "test"),
    ]);
    const result = await check({ token: reordered, facts: mintFacts() });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_ROUTE" });
  });

  it("completes a run that crosses `exp`, bounded by step 0's confirmation", async () => {
    const confirmedAt = new Date(issuedAt.getTime() + 9 * 60 * 1000);
    const result = await check({
      token: await plan(),
      rawStep: "1",
      facts: releaseFacts({ version: 3, environment: "test" }, "test"),
      recorded: [recorded(0, "20", confirmedAt)],
      now: new Date(confirmedAt.getTime() + 60 * 1000),
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a step sent more than ten minutes after step 0's confirmation", async () => {
    const confirmedAt = new Date(issuedAt.getTime() + 60 * 1000);
    const result = await check({
      token: await plan(),
      rawStep: "1",
      facts: releaseFacts({ version: 3, environment: "test" }, "test"),
      recorded: [recorded(0, "20", confirmedAt)],
      now: new Date(confirmedAt.getTime() + 11 * 60 * 1000),
    });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_WINDOW" });
  });
});

describe("checkProvenance: a two-environment plan (criterion 1, review finding B1)", () => {
  async function twoEnvironments(): Promise<string> {
    return tokenFor([
      await binding("form.release", { formId: "frm_a", version: 3, environment: "test" }, "test"),
      await binding("form.release", { formId: "frm_a", version: 3, environment: "prod" }, "prod"),
    ]);
  }

  it("verifies step 0 against `test` and step 1 against `prod`", async () => {
    const token = await twoEnvironments();
    expect(
      (await check({ token, facts: releaseFacts({ version: 3, environment: "test" }, "test") })).ok,
    ).toBe(true);
    expect(
      (
        await check({
          token,
          rawStep: "1",
          facts: releaseFacts({ version: 3, environment: "prod" }, "prod"),
          recorded: [recorded(0, "3")],
        })
      ).ok,
    ).toBe(true);
  });

  it("refuses the same token with step 1's request rewritten to `test`", async () => {
    const result = await check({
      token: await twoEnvironments(),
      rawStep: "1",
      facts: releaseFacts({ version: 3, environment: "test" }, "test"),
      recorded: [recorded(0, "3")],
    });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_ENVIRONMENT" });
  });
});

describe("checkProvenance: a reference is checked against the recorded value", () => {
  async function referencingPlan(): Promise<string> {
    return tokenFor([
      await binding("form.publish", { formId: "frm_a" }, "test"),
      await binding(
        "form.release",
        { formId: "frm_a", version: { fromStep: 0, field: "version" }, environment: "test" },
        "test",
      ),
    ]);
  }

  it("accepts the resolved value that step 0 recorded", async () => {
    const result = await check({
      token: await referencingPlan(),
      rawStep: "1",
      facts: releaseFacts({ version: 7, environment: "test" }, "test"),
      recorded: [recorded(0, "7")],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a reference resolved to a value other than the recorded one", async () => {
    const result = await check({
      token: await referencingPlan(),
      rawStep: "1",
      facts: releaseFacts({ version: 8, environment: "test" }, "test"),
      recorded: [recorded(0, "7")],
    });
    expect(result).toEqual({ ok: false, code: "AGENT_PROPOSAL_ARGUMENTS" });
  });
});
