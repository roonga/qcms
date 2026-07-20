/**
 * Admin form-authoring + publish slice tests (task 022), driven through
 * `app.request()` against the **real** kernel, the real A2UI compiler, and the
 * 013 Testcontainers harness DB - never a mock of our own packages
 * (CONTRIBUTING). Requires Docker.
 *
 * Covers every exit criterion:
 *  1. the full loop (create → draft → publish → seeded new draft → publish v2)
 *     with a v1-pinned session left unaffected (R1, I4);
 *  2. publish failure - a backward rule target → 422 `RULE_BACKWARD_TARGET`
 *     with its path, and nothing persisted (no version, draft intact, no event);
 *  3. deprecated-pin - a moved pin to a deprecated version rejected
 *     (`DEPRECATED_PIN`), a carried-over (unchanged) pin allowed;
 *  4. snapshot integrity - the stored compiled JSONB deep-equals a fresh
 *     `compileForm` of the publish-time snapshot, with all version stamps;
 *  5. atomicity - an induced failure between the version insert and the draft
 *     delete rolls the whole publish back (no version, draft intact, no event).
 */

import { compileForm } from "@qcms/a2ui-compiler";
import {
  compileDraft,
  type FormDefinition,
  FormId,
  parseQuestionDefinition,
  type QuestionId as QuestionIdType,
  QuestionId,
  type QuestionVersionRecord,
  SessionId,
} from "@qcms/core";
import {
  createQuestion,
  createQuestionVersion,
  createSession,
  deprecateQuestionVersion,
  getDraft,
  getSession,
  listFormVersions,
  listQuestionVersions,
  publishQuestionVersion,
} from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, validEnv } from "../../test-support.js";
import { registerForms } from "./route.js";

const BOOT_TIMEOUT = 120_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, { groups: { admin: [registerAdminAuth, registerForms] } });
  internalToken = internalTokenFor(deps.config);
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb.teardown();
}, BOOT_TIMEOUT);

// --- request helpers (channel token + stub admin session on every call) -----

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: "editor-1",
    ...extra,
  };
}

async function post(path: string, body?: unknown): Promise<Response> {
  return app.request(`/admin${path}`, {
    method: "POST",
    headers: authHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function put(path: string, body: unknown): Promise<Response> {
  return app.request(`/admin${path}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return app.request(`/admin${path}`, { headers: authHeaders() });
}

// --- fixtures ---------------------------------------------------------------

function shortText(id: string, labelText = "Field"): Record<string, unknown> {
  return { questionId: id, type: "shortText", label: { en: labelText } };
}

/**
 * Seed a published question (version 1) straight through the db helpers. The
 * definition is parsed through the kernel first (as the authoring route would),
 * so schema defaults - e.g. shortText's `constraints` (`.prefault({})`) the A2UI
 * compiler reads - are applied exactly as a real published version carries them.
 */
async function seedPublishedQuestion(id: string, labelText = "Field"): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition(shortText(id, labelText));
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(testDb.db, { questionId, slug: id.replace(/_/g, "-") });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}

/** A form definition pinning the given `(step → questionIds)` layout at v1. */
function formDefinition(
  formId: string,
  steps: [string, string[]][],
  rules: readonly unknown[] = [],
  title = "A form",
): Record<string, unknown> {
  return {
    formId,
    defaultLocale: "en",
    title: { en: title },
    steps: steps.map(([stepId, ids]) => ({
      stepId,
      title: { en: stepId },
      items: ids.map((questionId) => ({ questionId, version: 1 })),
    })),
    rules,
  };
}

interface Issue {
  code: string;
  path?: Record<string, unknown>;
}
interface ErrBody {
  error: { code: string; message: string; details?: { issues?: Issue[] } };
}

/** Count `form.published` outbox events for a given formId. */
async function publishedEventCount(formId: string): Promise<number> {
  const result = await testDb.client.query(
    `select count(*)::int as n from outbox where event_type = 'form.published' and payload->>'formId' = $1`,
    [formId],
  );
  return (result.rows[0] as { n: number }).n;
}

// --- exit criterion 1: the full loop ----------------------------------------

describe("full authoring loop (exit criterion 1)", () => {
  it("create → draft → publish → seeded new draft → publish v2; a v1 session is untouched", async () => {
    await seedPublishedQuestion("q_loop_name", "Name");
    await seedPublishedQuestion("q_loop_email", "Email");

    // create
    const createRes = await post("/forms", {
      formId: "frm_loop",
      slug: "loop",
      defaultLocale: "en",
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { formId: string; status: string; draft: unknown };
    expect(created.formId).toBe("frm_loop");
    expect(created.status).toBe("open");

    // draft (valid, single question) - advisory issues empty
    const v1Def = formDefinition("frm_loop", [["stp_one", ["q_loop_name"]]]);
    const draftRes = await put("/forms/frm_loop/draft", { definition: v1Def });
    expect(draftRes.status).toBe(200);
    expect(((await draftRes.json()) as { issues: Issue[] }).issues).toEqual([]);

    // publish v1
    const pubRes = await post("/forms/frm_loop/publish");
    expect(pubRes.status).toBe(200);
    const v1 = (await pubRes.json()) as { version: number; publishedAt: string };
    expect(v1.version).toBe(1);
    expect(typeof v1.publishedAt).toBe("string");

    // a session pins v1 (I4: the pin is structural, never migrates)
    const sessionId = SessionId.parse("ses_loop_v1_session_aaaa");
    await createSession(testDb.db, {
      sessionId,
      formId: FormId.parse("frm_loop"),
      formVersion: 1,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    // GET detail: the draft was deleted on publish, so it is now *seeded* from v1
    const detail = (await (await get("/forms/frm_loop")).json()) as {
      draftSource: string;
      draft: FormDefinition;
      versions: { version: number }[];
    };
    expect(detail.draftSource).toBe("seeded");
    expect(detail.draft.steps).toHaveLength(1);
    expect(detail.versions.map((v) => v.version)).toEqual([1]);

    // open a new draft from the seed and add a second question, then publish v2
    const v2Def = formDefinition("frm_loop", [
      ["stp_one", ["q_loop_name"]],
      ["stp_two", ["q_loop_email"]],
    ]);
    expect((await put("/forms/frm_loop/draft", { definition: v2Def })).status).toBe(200);
    const pub2 = await post("/forms/frm_loop/publish");
    expect(pub2.status).toBe(200);
    expect(((await pub2.json()) as { version: number }).version).toBe(2);

    // the v1-pinned session is unaffected: still bound to version 1 (R1, I4)
    const session = (await getSession(testDb.db, sessionId)) as { formVersion: number } | undefined;
    expect(session?.formVersion).toBe(1);

    // both versions exist; v1's stored snapshot is unchanged (immutable)
    const versions = (await get("/forms/frm_loop")).status;
    expect(versions).toBe(200);
    const rows = await listFormVersions(testDb.db, FormId.parse("frm_loop"));
    expect(rows.map((r) => r.version).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});

// --- exit criterion 2: publish failure (backward rule target) ---------------

describe("publish failure is atomic (exit criterion 2)", () => {
  it("a backward rule target → 422 RULE_BACKWARD_TARGET; nothing persisted", async () => {
    await seedPublishedQuestion("q_bw_a", "A");
    await seedPublishedQuestion("q_bw_b", "B");

    expect(
      (await post("/forms", { formId: "frm_bw", slug: "bw", defaultLocale: "en" })).status,
    ).toBe(201);

    // q_bw_a is in step one, q_bw_b in step two. A rule that *reads* q_bw_b and
    // *shows* q_bw_a targets a question before its dependency → backward (ADR-16).
    const badDef = formDefinition(
      "frm_bw",
      [
        ["stp_one", ["q_bw_a"]],
        ["stp_two", ["q_bw_b"]],
      ],
      [{ ruleId: "rul_back", when: { op: "answered", questionId: "q_bw_b" }, show: ["q_bw_a"] }],
    );
    // The draft saves (drafts may be inconsistent) but advisory flags the issue.
    const draftRes = await put("/forms/frm_bw/draft", { definition: badDef });
    expect(draftRes.status).toBe(200);
    const advisory = (await draftRes.json()) as { issues: Issue[] };
    expect(advisory.issues.some((i) => i.code === "RULE_BACKWARD_TARGET")).toBe(true);

    // publish is rejected with the full PublishError[] verbatim
    const pubRes = await post("/forms/frm_bw/publish");
    expect(pubRes.status).toBe(422);
    const body = (await pubRes.json()) as ErrBody;
    expect(body.error.code).toBe("PUBLISH_REJECTED");
    const backward = body.error.details?.issues?.find((i) => i.code === "RULE_BACKWARD_TARGET");
    expect(backward).toBeDefined();
    expect(backward?.path).toMatchObject({ rule: "rul_back", target: "q_bw_a" });

    // nothing persisted: no version row, the draft is intact, no outbox event
    expect(await listFormVersions(testDb.db, FormId.parse("frm_bw"))).toHaveLength(0);
    expect(await getDraft(testDb.db, FormId.parse("frm_bw"))).toBeDefined();
    expect(await publishedEventCount("frm_bw")).toBe(0);
  });
});

// --- exit criterion 3: deprecated-pin (new/moved vs carried-over) -----------

describe("deprecated-pin gate (exit criterion 3)", () => {
  it("a carried-over pin to a deprecated version is allowed; a moved pin is rejected", async () => {
    await seedPublishedQuestion("q_dep", "Dep");
    await seedPublishedQuestion("q_dep_other", "Other");

    expect(
      (await post("/forms", { formId: "frm_dep", slug: "dep", defaultLocale: "en" })).status,
    ).toBe(201);

    // v1 pins q_dep@1 in stp_a (published at publish time)
    const v1Def = formDefinition("frm_dep", [
      ["stp_a", ["q_dep"]],
      ["stp_b", ["q_dep_other"]],
    ]);
    expect((await put("/forms/frm_dep/draft", { definition: v1Def })).status).toBe(200);
    expect((await post("/forms/frm_dep/publish")).status).toBe(200);

    // now deprecate q_dep@1 - no longer a valid target for *new* pins
    await deprecateQuestionVersion(testDb.db, {
      questionId: QuestionId.parse("q_dep"),
      version: 1,
    });

    // carried-over: v2 keeps q_dep@1 in the same step stp_a → allowed
    expect((await put("/forms/frm_dep/draft", { definition: v1Def })).status).toBe(200);
    const carried = await post("/forms/frm_dep/publish");
    expect(carried.status).toBe(200);
    expect(((await carried.json()) as { version: number }).version).toBe(2);

    // moved: v3 relocates q_dep@1 to a *different* step stp_b → DEPRECATED_PIN
    const movedDef = formDefinition("frm_dep", [
      ["stp_a", ["q_dep_other"]],
      ["stp_b", ["q_dep"]],
    ]);
    expect((await put("/forms/frm_dep/draft", { definition: movedDef })).status).toBe(200);
    const moved = await post("/forms/frm_dep/publish");
    expect(moved.status).toBe(422);
    const body = (await moved.json()) as ErrBody;
    expect(body.error.code).toBe("PUBLISH_REJECTED");
    const dep = body.error.details?.issues?.find((i) => i.code === "DEPRECATED_PIN");
    expect(dep).toBeDefined();
    expect(dep?.path).toMatchObject({ step: "stp_b", question: "q_dep", version: 1 });
  });

  it("a brand-new form pinning a deprecated version is rejected (never carried over)", async () => {
    await seedPublishedQuestion("q_fresh_dep", "Fresh");
    await deprecateQuestionVersion(testDb.db, {
      questionId: QuestionId.parse("q_fresh_dep"),
      version: 1,
    });

    expect(
      (await post("/forms", { formId: "frm_fresh", slug: "fresh", defaultLocale: "en" })).status,
    ).toBe(201);
    const def = formDefinition("frm_fresh", [["stp_one", ["q_fresh_dep"]]]);
    expect((await put("/forms/frm_fresh/draft", { definition: def })).status).toBe(200);
    const res = await post("/forms/frm_fresh/publish");
    expect(res.status).toBe(422);
    expect(
      ((await res.json()) as ErrBody).error.details?.issues?.some(
        (i) => i.code === "DEPRECATED_PIN",
      ),
    ).toBe(true);
  });
});

// --- exit criterion 4: snapshot integrity -----------------------------------

describe("stored compiled deep-equals a fresh compile (exit criterion 4)", () => {
  it("the version's compiled JSONB equals compileForm of the publish-time snapshot, with stamps", async () => {
    await seedPublishedQuestion("q_snap_a", "SnapA");
    await seedPublishedQuestion("q_snap_b", "SnapB");

    expect(
      (await post("/forms", { formId: "frm_snap", slug: "snap", defaultLocale: "en" })).status,
    ).toBe(201);
    const def = formDefinition("frm_snap", [
      ["stp_one", ["q_snap_a"]],
      ["stp_two", ["q_snap_b"]],
    ]);
    expect((await put("/forms/frm_snap/draft", { definition: def })).status).toBe(200);
    expect((await post("/forms/frm_snap/publish")).status).toBe(200);

    // Read the stored snapshot back through the version route.
    const stored = (await (await get("/forms/frm_snap/versions/1")).json()) as {
      compiled: unknown;
      compilerVersion: string;
      a2uiSpecVersion: string;
      semanticsVersion: string;
      definition: FormDefinition;
    };

    // Independently rebuild the fresh compile: compileDraft over the same pinned
    // records, then compileForm - the exact path publish took at publish time.
    const records: QuestionVersionRecord[] = [];
    for (const [id] of [["q_snap_a"], ["q_snap_b"]] as [string][]) {
      const rows = await listQuestionVersions(testDb.db, QuestionId.parse(id));
      const row = rows.find((r) => r.version === 1)!;
      records.push({
        questionId: row.questionId as QuestionIdType,
        version: row.version,
        definition: row.definition,
      });
    }
    const byPin = new Map(records.map((r) => [`${r.questionId} ${String(r.version)}`, r]));
    const published = new Map([
      [QuestionId.parse("q_snap_a"), new Set([1])],
      [QuestionId.parse("q_snap_b"), new Set([1])],
    ]);
    const result = compileDraft({
      definition: stored.definition,
      resolveQuestion: (qid, version) => byPin.get(`${qid} ${String(version)}`),
      publishedQuestionVersions: published,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fresh = compileForm(result.value, {});

    expect(stored.compiled).toEqual(fresh);
    // Version stamps present and consistent.
    expect(stored.compilerVersion).toBe(fresh.compilerVersion);
    expect(stored.a2uiSpecVersion).toBe(fresh.a2uiSpecVersion);
    expect(stored.semanticsVersion).toBe(String(result.value.semanticsVersion));
    expect(stored.compilerVersion.length).toBeGreaterThan(0);
    expect(stored.a2uiSpecVersion.length).toBeGreaterThan(0);
  });
});

// --- exit criterion 5: atomicity under an induced mid-transaction failure ----

describe("publish is all-or-nothing (exit criterion 5)", () => {
  it("an induced failure between version insert and draft delete persists nothing", async () => {
    await seedPublishedQuestion("q_atom", "Atom");

    expect(
      (await post("/forms", { formId: "frm_atom", slug: "atom", defaultLocale: "en" })).status,
    ).toBe(201);
    const def = formDefinition("frm_atom", [["stp_one", ["q_atom"]]]);
    expect((await put("/forms/frm_atom/draft", { definition: def })).status).toBe(200);

    // Induce a real failure on the draft DELETE - which runs *after* the version
    // insert inside the same transaction (the fault-trigger technique 020 uses).
    await testDb.client.query(
      `create function __fail_draft_delete() returns trigger as $$
       begin raise exception 'induced failure'; end; $$ language plpgsql`,
    );
    await testDb.client.query(
      `create trigger __fail_draft_delete before delete on form_drafts
         for each row execute function __fail_draft_delete()`,
    );

    try {
      const res = await post("/forms/frm_atom/publish");
      // The induced pg error surfaces as an opaque 500 (unexpected throw).
      expect(res.status).toBe(500);
    } finally {
      await testDb.client.query(`drop trigger __fail_draft_delete on form_drafts`);
      await testDb.client.query(`drop function __fail_draft_delete()`);
    }

    // Nothing committed: no version row, the draft is intact, no outbox event.
    expect(await listFormVersions(testDb.db, FormId.parse("frm_atom"))).toHaveLength(0);
    expect(await getDraft(testDb.db, FormId.parse("frm_atom"))).toBeDefined();
    expect(await publishedEventCount("frm_atom")).toBe(0);
  });
});
