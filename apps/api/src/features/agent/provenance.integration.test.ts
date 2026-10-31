import { FormId, parseQuestionDefinition, QuestionId } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createForm,
  createQuestion,
  createQuestionVersion,
  publishQuestionVersion,
  writeAgentActionRow,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  REQUEST_ENVIRONMENT_HEADER,
  registerRequestEnvironment,
} from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerForms } from "../forms/route.js";
import { registerLinks } from "../links/route.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { policyForRequest } from "../membership/route-policy.js";
import { registerReleases } from "../releases/route.js";
import { ACTION_KINDS } from "./actions/registry.js";
import { offeredActionKinds } from "./grant-filter.js";
import { argumentsDigest, signProposalToken } from "./proposal-token.js";
import { registerAgentProvenance } from "./provenance-mount.js";
import { PROPOSAL_HEADER, PROPOSAL_STEP_HEADER } from "./provenance.js";
import { buildProposal } from "./tools/propose.js";

/**
 * SEC-17's D0 criteria against Postgres. The pure checks live in `provenance.test.ts`;
 * what is here needs the recorded rows, the real route policy and the handlers' own
 * transactions.
 */

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const FUTURE = "2026-12-31T23:59:59.000Z";

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let owner: { token: string; userId: string };
let viewer: { token: string; userId: string };

/**
 * Movable, because criterion 10's "a plan whose run crosses `exp` completes" is about the
 * deployment's clock passing between two steps. The provenance middleware reads this same
 * clock, as the handlers that stamp `confirmed-at` do.
 */
let now = new Date("2026-07-20T00:00:00.000Z");

function buildApp(): { deps: Deps; app: ReturnType<typeof createApp> } {
  const built = makeDeps({
    db: testDb.db,
    clock: { now: () => now },
    env: validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }),
  });
  return {
    deps: built,
    app: createApp(built, ADMIN_ONLY, {
      groups: {
        admin: [
          registerAdminAuth,
          registerRequestEnvironment,
          registerGrantCheck,
          registerAgentProvenance,
          registerForms,
          registerReleases,
          registerLinks,
        ],
      },
    }),
  };
}

async function seedPublishedQuestion(id: string, label: string): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition({
    questionId: id,
    type: "shortText",
    label: { en: label },
  });
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: id.replaceAll("_", "-"),
  });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}

beforeAll(async () => {
  testDb = await startTestDb();
  ({ deps, app } = buildApp());
  internalToken = internalTokenFor(deps.config);
  owner = await seedAdminSession(testDb.db, { label: "owner" });
  viewer = await seedAdminSession(testDb.db, {
    label: "viewer",
    claim: false,
    grants: ["forms.viewer"],
    owner: false,
  });
  await seedPublishedQuestion("q_prov_it", "Provenance");
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

interface Caller {
  readonly token: string;
  readonly userId: string;
}

function headersFor(
  caller: Caller,
  environment: string,
  proposal?: { readonly token: string; readonly step: number },
): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: caller.token,
    [REQUEST_ENVIRONMENT_HEADER]: environment,
    ...(proposal === undefined
      ? {}
      : {
          [PROPOSAL_HEADER]: proposal.token,
          [PROPOSAL_STEP_HEADER]: String(proposal.step),
        }),
  };
}

async function send(args: {
  readonly caller: Caller;
  readonly path: string;
  readonly environment: string;
  readonly body?: unknown;
  readonly proposal?: { readonly token: string; readonly step: number };
}): Promise<Response> {
  return app.request(`/admin${args.path}`, {
    method: "POST",
    headers: headersFor(args.caller, args.environment, args.proposal),
    ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
  });
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: { code?: unknown } };
  return typeof body.error?.code === "string" ? body.error.code : "";
}

/** One step's binding, digested over the arguments the card would display. */
async function binding(
  kind: string,
  args: unknown,
  environment: string,
): Promise<{ kind: string; argsDigest: string; environment: string }> {
  return { kind, argsDigest: await argumentsDigest(args), environment };
}

function advanceClock(byMs: number): void {
  now = new Date(now.getTime() + byMs);
}

let proposalCounter = 0;

async function mintToken(args: {
  readonly subject: string;
  readonly steps: readonly { kind: string; argsDigest: string; environment: string }[];
  readonly formId?: string;
}): Promise<{ readonly token: string; readonly proposalId: string }> {
  proposalCounter += 1;
  const proposalId = `prp_it_${String(proposalCounter).padStart(4, "0")}`;
  const token = await signProposalToken(deps.config.keys.app, {
    sub: args.subject,
    pid: proposalId,
    steps: args.steps,
    formId: args.formId,
    issuedAt: deps.clock.now(),
  });
  return { token, proposalId };
}

async function countRows(proposalId: string): Promise<number> {
  const res = await testDb.client.query<{ n: number }>(
    `select count(*)::int as n from control.agent_actions where proposal_id = $1`,
    [proposalId],
  );
  return (res.rows[0] as { n: number }).n;
}

async function rowsFor(
  proposalId: string,
): Promise<
  { step_index: number; kind: string; environment: string | null; detail: string | null }[]
> {
  const res = await testDb.client.query(
    `select step_index, kind, environment, detail from control.agent_actions
      where proposal_id = $1 order by step_index`,
    [proposalId],
  );
  return res.rows as {
    step_index: number;
    kind: string;
    environment: string | null;
    detail: string | null;
  }[];
}

async function seedFormWithDraft(formId: string): Promise<void> {
  const created = await send({
    caller: owner,
    path: "/forms",
    environment: "prod",
    body: { formId, slug: formId.replace("frm_", "").replaceAll("_", "-"), defaultLocale: "en" },
  });
  expect(created.status).toBe(201);
  const saved = await app.request(`/admin/forms/${formId}/draft`, {
    method: "PUT",
    headers: headersFor(owner, "prod"),
    body: JSON.stringify({
      definition: {
        formId,
        defaultLocale: "en",
        title: { en: "Provenance" },
        steps: [
          {
            stepId: "stp_one",
            title: { en: "One" },
            items: [{ questionId: "q_prov_it", version: 1 }],
          },
        ],
        rules: [],
      },
    }),
  });
  expect(saved.status).toBe(200);
}

/** A form with one published version, which is what a release step needs to exist. */
async function seedPublishedForm(formId: string): Promise<number> {
  await seedFormWithDraft(formId);
  const published = await send({
    caller: owner,
    path: `/forms/${formId}/publish`,
    environment: "prod",
  });
  expect(published.status).toBe(200);
  return ((await published.json()) as { version: number }).version;
}

async function linkCount(formId: string): Promise<number> {
  const res = await testDb.client.query<{ n: number }>(
    `select count(*)::int as n from secure_links where form_id = $1`,
    [formId],
  );
  return (res.rows[0] as { n: number }).n;
}

const mintArgs = (formId: string): Record<string, unknown> => ({
  formId,
  count: 1,
  expiresAt: FUTURE,
  oneTime: false,
});

const mintBody = { environment: "prod", count: 1, expiresAt: FUTURE, oneTime: false } as const;

describe("provenance adds provenance and never rights (criterion 2)", () => {
  const FORM_ID = "frm_prov_equal";

  beforeAll(async () => {
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FormId.parse(FORM_ID),
      slug: "prov-equal",
      defaultLocale: "en",
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("authorises an allowed act identically with and without a token, and only the token writes a row", async () => {
    const plain = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
    });
    expect(plain.status).toBe(201);

    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: [await binding("link.mint", mintArgs(FORM_ID), "prod")],
      formId: FORM_ID,
    });
    const proposed = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 0 },
    });
    expect(proposed.status).toBe(plain.status);

    expect(await rowsFor(proposalId)).toEqual([
      { step_index: 0, kind: "link.mint", environment: "prod", detail: "1" },
    ]);
  });

  it("refuses a refused act identically with and without a token, with the route's own code", async () => {
    const plain = await send({
      caller: viewer,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
    });
    expect(plain.status).toBe(403);
    const plainCode = await errorCode(plain);

    const { token, proposalId } = await mintToken({
      subject: viewer.userId,
      steps: [await binding("link.mint", mintArgs(FORM_ID), "prod")],
      formId: FORM_ID,
    });
    const proposed = await send({
      caller: viewer,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 0 },
    });
    expect(proposed.status).toBe(403);
    // The route's own refusal, not a provenance code: the grant check runs first, so a
    // token cannot carry a caller past the policy that refuses them without one.
    expect(await errorCode(proposed)).toBe(plainCode);
    expect(plainCode.startsWith("AGENT_PROPOSAL_")).toBe(false);
    expect(await countRows(proposalId)).toBe(0);
  });
});

describe("a replayed step rolls back on the unique constraint (criterion 1)", () => {
  const FORM_ID = "frm_prov_replay";

  beforeAll(async () => {
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FormId.parse(FORM_ID),
      slug: "prov-replay",
      defaultLocale: "en",
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("runs step 0 once and refuses the same step again, minting nothing the second time", async () => {
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: [await binding("link.mint", mintArgs(FORM_ID), "prod")],
      formId: FORM_ID,
    });

    const first = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 0 },
    });
    expect(first.status).toBe(201);
    const minted = await linkCount(FORM_ID);

    const replay = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 0 },
    });
    expect(replay.status).toBe(403);
    expect(await errorCode(replay)).toBe("AGENT_PROPOSAL_ORDER");
    expect(await linkCount(FORM_ID)).toBe(minted);
    expect(await countRows(proposalId)).toBe(1);
  });

  it("rolls the step's own transaction back when the constraint catches the duplicate", async () => {
    const { proposalId } = await mintToken({
      subject: owner.userId,
      steps: [await binding("link.mint", mintArgs(FORM_ID), "prod")],
      formId: FORM_ID,
    });
    const row = {
      proposalId,
      stepIndex: 0,
      stepCount: 1,
      actor: owner.userId,
      workspaceId: SEED_WORKSPACE_ID,
      environment: "prod",
      kind: "link.mint",
      screen: "/forms/[formId]/links",
      proposedAt: deps.clock.now(),
      confirmedAt: deps.clock.now(),
      detail: "1",
    };
    await writeAgentActionRow(testDb.db, row);

    // The act and its row share one transaction, so the constraint undoes both. The
    // middleware refuses a replay before this point; this is the backstop under it.
    const rolledBack = testDb.db.transaction(async (tx) => {
      await createForm(tx, {
        workspaceId: SEED_WORKSPACE_ID,
        formId: FormId.parse("frm_prov_rollback"),
        slug: "prov-rollback",
        defaultLocale: "en",
      });
      await writeAgentActionRow(tx, { ...row, detail: "99" });
    });
    await expect(rolledBack).rejects.toThrow();

    const forms = await testDb.client.query<{ n: number }>(
      `select count(*)::int as n from forms where form_id = 'frm_prov_rollback'`,
    );
    expect((forms.rows[0] as { n: number }).n).toBe(0);
    expect(await rowsFor(proposalId)).toEqual([
      { step_index: 0, kind: "link.mint", environment: "prod", detail: "1" },
    ]);
  });
});

describe("a two-environment plan verifies step by step (criterion 1, plan-two-envs)", () => {
  // One form per run, because releasing the same version to the same environment twice is
  // the release route's own 409 and would mask what these two tests assert.
  const RUN_FORM_ID = "frm_prov_envs_run";
  const REWRITE_FORM_ID = "frm_prov_envs_rewrite";

  async function releaseSteps(
    formId: string,
    version: number,
  ): Promise<readonly { kind: string; argsDigest: string; environment: string }[]> {
    return [
      await binding("form.release", { formId, version, environment: "test" }, "test"),
      await binding("form.release", { formId, version, environment: "prod" }, "prod"),
    ];
  }

  beforeAll(async () => {
    await seedPublishedForm(RUN_FORM_ID);
    await seedPublishedForm(REWRITE_FORM_ID);
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("verifies step 0 against `test` and step 1 against `prod`", async () => {
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: await releaseSteps(RUN_FORM_ID, 1),
      formId: RUN_FORM_ID,
    });

    const toTest = await send({
      caller: owner,
      path: `/forms/${RUN_FORM_ID}/releases`,
      environment: "test",
      body: { environment: "test", version: 1 },
      proposal: { token, step: 0 },
    });
    expect(toTest.status).toBe(200);

    const toProd = await send({
      caller: owner,
      path: `/forms/${RUN_FORM_ID}/releases`,
      environment: "prod",
      body: { environment: "prod", version: 1 },
      proposal: { token, step: 1 },
    });
    expect(toProd.status).toBe(200);

    expect(await rowsFor(proposalId)).toEqual([
      { step_index: 0, kind: "form.release", environment: "test", detail: "1" },
      { step_index: 1, kind: "form.release", environment: "prod", detail: "1" },
    ]);
  });

  it("refuses the same token with step 1's request rewritten to `test`", async () => {
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: await releaseSteps(REWRITE_FORM_ID, 1),
      formId: REWRITE_FORM_ID,
    });
    const toTest = await send({
      caller: owner,
      path: `/forms/${REWRITE_FORM_ID}/releases`,
      environment: "test",
      body: { environment: "test", version: 1 },
      proposal: { token, step: 0 },
    });
    expect(toTest.status).toBe(200);

    const rewritten = await send({
      caller: owner,
      path: `/forms/${REWRITE_FORM_ID}/releases`,
      environment: "test",
      body: { environment: "test", version: 1 },
      proposal: { token, step: 1 },
    });
    expect(rewritten.status).toBe(403);
    expect(await errorCode(rewritten)).toBe("AGENT_PROPOSAL_ENVIRONMENT");
    expect(await countRows(proposalId)).toBe(1);
  });
});

describe("`plan-three` runs end to end, with the reference checked (criterion 4)", () => {
  const FORM_ID = "frm_prov_ref";

  beforeAll(async () => {
    await seedFormWithDraft(FORM_ID);
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("refuses a reference resolved to a value other than the recorded one, then runs all three steps", async () => {
    const steps = [
      await binding("form.publish", { formId: FORM_ID }, "prod"),
      await binding(
        "form.release",
        { formId: FORM_ID, version: { fromStep: 0, field: "version" }, environment: "test" },
        "test",
      ),
      await binding("link.mint", mintArgs(FORM_ID), "prod"),
    ];
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps,
      formId: FORM_ID,
    });

    const published = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/publish`,
      environment: "prod",
      proposal: { token, step: 0 },
    });
    expect(published.status).toBe(200);
    const { version } = (await published.json()) as { version: number };
    expect(await rowsFor(proposalId)).toEqual([
      { step_index: 0, kind: "form.publish", environment: "prod", detail: String(version) },
    ]);

    const wrong = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/releases`,
      environment: "test",
      body: { environment: "test", version: version + 1 },
      proposal: { token, step: 1 },
    });
    expect(wrong.status).toBe(403);
    expect(await errorCode(wrong)).toBe("AGENT_PROPOSAL_ARGUMENTS");
    expect(await countRows(proposalId)).toBe(1);

    const right = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/releases`,
      environment: "test",
      body: { environment: "test", version },
      proposal: { token, step: 1 },
    });
    expect(right.status).toBe(200);
    expect(await countRows(proposalId)).toBe(2);

    const minted = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 2 },
    });
    expect(minted.status).toBe(201);
    expect(await rowsFor(proposalId)).toEqual([
      { step_index: 0, kind: "form.publish", environment: "prod", detail: String(version) },
      { step_index: 1, kind: "form.release", environment: "test", detail: String(version) },
      { step_index: 2, kind: "link.mint", environment: "prod", detail: "1" },
    ]);
  });
});

describe("`plan-fails-at-2` stops at its failed step (criterion 4)", () => {
  const FORM_ID = "frm_prov_fails";

  beforeAll(async () => {
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FormId.parse(FORM_ID),
      slug: "prov-fails",
      defaultLocale: "en",
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("records step 0, writes nothing for the failed step, and never admits step 2", async () => {
    const steps = [
      await binding("link.mint", mintArgs(FORM_ID), "prod"),
      await binding("link.revoke", { formId: FORM_ID, linkId: "lnk_absent" }, "prod"),
      await binding("link.mint", { ...mintArgs(FORM_ID), count: 3 }, "prod"),
    ];
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps,
      formId: FORM_ID,
    });

    const first = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 0 },
    });
    expect(first.status).toBe(201);
    const afterFirst = await linkCount(FORM_ID);

    const failed = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links/lnk_absent/revoke`,
      environment: "prod",
      proposal: { token, step: 1 },
    });
    expect(failed.status).toBe(404);

    // The runner would never send step 2; a client that did is refused, because step 1
    // wrote no row to order it behind.
    const never = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: { ...mintBody, count: 3 },
      proposal: { token, step: 2 },
    });
    expect(never.status).toBe(403);
    expect(await errorCode(never)).toBe("AGENT_PROPOSAL_ORDER");

    expect(await countRows(proposalId)).toBe(1);
    expect(await linkCount(FORM_ID)).toBe(afterFirst);
  });
});

describe("a step's row exists exactly when its own transaction committed (criterion 7)", () => {
  const FORM_ID = "frm_prov_audit";

  beforeAll(async () => {
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FormId.parse(FORM_ID),
      slug: "prov-audit",
      defaultLocale: "en",
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("writes no row for a step whose handler refused inside its transaction", async () => {
    const args = { formId: FORM_ID, linkId: "lnk_does_not_exist" };
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: [await binding("link.revoke", args, "prod")],
      formId: FORM_ID,
    });
    const res = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links/lnk_does_not_exist/revoke`,
      environment: "prod",
      proposal: { token, step: 0 },
    });
    expect(res.status).toBe(404);
    expect(await countRows(proposalId)).toBe(0);
  });

  it("writes one row, detailing the revoked link, for a step that committed", async () => {
    const minted = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
    });
    expect(minted.status).toBe(201);
    const { links } = (await minted.json()) as { links: { linkId: string }[] };
    const linkId = links[0]?.linkId ?? "";
    expect(linkId).not.toBe("");

    const args = { formId: FORM_ID, linkId };
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: [await binding("link.revoke", args, "prod")],
      formId: FORM_ID,
    });
    const revoked = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links/${linkId}/revoke`,
      environment: "prod",
      proposal: { token, step: 0 },
    });
    expect(revoked.status).toBe(200);
    expect(await rowsFor(proposalId)).toEqual([
      { step_index: 0, kind: "link.revoke", environment: "prod", detail: linkId },
    ]);
  });

  it("writes no row for the same acts performed without a token", async () => {
    const before = await testDb.client.query<{ n: number }>(
      `select count(*)::int as n from control.agent_actions`,
    );
    const minted = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
    });
    expect(minted.status).toBe(201);
    const after = await testDb.client.query<{ n: number }>(
      `select count(*)::int as n from control.agent_actions`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

/**
 * Last, because it moves the deployment's clock forward and every fixture above shares it.
 * The seeded sessions live an hour, so the two advances here stay inside that.
 */
describe("a run bounded by step 0's confirmation, not by `exp` (criterion 10)", () => {
  const FORM_ID = "frm_prov_window";

  beforeAll(async () => {
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FormId.parse(FORM_ID),
      slug: "prov-window",
      defaultLocale: "en",
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  async function twoMintSteps(): Promise<
    readonly { kind: string; argsDigest: string; environment: string }[]
  > {
    return [
      await binding("link.mint", mintArgs(FORM_ID), "prod"),
      await binding("link.mint", { ...mintArgs(FORM_ID), count: 2 }, "prod"),
    ];
  }

  it("completes a plan whose run crosses `exp`", async () => {
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: await twoMintSteps(),
      formId: FORM_ID,
    });
    const first = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 0 },
    });
    expect(first.status).toBe(201);

    // Past `exp`, which is checked on step 0 only.
    advanceClock(9 * 60 * 1000 + 30 * 1000);
    const second = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: { ...mintBody, count: 2 },
      proposal: { token, step: 1 },
    });
    expect(second.status).toBe(201);
    expect(await countRows(proposalId)).toBe(2);
  });

  it("refuses a step sent more than ten minutes after step 0's confirmation", async () => {
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: await twoMintSteps(),
      formId: FORM_ID,
    });
    const first = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 0 },
    });
    expect(first.status).toBe(201);

    advanceClock(10 * 60 * 1000 + 1000);
    const late = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: { ...mintBody, count: 2 },
      proposal: { token, step: 1 },
    });
    expect(late.status).toBe(403);
    expect(await errorCode(late)).toBe("AGENT_PROPOSAL_WINDOW");
    expect(await countRows(proposalId)).toBe(1);
  });

  it("refuses a stale card's step 0 independently of the card", async () => {
    const { token, proposalId } = await mintToken({
      subject: owner.userId,
      steps: [await binding("link.mint", mintArgs(FORM_ID), "prod")],
      formId: FORM_ID,
    });
    advanceClock(10 * 60 * 1000 + 1000);
    const stale = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: mintBody,
      proposal: { token, step: 0 },
    });
    expect(stale.status).toBe(403);
    expect(await errorCode(stale)).toBe("AGENT_PROPOSAL_EXPIRED");
    expect(await countRows(proposalId)).toBe(0);
  });
});

describe("a mint proposed in the shape the model may produce runs end to end", () => {
  const FORM_ID = "frm_prov_mint_shape";
  const PROPOSED_EXPIRY = "2026-12-31T09:30:00.000Z";

  beforeAll(async () => {
    await createForm(testDb.db, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: FormId.parse(FORM_ID),
      slug: "prov-mint-shape",
      defaultLocale: "en",
    });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  async function proposeMint(expiresAt: string) {
    return buildProposal({
      steps: [
        { kind: "link.mint", args: { formId: FORM_ID, count: 2, expiresAt, oneTime: false } },
      ],
      subject: owner.userId,
      appKey: deps.config.keys.app,
      current: "prod",
      offered: offeredActionKinds({
        memberRole: undefined,
        grants: [{ role: "forms.approver", environments: ["all"], forms: ["all"] }],
        environments: ["prod"],
        current: "prod",
        formId: FORM_ID,
      }),
      requireSecondApprover: false,
      productionEnvironment: "prod",
      formId: FORM_ID,
      issuedAt: now,
      proposalsThisTurn: 0,
    });
  }

  it("mints and records the step for the instant the card displayed", async () => {
    const outcome = await proposeMint(PROPOSED_EXPIRY);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const minted = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: { environment: "prod", count: 2, expiresAt: PROPOSED_EXPIRY, oneTime: false },
      proposal: { token: outcome.proposal.token ?? "", step: 0 },
    });

    expect(minted.status).toBe(201);
    expect(await rowsFor(outcome.proposal.proposalId)).toEqual([
      { step_index: 0, kind: "link.mint", environment: "prod", detail: "2" },
    ]);
  });

  it("refuses the step when the expiry the request carries is not the proposed one", async () => {
    const outcome = await proposeMint(PROPOSED_EXPIRY);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const minted = await send({
      caller: owner,
      path: `/forms/${FORM_ID}/links`,
      environment: "prod",
      body: {
        environment: "prod",
        count: 2,
        expiresAt: "2026-12-31T23:59:59.999Z",
        oneTime: false,
      },
      proposal: { token: outcome.proposal.token ?? "", step: 0 },
    });

    expect(minted.status).toBe(403);
    expect(await errorCode(minted)).toBe("AGENT_PROPOSAL_ARGUMENTS");
    expect(await countRows(outcome.proposal.proposalId)).toBe(0);
  });

  it("refuses a calendar day at propose, which is the shape that would be rewritten", async () => {
    const outcome = await proposeMint("2026-12-31");
    expect(outcome.ok).toBe(false);
  });
});

describe("every D0 kind's route is the one its descriptor names", () => {
  it("matches the route policy row for each registered kind", () => {
    for (const def of Object.values(ACTION_KINDS)) {
      const policy = policyForRequest(
        def.route.method,
        def.route.path.replaceAll(/\{\w+\}/gu, "x"),
      );
      expect(policy?.path, def.kind).toBe(def.route.path);
      expect(policy?.resource, def.kind).toBe(def.cell.resource);
      expect(policy?.action, def.kind).toBe(def.cell.action);
    }
  });
});
