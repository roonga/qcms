import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  FormId,
  LinkId,
  QuestionId,
  importCompactTokenKey,
  mintSecureLink,
  parseQuestionDefinition,
} from "@roonga/qcms-core";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import type { FormDefinition } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createForm,
  createQuestion,
  createQuestionVersion,
  getReleasedVersion,
  getSession,
  insertFormVersion,
  insertFormRelease,
  insertSecureLink,
  listFormVersions,
  publishQuestionVersion,
  setRequireSecondApprover,
  schema,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  searchPathOptions,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";

import { createApp } from "../../app.js";
import type { Databases } from "../../environments.js";
import type { Deps } from "../../deps.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  REQUEST_ENVIRONMENT_HEADER,
  registerRequestEnvironment,
} from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerForms } from "../forms/route.js";
import {
  registerAnonymousEntry,
  registerLinkEntry,
  registerSessionStatus,
} from "../responses/start-session/route.js";
import { registerReleases } from "./route.js";

const { Pool } = pg;

const LIVE_SET = ["test", "prod"] as const;
/** `environments` is the non-prod set: `prod` is the unprefixed `public` mount. */
const MOUNTED = {
  public: true,
  internal: false,
  admin: true,
  environments: ["test"],
} as const;

let testDb: TestDb;
const executors = new Map<string, Executor>();
let app: ReturnType<typeof createApp>;
let control: Executor;
let internalToken: string;
let linkKey: CryptoKey;
let adminSessionToken: string;
let adminUserId: string;

function databases(): Databases {
  return {
    control,
    names: [...LIVE_SET],
    defaultEnvironment: "prod",
    for: (environment: string) => {
      const found = executors.get(environment);
      if (found === undefined) throw new Error(`no pool for environment ${environment}`);
      return found;
    },
    forRequest: (environment?: string) => {
      const chosen = environment ?? "prod";
      return { environment: chosen, exec: executors.get(chosen)! };
    },
  };
}

function prefixOf(environment: string): string {
  return environment === "prod" ? "" : `/${environment}`;
}

beforeAll(async () => {
  testDb = await startTestDb();
  for (const environment of LIVE_SET) {
    const pool = testDb.register(
      new Pool({ connectionString: testDb.connectionUri, options: searchPathOptions(environment) }),
      `${environment} pool`,
    );
    executors.set(environment, drizzle(pool, { schema }));
  }
  // Control-plane tables are schema-qualified, so any of these connections resolves them.
  control = executors.get("test")!;
  const seeded = await seedAdminSession(control);
  adminSessionToken = seeded.token;
  adminUserId = seeded.userId;
  const deps: Deps = makeDeps({ databases: databases(), env: validEnv() });
  internalToken = internalTokenFor(deps.config);
  linkKey = await importCompactTokenKey(new TextEncoder().encode(deps.config.keys.link[0]));
  app = createApp(deps, MOUNTED, {
    groups: {
      anonymous: [registerAnonymousEntry],
      respondent: [registerLinkEntry, registerSessionStatus],
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerForms,
        registerReleases,
      ],
    },
  });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
    ...extra,
  };
}

async function post(
  path: string,
  body: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  return app.request(`/admin${path}`, {
    method: "POST",
    headers: adminHeaders(extra),
    body: JSON.stringify(body),
  });
}

async function get(path: string, extra: Record<string, string> = {}): Promise<Response> {
  return app.request(`/admin${path}`, { headers: adminHeaders(extra) });
}

/** Anonymous entry exists on `prod`'s surface alone (SEC-14). */
async function startAnonymous(slug: string): Promise<Response> {
  return app.request("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
    body: JSON.stringify({ formSlug: slug }),
  });
}

let mintedLinks = 0;

async function startIn(environment: string, formId: FormId): Promise<Response> {
  mintedLinks += 1;
  const linkId = LinkId.parse(`lnk_rel${String(mintedLinks)}`);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await insertSecureLink(control, { linkId, formId, environment, expiresAt, oneTime: false });
  const token = await mintSecureLink(
    { formId, linkId, expiresAt: expiresAt.toISOString(), oneTime: false },
    linkKey,
  );
  return app.request(`${prefixOf(environment)}/sessions/link`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
    body: JSON.stringify({ token }),
  });
}

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

async function seedPublishedQuestion(id: string): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition({
    questionId: id,
    type: "shortText",
    label: { en: "Field" },
  });
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(control, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: id.replace(/_/g, "-"),
  });
  await createQuestionVersion(control, { questionId, definition: parsed.value });
  await publishQuestionVersion(control, { questionId, version: 1 });
}

function draftDefinition(formId: string, questionId: string): Record<string, unknown> {
  return {
    formId,
    defaultLocale: "en",
    title: { en: "A form" },
    steps: [
      {
        stepId: "stp_one",
        title: { en: "One" },
        items: [{ questionId, version: 1 }],
      },
    ],
    rules: [],
  };
}

async function seedForm(label: string, versions = 1): Promise<{ formId: FormId; slug: string }> {
  const formId = FormId.parse(`frm_${label}`);
  const slug = `${label}-slug`;
  await createForm(control, { workspaceId: SEED_WORKSPACE_ID, formId, slug, defaultLocale: "en" });
  for (let i = 0; i < versions; i += 1) {
    await insertFormVersion(control, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1",
    });
  }
  return { formId, slug };
}

async function releasedEvents(environment: string, formId: FormId): Promise<number> {
  const res = await testDb.client.query<{ n: string }>(
    `select count(*) as n from data_${environment}.outbox
      where event_type = 'form.released' and payload->>'formId' = $1`,
    [formId],
  );
  return Number(res.rows[0]?.n ?? "-1");
}

describe("release resolution replaces the newest published version (criterion 1)", () => {
  it("serves a version in the environment it is released to, and refuses it elsewhere", async () => {
    const { formId, slug } = await seedForm("servedhere", 1);

    const beforeRelease = await startIn("test", formId);
    expect(beforeRelease.status).toBe(409);
    expect(((await beforeRelease.json()) as { error: { code: string } }).error.code).toBe(
      "NO_PUBLISHED_VERSION",
    );

    const released = await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });
    expect(released.status).toBe(200);

    const inTest = await startIn("test", formId);
    expect(inTest.status).toBe(201);
    expect(((await inTest.json()) as { formVersion: number }).formVersion).toBe(1);

    const inProd = await startAnonymous(slug);
    expect(inProd.status).toBe(409);
  });

  it("promotes by writing a row, leaving the form id and the version number alone (criterion 2)", async () => {
    const { formId, slug } = await seedForm("promoted", 1);
    await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });
    const promoted = await post(`/forms/${formId}/releases`, {
      environment: "prod",
      version: 1,
      fromEnvironment: "test",
    });

    expect(promoted.status).toBe(200);
    const body = (await promoted.json()) as {
      release: { formId: string; version: number; fromEnvironment: string | null };
    };
    expect(body.release.formId).toBe(formId);
    expect(body.release.version).toBe(1);
    expect(body.release.fromEnvironment).toBe("test");

    expect((await startAnonymous(slug)).status).toBe(201);
  });

  it("refuses a production version with no test or legacy prod release history", async () => {
    const { formId } = await seedForm("hotfixed", 1);
    const res = await post(`/forms/${formId}/releases`, { environment: "prod", version: 1 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "TEST_RELEASE_REQUIRED",
    );
    expect(await getReleasedVersion(control, formId, "prod")).toBeUndefined();
    expect(await releasedEvents("prod", formId)).toBe(0);
  });
});

describe("test-to-production eligibility", () => {
  it("keeps an older tested version eligible after test has moved forward", async () => {
    const { formId } = await seedForm("testedhistory", 2);
    await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });
    await post(`/forms/${formId}/releases`, { environment: "test", version: 2 });
    expect(
      (await post(`/forms/${formId}/releases`, { environment: "prod", version: 1 })).status,
    ).toBe(200);
    expect((await getReleasedVersion(control, formId, "prod"))?.version).toBe(1);
  });

  it("keeps a legacy production version eligible for rollback", async () => {
    const { formId } = await seedForm("legacyrollback", 2);
    await insertFormRelease(control, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: adminUserId,
    });
    await post(`/forms/${formId}/releases`, { environment: "test", version: 2 });
    expect(
      (await post(`/forms/${formId}/releases`, { environment: "prod", version: 2 })).status,
    ).toBe(200);
    const rollback = await post(`/forms/${formId}/releases`, { environment: "prod", version: 1 });
    expect(rollback.status).toBe(200);
    expect(((await rollback.json()) as { release: { rollback: boolean } }).release.rollback).toBe(
      true,
    );
  });

  it("refuses direct draft publication to prod without consuming the draft", async () => {
    const formId = FormId.parse("frm_no_direct_prod");
    await seedPublishedQuestion("q_no_direct_prod");
    await createForm(control, {
      workspaceId: SEED_WORKSPACE_ID,
      formId,
      slug: "no-direct-prod",
      defaultLocale: "en",
    });
    await app.request(`/admin/forms/${formId}/draft`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ definition: draftDefinition(formId, "q_no_direct_prod") }),
    });
    const response = await post(`/forms/${formId}/publish-and-release`, { environment: "prod" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "TEST_RELEASE_REQUIRED",
    );
    expect(await listFormVersions(control, formId)).toHaveLength(0);
    const form = (await (await get(`/forms/${formId}`)).json()) as {
      draft: unknown;
      workflow: { canPublish: boolean };
    };
    expect(form.draft).not.toBeNull();
    expect(form.workflow.canPublish).toBe(false);
    expect(await releasedEvents("prod", formId)).toBe(0);
  });
});

describe("a release never re-pins a live session (criterion 3, ADR-07 invariant I4)", () => {
  it("leaves an open session on the version it started, and pins the next one to the new version", async () => {
    const { formId } = await seedForm("pinned", 2);
    await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });

    const started = await startIn("test", formId);
    expect(started.status).toBe(201);
    const session = (await started.json()) as {
      sessionId: string;
      sessionToken: string;
      formVersion: number;
    };
    expect(session.formVersion).toBe(1);

    const second = await post(`/forms/${formId}/releases`, { environment: "test", version: 2 });
    expect(second.status).toBe(200);

    const status = await app.request(`/test/sessions/${session.sessionId}`, {
      headers: {
        "x-qcms-internal-token": internalToken,
        authorization: `Bearer ${session.sessionToken}`,
      },
    });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { formVersion: number }).formVersion).toBe(1);

    const row = await getSession(executors.get("test")!, session.sessionId as never);
    expect(row?.formVersion).toBe(1);

    const next = await startIn("test", formId);
    expect(((await next.json()) as { formVersion: number }).formVersion).toBe(2);
  });
});

describe("the release writes exactly one event, in its own transaction (criterion 8, Q49)", () => {
  it("queues `form.released` in the released environment's outbox and nowhere else", async () => {
    const { formId } = await seedForm("queued", 1);
    expect(await releasedEvents("test", formId)).toBe(0);
    expect(await releasedEvents("prod", formId)).toBe(0);

    await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });

    expect(await releasedEvents("test", formId)).toBe(1);
    expect(await releasedEvents("prod", formId)).toBe(0);
  });

  it("carries the form, the version, the environment and who released it", async () => {
    const { formId } = await seedForm("payload", 1);
    await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });
    await post(`/forms/${formId}/releases`, { environment: "prod", version: 1 });

    const res = await testDb.client.query<{ payload: Record<string, unknown> }>(
      `select payload from data_prod.outbox
        where event_type = 'form.released' and payload->>'formId' = $1`,
      [formId],
    );
    expect(res.rows[0]?.payload).toMatchObject({
      formId,
      version: 1,
      environment: "prod",
      releasedBy: adminUserId,
    });
    expect(res.rows[0]?.payload).not.toHaveProperty("answers");
  });

  it("writes neither the record nor the event when the release is refused", async () => {
    const { formId } = await seedForm("refused", 1);
    const res = await post(`/forms/${formId}/releases`, { environment: "test", version: 2 });
    expect(res.status).toBe(404);
    expect(await releasedEvents("test", formId)).toBe(0);
    const history = await get(`/forms/${formId}/releases`);
    expect(((await history.json()) as { releases: unknown[] }).releases).toEqual([]);
  });
});

describe("the release history (criteria 4 and 7)", () => {
  it("answers who released what, when and from where, and marks a rollback", async () => {
    const { formId } = await seedForm("history", 7);
    for (const version of [4, 7]) {
      await post(`/forms/${formId}/releases`, { environment: "test", version });
      expect(
        (await post(`/forms/${formId}/releases`, { environment: "prod", version })).status,
      ).toBe(200);
    }
    const rolledBack = await post(`/forms/${formId}/releases`, { environment: "prod", version: 4 });
    expect(rolledBack.status).toBe(200);
    expect(((await rolledBack.json()) as { release: { rollback: boolean } }).release.rollback).toBe(
      true,
    );

    const history = await get(`/forms/${formId}/releases?environment=prod`);
    const body = (await history.json()) as {
      releases: Array<{
        version: number;
        rollback: boolean;
        releasedBy: string;
        releasedAt: string;
      }>;
    };
    expect(body.releases.map((row) => [row.version, row.rollback])).toEqual([
      [4, true],
      [7, false],
      [4, false],
    ]);
    expect(body.releases[0]?.releasedBy).toBe(adminUserId);
    expect(Date.parse(body.releases[0]?.releasedAt ?? "")).not.toBeNaN();
  });
});

describe("refusals", () => {
  it("refuses a release into an environment this deployment does not serve", async () => {
    const { formId } = await seedForm("unknownenv", 1);
    const res = await post(`/forms/${formId}/releases`, { environment: "staging", version: 1 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "UNKNOWN_ENVIRONMENT",
    );
  });

  it("refuses a promotion whose source is the environment it releases to", async () => {
    const { formId } = await seedForm("selfsource", 1);
    const res = await post(`/forms/${formId}/releases`, {
      environment: "test",
      version: 1,
      fromEnvironment: "test",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_SOURCE_ENVIRONMENT",
    );
  });

  it("refuses a release of the version already released there, rather than recording no change", async () => {
    const { formId } = await seedForm("already", 1);
    expect(
      (await post(`/forms/${formId}/releases`, { environment: "test", version: 1 })).status,
    ).toBe(200);
    const again = await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "ALREADY_RELEASED",
    );
    expect(await releasedEvents("test", formId)).toBe(1);
  });

  it("refuses a release of a version of another form", async () => {
    const { formId } = await seedForm("otherform", 1);
    await seedForm("otherformsource", 3);
    const res = await post(`/forms/${formId}/releases`, { environment: "test", version: 3 });
    expect(res.status).toBe(404);
  });

  it("refuses an unknown form", async () => {
    const res = await post(`/forms/frm_nosuchform/releases`, { environment: "test", version: 1 });
    expect(res.status).toBe(404);
  });

  it("refuses the losers of a concurrent release with a typed 409, never a 5xx", async () => {
    const { formId } = await seedForm("raced", 6);
    const versions = [1, 2, 3, 4, 5, 6];

    const results = await Promise.all(
      versions.map(async (version) => {
        const res = await post(`/forms/${formId}/releases`, { environment: "test", version });
        const body = (await res.json()) as { error?: { code: string } };
        return { status: res.status, code: body.error?.code };
      }),
    );

    const won = results.filter((r) => r.status === 200);
    const lost = results.filter((r) => r.status !== 200);
    expect(won.length).toBeGreaterThanOrEqual(1);
    expect(won.length + lost.length).toBe(versions.length);
    expect(lost.map((r) => [r.status, r.code])).toEqual(lost.map(() => [409, "RELEASE_RACED"]));
    expect(results.some((r) => r.status >= 500)).toBe(false);

    const rows = await testDb.client.query<{ sequence: string; version: string }>(
      `select sequence, version from control.form_releases
        where form_id = $1 and environment = 'test' order by sequence`,
      [formId],
    );
    const sequences = rows.rows.map((row) => Number(row.sequence));
    expect(sequences).toEqual(won.map((_, index) => index + 1));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(await releasedEvents("test", formId)).toBe(won.length);
  });

  it("turns the key violation of a lost race into the 409, with the race held open", async () => {
    const { formId } = await seedForm("racedheld", 2);

    await testDb.client.query("begin");
    try {
      // Uncommitted, so it is invisible to the request below while holding the index entry.
      await testDb.client.query(
        `insert into control.form_releases (form_id, environment, version, sequence, released_by)
         values ($1, 'test', 1, 1, 'usr_blocker')`,
        [formId],
      );

      const racing = post(`/forms/${formId}/releases`, { environment: "test", version: 2 });

      // Waiting on `pg_locks` rather than sleeping: the request has to be at the lock
      // before the commit, or it would read the committed row and take sequence 2.
      const deadline = Date.now() + 10_000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const waiting = await testDb.client.query<{ n: string }>(
          "select count(*) as n from pg_locks where not granted",
        );
        blocked = Number(waiting.rows[0]?.n ?? "0") > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);

      await testDb.client.query("commit");

      const res = await racing;
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RELEASE_RACED");
    } finally {
      await testDb.client.query("rollback").catch(() => undefined);
    }

    const rows = await testDb.client.query<{ n: string }>(
      "select count(*) as n from control.form_releases where form_id = $1",
      [formId],
    );
    expect(Number(rows.rows[0]?.n)).toBe(1);
    expect(await releasedEvents("test", formId)).toBe(0);
  });
});

describe("the switcher's environment steers an admin read (Q6)", () => {
  it("reads the environment the header names rather than the interim default", async () => {
    const { formId } = await seedForm("switched", 2);
    await post(`/forms/${formId}/releases`, { environment: "test", version: 2 });
    await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });
    await post(`/forms/${formId}/releases`, { environment: "prod", version: 2 });

    const refused = await get(`/forms/${formId}/releases`, {
      [REQUEST_ENVIRONMENT_HEADER]: "staging",
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "UNKNOWN_ENVIRONMENT",
    );

    const accepted = await get(`/forms/${formId}/releases?environment=test`, {
      [REQUEST_ENVIRONMENT_HEADER]: "test",
    });
    expect(accepted.status).toBe(200);
  });

  it("offers the live environment set in canonical order", async () => {
    const res = await get("/environments");
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({
      environments: [
        { name: "test", position: 1 },
        { name: "prod", position: 2 },
      ],
    });
  });
});

describe("publish and release in one act (finding 2's combined action)", () => {
  it("publishes a version and releases it, atomically", async () => {
    const formId = FormId.parse("frm_combined");
    await seedPublishedQuestion("q_combined");
    await createForm(control, {
      workspaceId: SEED_WORKSPACE_ID,
      formId,
      slug: "combined-slug",
      defaultLocale: "en",
    });
    const draft = await app.request(`/admin/forms/${formId}/draft`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ definition: draftDefinition(formId, "q_combined") }),
    });
    expect(draft.status).toBe(200);

    const res = await post(`/forms/${formId}/publish-and-release`, { environment: "test" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; environment: string };
    expect(body).toMatchObject({ version: 1, environment: "test" });

    expect(await releasedEvents("test", formId)).toBe(1);
    const history = await get(`/forms/${formId}/releases`);
    expect(((await history.json()) as { releases: unknown[] }).releases).toHaveLength(1);
    expect((await startIn("test", formId)).status).toBe(201);
  });

  it("publishes nothing when the release half cannot be written", async () => {
    const formId = FormId.parse("frm_combinedrefused");
    await seedPublishedQuestion("q_combinedrefused");
    await createForm(control, {
      workspaceId: SEED_WORKSPACE_ID,
      formId,
      slug: "combined-refused-slug",
      defaultLocale: "en",
    });
    await app.request(`/admin/forms/${formId}/draft`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ definition: draftDefinition(formId, "q_combinedrefused") }),
    });

    const res = await post(`/forms/${formId}/publish-and-release`, { environment: "staging" });
    expect(res.status).toBe(400);

    const detail = await get(`/forms/${formId}`);
    const form = (await detail.json()) as { versions: unknown[]; draft: unknown };
    expect(form.versions).toEqual([]);
    expect(form.draft).not.toBeNull();
  });
});

describe("the two-person rule for a prod release (task 070, Q13, Q30, Q51)", () => {
  const RULE_FORM = FormId.parse("frm_two_person_rel");

  beforeAll(async () => {
    await createForm(control, {
      workspaceId: SEED_WORKSPACE_ID,
      formId: RULE_FORM,
      slug: "two-person-release",
      defaultLocale: "en",
    });
    for (const publishedBy of [adminUserId, "au_somebody_else"]) {
      await insertFormVersion(control, {
        formId: RULE_FORM,
        definition: emptyDef,
        compiled: emptyCompiled,
        compilerVersion: "0.1.0",
        a2uiSpecVersion: "0.1.0",
        semanticsVersion: "1",
        publishedBy,
      });
    }
  });

  afterAll(async () => {
    await setRequireSecondApprover(control, SEED_WORKSPACE_ID, false);
  });

  it("records no approval and compares nothing with the switch off (criterion 3)", async () => {
    await post(`/forms/${RULE_FORM}/releases`, { environment: "test", version: 1 });
    await setRequireSecondApprover(control, SEED_WORKSPACE_ID, false);
    const res = await post(`/forms/${RULE_FORM}/releases`, { environment: "prod", version: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { release: { approvedBy: string | null } };
    expect(body.release.approvedBy).toBeNull();
  });

  it("refuses the publishing account and records the approver otherwise (criteria 1, 2)", async () => {
    await setRequireSecondApprover(control, SEED_WORKSPACE_ID, true);

    const refused = await post(`/forms/${RULE_FORM}/releases`, { environment: "prod", version: 1 });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "APPROVER_IS_AUTHOR",
    );

    await post(`/forms/${RULE_FORM}/releases`, { environment: "test", version: 2 });
    const allowed = await post(`/forms/${RULE_FORM}/releases`, { environment: "prod", version: 2 });
    expect(allowed.status).toBe(200);
    expect(
      ((await allowed.json()) as { release: { approvedBy: string | null } }).release.approvedBy,
    ).toBe(adminUserId);

    const stored = await getReleasedVersion(control, RULE_FORM, "prod");
    expect(stored?.approvedBy).toBe(adminUserId);
  });

  it("leaves a non-prod release alone with the switch on (criterion 4)", async () => {
    await setRequireSecondApprover(control, SEED_WORKSPACE_ID, true);
    const res = await post(`/forms/${RULE_FORM}/releases`, { environment: "test", version: 1 });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { release: { approvedBy: string | null } }).release.approvedBy,
    ).toBeNull();
  });

  it("refuses publish-and-release into prod outright with the switch on (Q51)", async () => {
    await setRequireSecondApprover(control, SEED_WORKSPACE_ID, true);
    const before = await getReleasedVersion(control, RULE_FORM, "prod");
    const res = await post(`/forms/${RULE_FORM}/publish-and-release`, { environment: "prod" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "APPROVER_IS_AUTHOR",
    );
    const after = await getReleasedVersion(control, RULE_FORM, "prod");
    expect(after?.version).toBe(before?.version);
    const versions = await listFormVersions(control, RULE_FORM);
    expect(versions).toHaveLength(2);
  });
});
