/**
 * Releases and promotion against a real Postgres, with a real pool per environment (task
 * 065, ADR-40).
 *
 * # Why two pools and not one handle
 *
 * `makeDeps`'s `singleDatabase` fans one handle out to the control pool and to every
 * environment, which is right for a suite that does not care where a row landed and
 * useless for this one: "released to `test` and not to `prod`" is a claim about two
 * schemas, and one handle cannot fail it. So this file builds its own `Databases` over a
 * pool per environment, each on its own `data_<env>, control` search path, exactly as
 * `schedulers/every-environment.integration.test.ts` does and for the same reason.
 *
 * # Which criteria live here
 *
 * 1 (served where it is released and nowhere else), 3 (a release never re-pins a live
 * session), 4 and 7 through the history endpoint, 5 (straight to `prod`), and 8 (exactly
 * one `form.released` row in the released environment's outbox, in the release's own
 * transaction). Criterion 8's privilege half - that the release transaction runs under
 * `qcms_app_control`'s real grants, which is what catches the `RETURNING` trap - is in
 * `apps/api/e2e/security/03-db-least-privilege.e2e.ts`; this file runs as the migration
 * credential and asserts the behaviour. Criteria 2 and the rest of 4 and 7 are asserted at
 * the query layer in `packages/db/src/queries/releases.integration.test.ts`.
 *
 * # The one substitution
 *
 * The respondent path has no `/<env>/` prefix until task 066, so until then every
 * respondent request resolves to one environment (Q53). `Databases.defaultEnvironment` is
 * on the interface so a test can substitute it, which is what the two apps below do: one
 * serves respondents from `test` and one from `prod`. Everything downstream of that choice
 * - the pool, the grants, the search path, the release read - is real, so what is
 * substituted is the choosing and nothing else.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId, QuestionId, parseQuestionDefinition } from "@roonga/qcms-core";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import type { FormDefinition } from "@roonga/qcms-core";
import {
  createForm,
  createQuestion,
  createQuestionVersion,
  getSession,
  insertFormVersion,
  publishQuestionVersion,
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
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  REQUEST_ENVIRONMENT_HEADER,
  registerRequestEnvironment,
} from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerForms } from "../forms/route.js";
import { registerStartSession } from "../responses/start-session/route.js";
import { registerReleases } from "./route.js";

const { Pool } = pg;

const LIVE_SET = ["test", "prod"] as const;
const MOUNTED = { public: true, internal: false, admin: true } as const;

let testDb: TestDb;
const executors = new Map<string, Executor>();
/** One app per respondent environment: see the module docblock's "one substitution". */
const apps = new Map<string, ReturnType<typeof createApp>>();
let control: Executor;
let internalToken: string;
let adminSessionToken: string;
let adminUserId: string;

function databasesServing(respondentEnvironment: string): Databases {
  return {
    control,
    names: [...LIVE_SET],
    defaultEnvironment: respondentEnvironment,
    for: (environment: string) => {
      const found = executors.get(environment);
      if (found === undefined) throw new Error(`no pool for environment ${environment}`);
      return found;
    },
    forRequest: (environment?: string) => {
      const chosen = environment ?? respondentEnvironment;
      return { environment: chosen, exec: executors.get(chosen)! };
    },
  };
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
  // Every control-plane table is declared schema-qualified, so any of these connections
  // resolves them; `test`'s is used so nothing here depends on `prod` being the interim
  // default.
  control = executors.get("test")!;
  const seeded = await seedAdminSession(control);
  adminSessionToken = seeded.token;
  adminUserId = seeded.userId;
  // One environment object for both apps: `validEnv()` mints a fresh synthetic secret on
  // every call, so calling it twice would give the two apps different internal tokens and
  // the channel gate would refuse whichever one this file did not keep.
  const env = validEnv();
  for (const environment of LIVE_SET) {
    const deps: Deps = makeDeps({ databases: databasesServing(environment), env });
    internalToken = internalTokenFor(deps.config);
    apps.set(
      environment,
      createApp(deps, MOUNTED, {
        groups: {
          public: [registerStartSession],
          admin: [registerAdminAuth, registerRequestEnvironment, registerForms, registerReleases],
        },
      }),
    );
  }
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

/** An admin POST on the app serving respondents from `prod` (the ordinary shape). */
async function post(
  path: string,
  body: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  return apps.get("prod")!.request(`/admin${path}`, {
    method: "POST",
    headers: adminHeaders(extra),
    body: JSON.stringify(body),
  });
}

async function get(path: string, extra: Record<string, string> = {}): Promise<Response> {
  return apps.get("prod")!.request(`/admin${path}`, { headers: adminHeaders(extra) });
}

/** Start an anonymous session on the app that serves respondents from `environment`. */
async function startSession(environment: string, slug: string): Promise<Response> {
  return apps.get(environment)!.request("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qcms-internal-token": internalToken },
    body: JSON.stringify({ formSlug: slug }),
  });
}

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

/**
 * A published question, so a draft has something to pin.
 *
 * Parsed through the kernel first, exactly as the authoring route would, so the schema
 * defaults a real published version carries are applied here too.
 */
async function seedPublishedQuestion(id: string): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition({
    questionId: id,
    type: "shortText",
    label: { en: "Field" },
  });
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(control, { questionId, slug: id.replace(/_/g, "-") });
  await createQuestionVersion(control, { questionId, definition: parsed.value });
  await publishQuestionVersion(control, { questionId, version: 1 });
}

/** A one-step form definition pinning one published question at v1. */
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

/** A form with `versions` published versions and no release anywhere. */
async function seedForm(label: string, versions = 1): Promise<{ formId: FormId; slug: string }> {
  const formId = FormId.parse(`frm_${label}`);
  const slug = `${label}-slug`;
  await createForm(control, { formId, slug, defaultLocale: "en" });
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

/** `form.released` rows for one form in one environment, counted by the owner. */
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

    // Nothing is released anywhere yet, so a published version is served nowhere. That is
    // the whole of ADR-40 in one assertion: publishing is not the act that reaches a
    // respondent.
    const beforeRelease = await startSession("test", slug);
    expect(beforeRelease.status).toBe(409);
    expect(((await beforeRelease.json()) as { error: { code: string } }).error.code).toBe(
      "NO_PUBLISHED_VERSION",
    );

    const released = await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });
    expect(released.status).toBe(200);

    const inTest = await startSession("test", slug);
    expect(inTest.status).toBe(201);
    expect(((await inTest.json()) as { formVersion: number }).formVersion).toBe(1);

    // And `prod`, where nothing was released, still refuses - on the same slug, the same
    // form and the same published version.
    const inProd = await startSession("prod", slug);
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

    // Both environments now serve the same version, from one stored copy of it.
    expect((await startSession("prod", slug)).status).toBe(201);
  });

  it("records a release straight to `prod` with no prior release anywhere (criterion 5)", async () => {
    const { formId } = await seedForm("hotfixed", 1);
    const res = await post(`/forms/${formId}/releases`, { environment: "prod", version: 1 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { release: { fromEnvironment: string | null } };
    expect(body.release.fromEnvironment).toBeNull();
  });
});

describe("a release never re-pins a live session (criterion 3, ADR-07 invariant I4)", () => {
  it("leaves an open session on the version it started, and pins the next one to the new version", async () => {
    const { formId, slug } = await seedForm("pinned", 2);
    await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });

    const started = await startSession("test", slug);
    expect(started.status).toBe(201);
    const session = (await started.json()) as {
      sessionId: string;
      sessionToken: string;
      formVersion: number;
    };
    expect(session.formVersion).toBe(1);

    // The release happens with that session open.
    const second = await post(`/forms/${formId}/releases`, { environment: "test", version: 2 });
    expect(second.status).toBe(200);

    // What the respondent is served is unchanged, read back through the respondent's own
    // credential rather than inferred from the row.
    const status = await apps.get("test")!.request(`/sessions/${session.sessionId}`, {
      headers: {
        "x-qcms-internal-token": internalToken,
        authorization: `Bearer ${session.sessionToken}`,
      },
    });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { formVersion: number }).formVersion).toBe(1);

    // And the row behind it, because a re-pin would be a write nothing else would show.
    const row = await getSession(executors.get("test")!, session.sessionId as never);
    expect(row?.formVersion).toBe(1);

    // A session started after the release gets the new version, which is what makes the
    // assertion above about the pin rather than about the release having failed.
    const next = await startSession("test", slug);
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
    // The outbox is per environment, so an event about a `test` release has no business in
    // `prod`'s queue - which is also why publishing, being environment-agnostic, queues
    // nothing at all (Q60).
    expect(await releasedEvents("prod", formId)).toBe(0);
  });

  it("carries the form, the version, the environment and who released it", async () => {
    const { formId } = await seedForm("payload", 1);
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
    // No respondent content, which is why this event type is the one retention uses as its
    // example of a payload that never carries answers.
    expect(res.rows[0]?.payload).not.toHaveProperty("answers");
  });

  it("writes neither the record nor the event when the release is refused", async () => {
    const { formId } = await seedForm("refused", 1);
    // Version 2 does not exist, so the release is refused before any transaction opens.
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
      expect(
        (await post(`/forms/${formId}/releases`, { environment: "prod", version })).status,
      ).toBe(200);
    }
    // The incident: 7 is bad, so 4 goes back out. A third row, not an edit.
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
    // Append-only: three rows, newest first, every prior row still there (criterion 7).
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
    // The schema accepts the name's shape; the live set is what refuses it.
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
    // One row, not two: a double-pressed button leaves the history legible.
    expect(await releasedEvents("test", formId)).toBe(1);
  });

  it("refuses a release of a version of another form", async () => {
    const { formId } = await seedForm("otherform", 1);
    await seedForm("otherformsource", 3);
    // Version 3 exists, but not for this form.
    const res = await post(`/forms/${formId}/releases`, { environment: "test", version: 3 });
    expect(res.status).toBe(404);
  });

  it("refuses an unknown form", async () => {
    const res = await post(`/forms/frm_nosuchform/releases`, { environment: "test", version: 1 });
    expect(res.status).toBe(404);
  });
});

describe("the switcher's environment steers an admin read (Q6)", () => {
  it("reads the environment the header names rather than the interim default", async () => {
    const { formId } = await seedForm("switched", 2);
    await post(`/forms/${formId}/releases`, { environment: "test", version: 1 });
    await post(`/forms/${formId}/releases`, { environment: "prod", version: 2 });

    // The release reads here are control-plane and take their environment from the query,
    // so what the header steers is every per-environment admin read behind it. The
    // observable proof that the middleware ran at all is its refusal.
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
    // `position` order, which is the order a combined environment set is written in (Q42),
    // so the switcher shows one ordering and the authorisation model uses the same one.
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
    await createForm(control, { formId, slug: "combined-slug", defaultLocale: "en" });
    const draft = await apps.get("prod")!.request(`/admin/forms/${formId}/draft`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ definition: draftDefinition(formId, "q_combined") }),
    });
    expect(draft.status).toBe(200);

    const res = await post(`/forms/${formId}/publish-and-release`, { environment: "test" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: number; environment: string };
    expect(body).toMatchObject({ version: 1, environment: "test" });

    // One act: the version exists, the release exists, and the event is in the released
    // environment's outbox. A combined action that published without releasing would leave
    // the first two and not the third.
    expect(await releasedEvents("test", formId)).toBe(1);
    const history = await get(`/forms/${formId}/releases`);
    expect(((await history.json()) as { releases: unknown[] }).releases).toHaveLength(1);
    expect((await startSession("test", "combined-slug")).status).toBe(201);
  });

  it("publishes nothing when the release half cannot be written", async () => {
    const formId = FormId.parse("frm_combinedrefused");
    await seedPublishedQuestion("q_combinedrefused");
    await createForm(control, { formId, slug: "refused-slug", defaultLocale: "en" });
    await apps.get("prod")!.request(`/admin/forms/${formId}/draft`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ definition: draftDefinition(formId, "q_combinedrefused") }),
    });

    const res = await post(`/forms/${formId}/publish-and-release`, { environment: "staging" });
    expect(res.status).toBe(400);

    // Atomically or not at all: no version, and the draft is still open, so the author's
    // work is where they left it.
    const detail = await get(`/forms/${formId}`);
    const form = (await detail.json()) as { versions: unknown[]; draft: unknown };
    expect(form.versions).toEqual([]);
    expect(form.draft).not.toBeNull();
  });
});
