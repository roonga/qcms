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

import { compileForm } from "@roonga/qcms-a2ui-compiler";
import {
  compileDraft,
  type FormDefinition,
  FormId,
  parseQuestionDefinition,
  QuestionId,
  type QuestionVersionRecord,
  SessionId,
} from "@roonga/qcms-core";
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
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerForms } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
// A real better-auth session row seeded per suite (031): the admin-auth
// middleware verifies it against the database, so a made-up marker no longer
// authenticates anything.
let adminSessionToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, { groups: { admin: [registerAdminAuth, registerForms] } });
  internalToken = internalTokenFor(deps.config);
  adminSessionToken = (await seedAdminSession(testDb.db)).token;
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

// --- request helpers (channel token + a real admin session on every call) ----

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
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
        questionId: row.questionId,
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
    const fresh = compileForm(result.value.snapshot, {});

    expect(stored.compiled).toEqual(fresh);
    // Version stamps present and consistent.
    expect(stored.compilerVersion).toBe(fresh.compilerVersion);
    expect(stored.a2uiSpecVersion).toBe(fresh.a2uiSpecVersion);
    expect(stored.semanticsVersion).toBe(String(result.value.snapshot.semanticsVersion));
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

// --- 033: the rule test bench and the per-form settings ---------------------

/** Seed a published choice question, so a rule can compare option ids. */
async function seedPublishedChoice(id: string, optionIds: readonly string[]): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition({
    questionId: id,
    type: "singleChoice",
    label: { en: id },
    options: optionIds.map((optionId) => ({ optionId, label: { en: optionId } })),
  });
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(testDb.db, { questionId, slug: id.replace(/_/g, "-") });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}

interface BenchBody {
  ruleId: string;
  references: string[];
  outcome: "match" | "noMatch" | "unavailable";
  reason?: string;
}

async function bench(formId: string, body: unknown): Promise<Response> {
  return post(`/forms/${formId}/draft/preview-condition`, body);
}

describe("preview-condition: the rule test bench (033)", () => {
  const formId = "frm_bench";
  const rule = {
    ruleId: "rul_bench",
    when: { op: "equals", questionId: "q_bench_choice", value: "opt_yes" },
    show: ["q_bench_followup"],
  };
  const definition = formDefinition(
    formId,
    [
      ["stp_bench_one", ["q_bench_choice"]],
      ["stp_bench_two", ["q_bench_followup"]],
    ],
    [rule],
  );

  beforeAll(async () => {
    await seedPublishedChoice("q_bench_choice", ["opt_yes", "opt_no"]);
    await seedPublishedQuestion("q_bench_followup", "Tell us more");
    await post("/forms", { formId, slug: "bench", defaultLocale: "en" });
    await put(`/forms/${formId}/draft`, { definition });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("reports a match for answers the condition accepts", async () => {
    const res = await bench(formId, {
      definition,
      ruleId: "rul_bench",
      answers: { q_bench_choice: "opt_yes" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as BenchBody;
    expect(body).toMatchObject({
      ruleId: "rul_bench",
      references: ["q_bench_choice"],
      outcome: "match",
    });
    // `reason` is the unavailable-only channel: a real verdict carries none.
    expect(body.reason).toBeUndefined();
  });

  it("reports no match for a different answer, and for no answer at all", async () => {
    const miss = await bench(formId, {
      definition,
      ruleId: "rul_bench",
      answers: { q_bench_choice: "opt_no" },
    });
    expect(((await miss.json()) as BenchBody).outcome).toBe("noMatch");

    const empty = await bench(formId, { definition, ruleId: "rul_bench", answers: {} });
    expect(((await empty.json()) as BenchBody).outcome).toBe("noMatch");
  });

  it("answers for the submitted definition, not the saved draft (a live authoring aid)", async () => {
    // The saved draft still compares against `opt_yes`; this body flips the rule
    // without saving, so a bench that read storage would give the stale verdict.
    const unsaved = {
      ...definition,
      rules: [{ ...rule, when: { op: "equals", questionId: "q_bench_choice", value: "opt_no" } }],
    };
    const res = await bench(formId, {
      definition: unsaved,
      ruleId: "rul_bench",
      answers: { q_bench_choice: "opt_no" },
    });
    expect(((await res.json()) as BenchBody).outcome).toBe("match");
    // And storage is untouched: the bench is read-only.
    const saved = await getDraft(testDb.db, FormId.parse(formId));
    expect((saved?.definition as FormDefinition).rules[0]?.when).toMatchObject({
      value: "opt_yes",
    });
  });

  it("still answers when the rule points backwards (placement is validate's verdict)", async () => {
    // Reversed layout: the target sits *before* the question the rule reads, so
    // `analyzeRuleGraph` rejects the placement. The bench must still say whether
    // the condition matches - that is the question the author came here with, and
    // it is exactly why the bench evaluates a synthetic forward layout instead of
    // the draft.
    const backwards = formDefinition(
      formId,
      [
        ["stp_bench_two", ["q_bench_followup"]],
        ["stp_bench_one", ["q_bench_choice"]],
      ],
      [rule],
    );
    const preview = await bench(formId, {
      definition: backwards,
      ruleId: "rul_bench",
      answers: { q_bench_choice: "opt_yes" },
    });
    expect(((await preview.json()) as BenchBody).outcome).toBe("match");

    // The same definition through validate reports the placement error. That is
    // the division of labour the two routes exist to keep: the bench answers
    // "does it match", validate answers "is it legal" (and runs analyzeRuleGraph
    // server-side, which is why the builder needs no kernel of its own).
    const validated = await post(`/forms/${formId}/draft/validate`, { definition: backwards });
    const issues = ((await validated.json()) as { issues: Issue[] }).issues;
    expect(issues.map((issue) => issue.code)).toContain("RULE_BACKWARD_TARGET");
  });

  it("declines to answer for a malformed answer, without echoing the value", async () => {
    const res = await bench(formId, {
      definition,
      ruleId: "rul_bench",
      // An object is not a canonical AnswerValue encoding (DOMAIN_SCHEMA §2.4).
      answers: { q_bench_choice: { not: "an answer" } },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as BenchBody;
    // Tri-state matters here: this is NOT a `noMatch`, and the panel must be able
    // to tell the difference.
    expect(body.outcome).toBe("unavailable");
    expect(body.reason).toBe("unresolvedAnswers");
    // SEC-13 / ADR-34: the hypothetical answer never comes back out.
    expect(raw).not.toContain("an answer");
  });

  it("declines to answer for an unknown ruleId, as a verdict rather than an error", async () => {
    const res = await bench(formId, { definition, ruleId: "rul_not_here", answers: {} });
    // 200, not 404: an author scrolling the rule list past a stale id should see
    // the bench say so, not an error envelope.
    expect(res.status).toBe(200);
    expect((await res.json()) as BenchBody).toMatchObject({
      ruleId: "rul_not_here",
      outcome: "unavailable",
      reason: "ruleNotFound",
    });
  });

  it("declines to answer for a half-built draft that does not parse", async () => {
    const res = await bench(formId, {
      definition: { formId, defaultLocale: "en", title: { en: "wip" } },
      ruleId: "rul_bench",
      answers: {},
    });
    // The bench reads work in progress: an unparseable draft is an ordinary
    // state, not a 422 that would blank the panel mid-edit.
    expect(res.status).toBe(200);
    expect((await res.json()) as BenchBody).toMatchObject({
      outcome: "unavailable",
      reason: "unparseableDraft",
    });
  });

  it("declines to answer when the rule shows nothing the draft pins", async () => {
    const noTarget = {
      ...definition,
      rules: [{ ...rule, show: ["q_bench_absent"] }],
    };
    const res = await bench(formId, { definition: noTarget, ruleId: "rul_bench", answers: {} });
    expect((await res.json()) as BenchBody).toMatchObject({
      outcome: "unavailable",
      reason: "noTarget",
    });
  });

  it("declines to answer when the condition reads only unpinned questions", async () => {
    // Nothing to vary: the bench form's input step would be empty, so there is no
    // answer that could change the verdict.
    const unpinned = {
      ...definition,
      rules: [
        {
          ruleId: "rul_bench",
          when: { op: "answered", questionId: "q_bench_absent" },
          show: ["q_bench_followup"],
        },
      ],
    };
    const res = await bench(formId, { definition: unpinned, ruleId: "rul_bench", answers: {} });
    expect((await res.json()) as BenchBody).toMatchObject({
      outcome: "unavailable",
      reason: "unresolvedAnswers",
    });
  });

  it("404s an unknown form (the route is still scoped to one)", async () => {
    const res = await bench("frm_no_such_bench", { definition, ruleId: "rul_bench", answers: {} });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrBody).error.code).toBe("FORM_NOT_FOUND");
  });
});

interface SettingsBody {
  formId: string;
  settings: { challengeRequired: boolean; minSubmitMs: number | null };
  challengeEnforceable: boolean;
  // Read back as `unknown` on purpose: the raw provider name must not be on the
  // wire at all any more (ADR-24, issue #725), and a typed absence is easier to
  // assert than a missing key on a narrowed interface.
  challengeProvider?: unknown;
}

async function patchSettings(formId: string, body: unknown): Promise<Response> {
  return app.request(`/admin/forms/${formId}/settings`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

describe("per-form settings (033 settings panel)", () => {
  const formId = "frm_settings";

  beforeAll(async () => {
    await post("/forms", { formId, slug: "settings", defaultLocale: "en" });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("defaults to challenge off and no min-time override, and the detail read carries them", async () => {
    const res = await get(`/forms/${formId}`);
    const body = (await res.json()) as SettingsBody;
    expect(body).toMatchObject({ settings: { challengeRequired: false, minSubmitMs: null } });
    // The derived boolean rides the detail read so the panel can warn on load
    // that `challengeRequired` is unenforceable (033). The raw provider name is
    // not on the wire: ADR-24 gives clients behavior, not flag values (#725).
    expect(body.challengeEnforceable).toBe(deps.config.flags.challengeProvider !== "none");
    expect(body.challengeProvider).toBeUndefined();
  });

  it("patches one field at a time and leaves the other alone", async () => {
    const one = await patchSettings(formId, { challengeRequired: true });
    expect(one.status).toBe(200);
    const first = (await one.json()) as SettingsBody;
    expect(first).toMatchObject({
      formId,
      settings: { challengeRequired: true, minSubmitMs: null },
    });
    // The write answers with the derived boolean too, so the warning re-renders
    // without a follow-up read, and again without naming the provider.
    expect(first.challengeEnforceable).toBe(deps.config.flags.challengeProvider !== "none");
    expect(first.challengeProvider).toBeUndefined();

    const two = await patchSettings(formId, { minSubmitMs: 3000 });
    expect((await two.json()) as SettingsBody).toMatchObject({
      settings: { challengeRequired: true, minSubmitMs: 3000 },
    });

    // `null` is a value: it restores the deployment's configured floor.
    const three = await patchSettings(formId, { minSubmitMs: null });
    expect((await three.json()) as SettingsBody).toMatchObject({
      settings: { challengeRequired: true, minSubmitMs: null },
    });

    const detail = (await (await get(`/forms/${formId}`)).json()) as SettingsBody;
    expect(detail.settings.challengeRequired).toBe(true);
  });

  it("rejects an absurd min-time floor, an empty patch, and an unknown form", async () => {
    expect((await patchSettings(formId, { minSubmitMs: 999_999_999 })).status).toBe(400);
    // An all-absent patch is refused at the schema, which is what keeps the
    // helper's `undefined` return meaning exactly "no such form" below.
    expect((await patchSettings(formId, {})).status).toBe(400);
    expect((await patchSettings("frm_no_such_form", { challengeRequired: true })).status).toBe(404);
  });
});

// --- the live draft preview (034) -------------------------------------------

interface PreviewBody {
  documents: { stepId: string; root: unknown }[];
  compilerVersion: string;
  a2uiSpecVersion: string;
  flow: { visibleSteps: string[]; visibleQuestions: string[]; complete: boolean };
}

async function preview(formId: string, body: unknown): Promise<Response> {
  return post(`/forms/${formId}/draft/preview`, body);
}

describe("draft preview: the dry-run compile the admin renders (034)", () => {
  const formId = "frm_preview";
  const rule = {
    ruleId: "rul_preview",
    when: { op: "equals", questionId: "q_preview_choice", value: "opt_yes" },
    show: ["q_preview_followup"],
  };
  const definition = formDefinition(
    formId,
    [
      ["stp_preview_one", ["q_preview_choice"]],
      ["stp_preview_two", ["q_preview_followup"]],
    ],
    [rule],
    "Preview me",
  );

  beforeAll(async () => {
    await seedPublishedChoice("q_preview_choice", ["opt_yes", "opt_no"]);
    await seedPublishedQuestion("q_preview_followup", "How many?");
    await post("/forms", { formId, slug: "preview", defaultLocale: "en" });
    await put(`/forms/${formId}/draft`, { definition });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("compiles the submitted draft and stamps both versions", async () => {
    const res = await preview(formId, { definition });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;

    expect(body.documents.map((document) => document.stepId)).toEqual([
      "stp_preview_one",
      "stp_preview_two",
    ]);
    expect(body.compilerVersion).not.toBe("");
    expect(body.a2uiSpecVersion).not.toBe("");
  });

  it("is byte-identical to what publishing this draft would freeze (fidelity)", async () => {
    // The whole point of the endpoint: the author's preview and the respondent's
    // served document come out of the same `compileForm` call in the same
    // process, so they cannot drift (ARCHITECTURE §6, ADR-18).
    const previewed = (await (await preview(formId, { definition })).json()) as PreviewBody;

    const published = await post(`/forms/${formId}/publish`);
    expect(published.status).toBe(200);
    const version = (await published.json()) as { version: number };
    const snapshot = (await (
      await get(`/forms/${formId}/versions/${String(version.version)}`)
    ).json()) as {
      compiled: { documents: { stepId: string; root: unknown }[] };
      compilerVersion: string;
      a2uiSpecVersion: string;
    };

    expect(previewed.documents).toEqual(snapshot.compiled.documents);
    expect(previewed.compilerVersion).toBe(snapshot.compilerVersion);
    expect(previewed.a2uiSpecVersion).toBe(snapshot.a2uiSpecVersion);

    // Publishing consumed the draft; restore one so the rest of the block reads
    // the same definition it started with.
    await put(`/forms/${formId}/draft`, { definition });
  });

  it("walks a branch: the follow-up appears only for the answer that shows it", async () => {
    const none = (await (await preview(formId, { definition })).json()) as PreviewBody;
    expect(none.flow.visibleQuestions).toEqual(["q_preview_choice"]);

    const shown = (await (
      await preview(formId, { definition, answers: { q_preview_choice: "opt_yes" } })
    ).json()) as PreviewBody;
    expect(shown.flow.visibleQuestions).toEqual(["q_preview_choice", "q_preview_followup"]);
    expect(shown.flow.visibleSteps).toEqual(["stp_preview_one", "stp_preview_two"]);

    const hidden = (await (
      await preview(formId, { definition, answers: { q_preview_choice: "opt_no" } })
    ).json()) as PreviewBody;
    expect(hidden.flow.visibleQuestions).toEqual(["q_preview_choice"]);
  });

  it("previews the definition on the author's screen, not the saved draft", async () => {
    const edited = formDefinition(
      formId,
      [
        ["stp_preview_one", ["q_preview_choice"]],
        ["stp_preview_two", ["q_preview_followup"]],
      ],
      [{ ...rule, when: { op: "equals", questionId: "q_preview_choice", value: "opt_no" } }],
      "Preview me",
    );
    const body = (await (
      await preview(formId, { definition: edited, answers: { q_preview_choice: "opt_no" } })
    ).json()) as PreviewBody;
    expect(body.flow.visibleQuestions).toContain("q_preview_followup");
  });

  it("refuses a draft that could not be published, with the issues verbatim", async () => {
    const backward = formDefinition(
      formId,
      [
        ["stp_preview_one", ["q_preview_choice"]],
        ["stp_preview_two", ["q_preview_followup"]],
      ],
      [
        {
          ruleId: "rul_backward",
          when: { op: "equals", questionId: "q_preview_followup", value: "x" },
          show: ["q_preview_choice"],
        },
      ],
    );
    const res = await preview(formId, { definition: backward });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("PREVIEW_REJECTED");
    expect(body.error.details?.issues?.map((issue) => issue.code)).toContain(
      "RULE_BACKWARD_TARGET",
    );
    // The invariant behind the admin's copy for this code, which promises "the reasons
    // are listed below": a rejection always has at least one reason. A compile that fails
    // without saying why answers `PREVIEW_UNAVAILABLE` instead, which has its own
    // sentence and lists nothing.
    expect(body.error.details?.issues?.length ?? 0).toBeGreaterThan(0);
  });

  it("treats an unreadable answer as unanswered rather than failing the pane", async () => {
    const res = await preview(formId, {
      definition,
      answers: { q_preview_choice: { smuggled: "answer-value-that-must-not-come-back" } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.flow.visibleQuestions).toEqual(["q_preview_choice"]);
    // SEC-13: the rejected value is never echoed back.
    expect(JSON.stringify(body)).not.toContain("answer-value-that-must-not-come-back");
  });

  it("writes nothing: no version, no outbox event, and the draft is untouched", async () => {
    const before = await publishedEventCount(formId);
    await preview(formId, { definition, answers: { q_preview_choice: "opt_yes" } });
    expect(await publishedEventCount(formId)).toBe(before);

    const detail = (await (await get(`/forms/${formId}`)).json()) as {
      draft: { title: Record<string, string> };
      versions: unknown[];
    };
    expect(detail.draft.title["en"]).toBe("Preview me");
    expect(detail.versions).toHaveLength(1);
  });

  it("400s a malformed id, 404s an unknown form, and 422s a foreign definition", async () => {
    expect((await preview("nope", { definition })).status).toBe(400);
    expect((await preview("frm_no_such_form", { definition })).status).toBe(404);

    const foreign = await preview(formId, {
      definition: formDefinition("frm_someone_else", [["stp_preview_one", ["q_preview_choice"]]]),
    });
    expect(foreign.status).toBe(422);
    expect(((await foreign.json()) as ErrBody).error.code).toBe("FORM_ID_MISMATCH");
  });
});

// --- 123: publish warnings ride the validate and draft-save responses --------

/** Seed a published multiChoice question, so a rule can read a group answer. */
async function seedPublishedMulti(id: string, optionIds: readonly string[]): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition({
    questionId: id,
    type: "multiChoice",
    label: { en: id },
    options: optionIds.map((optionId) => ({ optionId, label: { en: optionId } })),
  });
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(testDb.db, { questionId, slug: id.replace(/_/g, "-") });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}

describe("publish warnings reach the author without blocking a publish (#123)", () => {
  const formId = "frm_warn";
  const layout: [string, string[]][] = [
    ["stp_warn_one", ["q_warn_multi", "q_warn_detail"]],
    ["stp_warn_two", ["q_warn_later"]],
  ];
  /** Reads a multiChoice answer and reveals a question on the SAME step (ADR-31). */
  const sameStepRule = {
    ruleId: "rul_warn",
    when: { op: "contains", questionId: "q_warn_multi", value: "opt_a" },
    show: ["q_warn_detail"],
  };
  const sameStep = formDefinition(formId, layout, [sameStepRule]);

  beforeAll(async () => {
    await seedPublishedMulti("q_warn_multi", ["opt_a", "opt_b"]);
    await seedPublishedQuestion("q_warn_detail", "Tell us more");
    await seedPublishedQuestion("q_warn_later", "And later");
    await post("/forms", { formId, slug: "warn", defaultLocale: "en" });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("validate reports the warning and still calls the draft valid", async () => {
    const res = await post(`/forms/${formId}/draft/validate`, { definition: sameStep });
    const body = (await res.json()) as { valid: boolean; issues: Issue[]; warnings: Issue[] };

    // The point of the channel: `valid` keys off errors alone, so an advisory does not
    // turn into a refusal on its way to the screen.
    expect(body.valid).toBe(true);
    expect(body.issues).toEqual([]);
    expect(body.warnings.map((warning) => warning.code)).toEqual(["MULTICHOICE_SAME_STEP_TARGET"]);
    expect(body.warnings[0]?.path).toMatchObject({
      rule: "rul_warn",
      question: "q_warn_multi",
      target: "q_warn_detail",
      step: "stp_warn_one",
    });
  });

  it("the advisory draft save carries the same warning", async () => {
    const res = await put(`/forms/${formId}/draft`, { definition: sameStep });
    const body = (await res.json()) as { issues: Issue[]; warnings: Issue[] };

    expect(body.issues).toEqual([]);
    expect(body.warnings.map((warning) => warning.code)).toEqual(["MULTICHOICE_SAME_STEP_TARGET"]);
  });

  it("a cross-step target is silent: the ordinary case earns no advisory", async () => {
    const crossStep = formDefinition(formId, layout, [{ ...sameStepRule, show: ["q_warn_later"] }]);
    const res = await post(`/forms/${formId}/draft/validate`, { definition: crossStep });

    expect(((await res.json()) as { warnings: Issue[] }).warnings).toEqual([]);
  });

  it("a draft with errors reports no warnings: the kernel advises only on a snapshot", async () => {
    // A whitespace-only title, which is the #366 publish error rather than a missing
    // locale: the schema still accepts the value and the publish gate refuses it.
    const broken = formDefinition(formId, layout, [sameStepRule], "   ");
    const res = await post(`/forms/${formId}/draft/validate`, { definition: broken });
    const body = (await res.json()) as { valid: boolean; issues: Issue[]; warnings: Issue[] };

    expect(body.valid).toBe(false);
    expect(body.issues.map((issue) => issue.code)).toContain("BLANK_LOCALIZED_TEXT");
    expect(body.warnings).toEqual([]);
  });

  it("a DEPRECATED_PIN issue and a warning coexist, and both are reported", async () => {
    // The invariant is about the KERNEL, and this is the case that shows why the
    // wider reading ("warnings is empty whenever issues is not") was false:
    // `DEPRECATED_PIN` is raised by this layer, not by `compileDraft`, so it can
    // stand beside an advisory about the same draft.
    //
    // The gating is deliberately left alone. This draft genuinely has both facts,
    // and suppressing the advisory because an unrelated deprecation is open would
    // drop information the author needs - and would make the warning list depend
    // on which other problems happen to exist.
    await seedPublishedQuestion("q_warn_dep", "A field since deprecated");
    await deprecateQuestionVersion(testDb.db, {
      questionId: QuestionId.parse("q_warn_dep"),
      version: 1,
    });

    const coexistId = "frm_warn_dep";
    expect(
      (await post("/forms", { formId: coexistId, slug: "warn-dep", defaultLocale: "en" })).status,
    ).toBe(201);

    const definition = formDefinition(
      coexistId,
      [
        ["stp_wd_one", ["q_warn_multi", "q_warn_detail"]],
        ["stp_wd_two", ["q_warn_dep"]],
      ],
      [sameStepRule],
    );
    const res = await post(`/forms/${coexistId}/draft/validate`, { definition });
    const body = (await res.json()) as { valid: boolean; issues: Issue[]; warnings: Issue[] };

    // Both arrays non-empty at once, which the old comments said could not happen.
    expect(body.issues.map((issue) => issue.code)).toContain("DEPRECATED_PIN");
    expect(body.warnings.map((warning) => warning.code)).toEqual(["MULTICHOICE_SAME_STEP_TARGET"]);
    // The kernel itself found nothing wrong: every issue here is the API layer's.
    expect(body.issues.every((issue) => issue.code === "DEPRECATED_PIN")).toBe(true);
    // And the deprecation still blocks the publish, exactly as before.
    expect(body.valid).toBe(false);
  });

  it("a warned draft publishes: a warning never refuses (#123)", async () => {
    await put(`/forms/${formId}/draft`, { definition: sameStep });
    const res = await post(`/forms/${formId}/publish`);

    expect(res.status).toBe(200);
    expect((await res.json()) as { version: number }).toMatchObject({ version: 1 });
  });
});

// --- refusals that never reach a handler (issues #182, #645) -----------------

describe("admin schema refusals and out-of-range versions", () => {
  const formId = "frm_envelope";

  beforeAll(async () => {
    await post("/forms", { formId, slug: "envelope", defaultLocale: "en" });
  });

  it("renders a route-schema refusal as the documented ErrorEnvelope (#182)", async () => {
    // `slug` is required and `formId` must be a string: the validator refuses
    // this before `makeCreateFormHandler` runs. Before the defaultHook landed the
    // body was a serialized ZodError with no `error.code` at all.
    const res = await post("/forms", { formId: 42 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrBody;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.details).toMatchObject({ target: "json" });
  });

  it("keeps a refused admin request's own values out of the response (SEC-8)", async () => {
    const res = await post("/forms", {
      formId: "SENTINEL-form-id-value",
      slug: "SENTINEL-slug-value",
      defaultLocale: 7,
    });

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("SENTINEL");
  });

  it("404s a version segment above int4 rather than 500ing on the driver (#645)", async () => {
    // 2_147_483_648: one past the `form_versions.version` column's ceiling. The
    // guard used to admit it and let Postgres refuse the parameter, which surfaced
    // as an opaque 500 for a URL that 404s one digit shorter.
    const over = await get(`/forms/${formId}/versions/2147483648`);
    expect(over.status).toBe(404);
    expect(((await over.json()) as ErrBody).error.code).toBe("VERSION_NOT_FOUND");

    // The composed behaviour of the two fixes: the refusal is an envelope, and
    // an in-range unknown version answers identically.
    const inRange = await get(`/forms/${formId}/versions/2147483647`);
    expect(inRange.status).toBe(404);
    expect(((await inRange.json()) as ErrBody).error.code).toBe("VERSION_NOT_FOUND");
  });
});
