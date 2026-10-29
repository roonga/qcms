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
  SEED_WORKSPACE_ID,
  archiveWorkspace,
  authOrganization,
  createQuestion,
  createQuestionVersion,
  createSession,
  deprecateQuestionVersion,
  getDraft,
  getSession,
  listFormVersions,
  insertFormRelease,
  listQuestionVersions,
  moveQuestionToWorkspace,
  publishQuestionVersion,
  setWorkspaceShared,
} from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
  DEFAULT_TEST_ENVIRONMENT,
} from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerForms } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let adminSessionToken: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerGrantCheck, registerForms] },
  });
  internalToken = internalTokenFor(deps.config);
  adminSessionToken = (await seedAdminSession(testDb.db)).token;
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

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

function shortText(id: string, labelText = "Field"): Record<string, unknown> {
  return { questionId: id, type: "shortText", label: { en: labelText } };
}

// Parsed through the kernel first so the schema defaults the A2UI compiler reads are applied.
async function seedPublishedQuestion(id: string, labelText = "Field"): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition(shortText(id, labelText));
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: id.replace(/_/g, "-"),
  });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}

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
  keys?: string[];
}
interface ErrBody {
  error: { code: string; message: string; details?: { issues?: Issue[]; target?: string } };
}

// Each schema is named explicitly because the control pool that publishes has no search
// path into a data schema, so a count taken through one would read nothing.
async function outboxRowsInEveryEnvironment(): Promise<number> {
  const result = await testDb.client.query(
    `select (select count(*) from data_test.outbox)
          + (select count(*) from data_prod.outbox) as n`,
  );
  return Number((result.rows[0] as { n: string | number }).n);
}

describe("full authoring loop (exit criterion 1)", () => {
  it("create → draft → publish → seeded new draft → publish v2; a v1 session is untouched", async () => {
    await seedPublishedQuestion("q_loop_name", "Name");
    await seedPublishedQuestion("q_loop_email", "Email");

    const createRes = await post("/forms", {
      formId: "frm_loop",
      slug: "loop",
      defaultLocale: "en",
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { formId: string; status: string; draft: unknown };
    expect(created.formId).toBe("frm_loop");
    expect(created.status).toBe("open");

    const v1Def = formDefinition("frm_loop", [["stp_one", ["q_loop_name"]]]);
    const draftRes = await put("/forms/frm_loop/draft", { definition: v1Def });
    expect(draftRes.status).toBe(200);
    expect(((await draftRes.json()) as { issues: Issue[] }).issues).toEqual([]);

    const pubRes = await post("/forms/frm_loop/publish");
    expect(pubRes.status).toBe(200);
    const v1 = (await pubRes.json()) as { version: number; publishedAt: string };
    expect(v1.version).toBe(1);
    expect(typeof v1.publishedAt).toBe("string");

    expect(await outboxRowsInEveryEnvironment()).toBe(0);

    const sessionId = SessionId.parse("ses_loop_v1_session_aaaa");
    await createSession(testDb.db, {
      environment: DEFAULT_TEST_ENVIRONMENT,
      sessionId,
      formId: FormId.parse("frm_loop"),
      formVersion: 1,
      accessMode: "anonymous",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const detail = (await (await get("/forms/frm_loop")).json()) as {
      draftSource: string;
      draft: FormDefinition;
      versions: { version: number }[];
    };
    expect(detail.draftSource).toBe("seeded");
    expect(detail.draft.steps).toHaveLength(1);
    expect(detail.versions.map((v) => v.version)).toEqual([1]);

    const v2Def = formDefinition("frm_loop", [
      ["stp_one", ["q_loop_name"]],
      ["stp_two", ["q_loop_email"]],
    ]);
    expect((await put("/forms/frm_loop/draft", { definition: v2Def })).status).toBe(200);
    const pub2 = await post("/forms/frm_loop/publish");
    expect(pub2.status).toBe(200);
    expect(((await pub2.json()) as { version: number }).version).toBe(2);

    const session = (await getSession(testDb.db, sessionId)) as { formVersion: number } | undefined;
    expect(session?.formVersion).toBe(1);

    const versions = (await get("/forms/frm_loop")).status;
    expect(versions).toBe(200);
    const rows = await listFormVersions(testDb.db, FormId.parse("frm_loop"));
    expect(rows.map((r) => r.version).sort((a, b) => a - b)).toEqual([1, 2]);
  });
});

describe("publish failure is atomic (exit criterion 2)", () => {
  it("a backward rule target → 422 RULE_BACKWARD_TARGET; nothing persisted", async () => {
    await seedPublishedQuestion("q_bw_a", "A");
    await seedPublishedQuestion("q_bw_b", "B");

    expect(
      (await post("/forms", { formId: "frm_bw", slug: "bw", defaultLocale: "en" })).status,
    ).toBe(201);

    const badDef = formDefinition(
      "frm_bw",
      [
        ["stp_one", ["q_bw_a"]],
        ["stp_two", ["q_bw_b"]],
      ],
      [{ ruleId: "rul_back", when: { op: "answered", questionId: "q_bw_b" }, show: ["q_bw_a"] }],
    );
    const draftRes = await put("/forms/frm_bw/draft", { definition: badDef });
    expect(draftRes.status).toBe(200);
    const advisory = (await draftRes.json()) as { issues: Issue[] };
    expect(advisory.issues.some((i) => i.code === "RULE_BACKWARD_TARGET")).toBe(true);

    const pubRes = await post("/forms/frm_bw/publish");
    expect(pubRes.status).toBe(422);
    const body = (await pubRes.json()) as ErrBody;
    expect(body.error.code).toBe("PUBLISH_REJECTED");
    const backward = body.error.details?.issues?.find((i) => i.code === "RULE_BACKWARD_TARGET");
    expect(backward).toBeDefined();
    expect(backward?.path).toMatchObject({ rule: "rul_back", target: "q_bw_a" });

    expect(await listFormVersions(testDb.db, FormId.parse("frm_bw"))).toHaveLength(0);
    expect(await getDraft(testDb.db, FormId.parse("frm_bw"))).toBeDefined();
    expect(await outboxRowsInEveryEnvironment()).toBe(0);
  });
});

describe("deprecated-pin gate (exit criterion 3)", () => {
  it("a carried-over pin to a deprecated version is allowed; a moved pin is rejected", async () => {
    await seedPublishedQuestion("q_dep", "Dep");
    await seedPublishedQuestion("q_dep_other", "Other");

    expect(
      (await post("/forms", { formId: "frm_dep", slug: "dep", defaultLocale: "en" })).status,
    ).toBe(201);

    const v1Def = formDefinition("frm_dep", [
      ["stp_a", ["q_dep"]],
      ["stp_b", ["q_dep_other"]],
    ]);
    expect((await put("/forms/frm_dep/draft", { definition: v1Def })).status).toBe(200);
    expect((await post("/forms/frm_dep/publish")).status).toBe(200);

    await deprecateQuestionVersion(testDb.db, {
      questionId: QuestionId.parse("q_dep"),
      version: 1,
    });

    expect((await put("/forms/frm_dep/draft", { definition: v1Def })).status).toBe(200);
    const carried = await post("/forms/frm_dep/publish");
    expect(carried.status).toBe(200);
    expect(((await carried.json()) as { version: number }).version).toBe(2);

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

describe("workspace pin gate (task 068, criterion 2)", () => {
  // Inserted directly because this suite mounts the forms slice alone.
  async function otherWorkspace(slug: string): Promise<string> {
    const id = `org_${slug.replace(/-/g, "_")}`;
    await testDb.db
      .insert(authOrganization)
      .values({ id, name: slug, slug })
      .onConflictDoNothing({ target: authOrganization.id });
    return id;
  }

  it("refuses a new pin to another workspace's question, grandfathers a carried one, and allows the library", async () => {
    const other = await otherWorkspace("pin-gate-other");
    try {
      await seedPublishedQuestion("q_wsp_own", "Own");
      await seedPublishedQuestion("q_wsp_foreign", "Foreign");
      await moveQuestionToWorkspace(testDb.db, QuestionId.parse("q_wsp_foreign"), other);

      expect(
        (
          await post("/forms", {
            formId: "frm_wsp_new",
            slug: "wsp-new",
            workspaceId: SEED_WORKSPACE_ID,
            defaultLocale: "en",
          })
        ).status,
      ).toBe(201);
      const newPinDef = formDefinition("frm_wsp_new", [
        ["stp_a", ["q_wsp_own"]],
        ["stp_b", ["q_wsp_foreign"]],
      ]);
      expect((await put("/forms/frm_wsp_new/draft", { definition: newPinDef })).status).toBe(200);
      const refused = await post("/forms/frm_wsp_new/publish");
      expect(refused.status).toBe(422);
      const body = (await refused.json()) as ErrBody;
      expect(body.error.code).toBe("PUBLISH_REJECTED");
      const issue = body.error.details?.issues?.find((i) => i.code === "FOREIGN_WORKSPACE_PIN");
      expect(issue?.path).toMatchObject({ step: "stp_b", question: "q_wsp_foreign", version: 1 });

      await seedPublishedQuestion("q_wsp_moved", "Moved");
      expect(
        (
          await post("/forms", {
            formId: "frm_wsp_carry",
            slug: "wsp-carry",
            workspaceId: SEED_WORKSPACE_ID,
            defaultLocale: "en",
          })
        ).status,
      ).toBe(201);
      const carriedDef = formDefinition("frm_wsp_carry", [
        ["stp_a", ["q_wsp_moved"]],
        ["stp_b", ["q_wsp_own"]],
      ]);
      expect((await put("/forms/frm_wsp_carry/draft", { definition: carriedDef })).status).toBe(
        200,
      );
      expect((await post("/forms/frm_wsp_carry/publish")).status).toBe(200);

      // The question leaves the workspace AFTER that publish: the pin is now foreign.
      await moveQuestionToWorkspace(testDb.db, QuestionId.parse("q_wsp_moved"), other);
      expect((await put("/forms/frm_wsp_carry/draft", { definition: carriedDef })).status).toBe(
        200,
      );
      const carried = await post("/forms/frm_wsp_carry/publish");
      expect(carried.status).toBe(200);
      expect(((await carried.json()) as { version: number }).version).toBe(2);
      const versions = await listFormVersions(testDb.db, FormId.parse("frm_wsp_carry"));
      expect(versions).toHaveLength(2);

      const movedDef = formDefinition("frm_wsp_carry", [
        ["stp_a", ["q_wsp_own"]],
        ["stp_b", ["q_wsp_moved"]],
      ]);
      expect((await put("/forms/frm_wsp_carry/draft", { definition: movedDef })).status).toBe(200);
      const movedPin = await post("/forms/frm_wsp_carry/publish");
      expect(movedPin.status).toBe(422);
      expect(
        ((await movedPin.json()) as ErrBody).error.details?.issues?.some(
          (i) => i.code === "FOREIGN_WORKSPACE_PIN",
        ),
      ).toBe(true);

      await setWorkspaceShared(testDb.db, other, true);
      const shared = await post("/forms/frm_wsp_new/publish");
      expect(shared.status).toBe(200);
      await setWorkspaceShared(testDb.db, other, false);
    } finally {
      // Back to one active workspace, so an omitted `workspaceId` keeps resolving
      // for every other test in this file.
      await archiveWorkspace(testDb.db, other, new Date());
    }
  });
});

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

    const stored = (await (await get("/forms/frm_snap/versions/1")).json()) as {
      compiled: unknown;
      compilerVersion: string;
      a2uiSpecVersion: string;
      semanticsVersion: string;
      definition: FormDefinition;
    };

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
    expect(stored.compilerVersion).toBe(fresh.compilerVersion);
    expect(stored.a2uiSpecVersion).toBe(fresh.a2uiSpecVersion);
    expect(stored.semanticsVersion).toBe(String(result.value.snapshot.semanticsVersion));
    expect(stored.compilerVersion.length).toBeGreaterThan(0);
    expect(stored.a2uiSpecVersion.length).toBeGreaterThan(0);
  });
});

describe("publish is all-or-nothing (exit criterion 5)", () => {
  it("an induced failure between version insert and draft delete persists nothing", async () => {
    await seedPublishedQuestion("q_atom", "Atom");

    expect(
      (await post("/forms", { formId: "frm_atom", slug: "atom", defaultLocale: "en" })).status,
    ).toBe(201);
    const def = formDefinition("frm_atom", [["stp_one", ["q_atom"]]]);
    expect((await put("/forms/frm_atom/draft", { definition: def })).status).toBe(200);

    // The draft DELETE runs after the version insert inside the same transaction, so a
    // trigger on it fails the publish mid-way.
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
      expect(res.status).toBe(500);
    } finally {
      await testDb.client.query(`drop trigger __fail_draft_delete on form_drafts`);
      await testDb.client.query(`drop function __fail_draft_delete()`);
    }

    expect(await listFormVersions(testDb.db, FormId.parse("frm_atom"))).toHaveLength(0);
    expect(await getDraft(testDb.db, FormId.parse("frm_atom"))).toBeDefined();
    expect(await outboxRowsInEveryEnvironment()).toBe(0);
  });
});

async function seedPublishedChoice(id: string, optionIds: readonly string[]): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition({
    questionId: id,
    type: "singleChoice",
    label: { en: id },
    options: optionIds.map((optionId) => ({ optionId, label: { en: optionId } })),
  });
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: id.replace(/_/g, "-"),
  });
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
    // without saving.
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
    const saved = await getDraft(testDb.db, FormId.parse(formId));
    expect((saved?.definition as FormDefinition).rules[0]?.when).toMatchObject({
      value: "opt_yes",
    });
  });

  it("still answers when the rule points backwards (placement is validate's verdict)", async () => {
    // The bench evaluates a synthetic forward layout rather than the draft, so a
    // placement `analyzeRuleGraph` rejects still gets a match verdict.
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

    const validated = await post(`/forms/${formId}/draft/validate`, { definition: backwards });
    const issues = ((await validated.json()) as { issues: Issue[] }).issues;
    expect(issues.map((issue) => issue.code)).toContain("RULE_BACKWARD_TARGET");
  });

  it("declines to answer for a malformed answer, without echoing the value", async () => {
    const res = await bench(formId, {
      definition,
      ruleId: "rul_bench",
      answers: { q_bench_choice: { not: "an answer" } },
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as BenchBody;
    expect(body.outcome).toBe("unavailable");
    expect(body.reason).toBe("unresolvedAnswers");
    // SEC-13: the hypothetical answer never comes back out.
    expect(raw).not.toContain("an answer");
  });

  it("declines to answer for an unknown ruleId, as a verdict rather than an error", async () => {
    const res = await bench(formId, { definition, ruleId: "rul_not_here", answers: {} });
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
  // `unknown` so the absence of the provider name can be asserted at all.
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
    expect((await patchSettings(formId, {})).status).toBe(400);
    expect((await patchSettings("frm_no_such_form", { challengeRequired: true })).status).toBe(404);
  });

  it("answers the empty patch with the INVALID_REQUEST envelope the document names", async () => {
    const res = await patchSettings(formId, {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrBody;
    expect(Object.keys(body)).toEqual(["error"]);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.details).toMatchObject({ target: "json" });
  });
});

describe("unknown keys are refused on an admin body (issue #893)", () => {
  const formId = "frm_unknown_keys";

  beforeAll(async () => {
    await post("/forms", { formId, slug: "unknown-keys", defaultLocale: "en" });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  it("refuses #893's own example on the unknown key, not on the empty patch", async () => {
    const res = await patchSettings(formId, { unknownField: 1 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain('"unknownField"');
    expect(body.error.details?.issues?.[0]).toMatchObject({
      code: "unrecognized_keys",
      keys: ["unknownField"],
    });
  });

  it("refuses a real field sent beside an unknown one, which used to answer 200", async () => {
    const res = await patchSettings(formId, { challengeRequired: true, misspelled: 1 });

    expect(res.status).toBe(400);
    expect((await res.json()) as ErrBody).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    const detail = (await (await get(`/forms/${formId}`)).json()) as SettingsBody;
    expect(detail.settings.challengeRequired).toBe(false);
  });

  it("names several unknown keys at once, so one round trip fixes the body", async () => {
    const res = await patchSettings(formId, { challengeRequired: true, alpha: 1, beta: 2 });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrBody;
    expect(body.error.details?.issues?.[0]?.keys).toEqual(["alpha", "beta"]);
  });

  it("still accepts an open map keyed by whatever the caller sent", async () => {
    // `answers` keys are the caller's own data, so closing the map would refuse data
    // rather than a mistake.
    const definition = formDefinition(formId, [["stp_only", []]], []);
    const res = await bench(formId, {
      definition,
      ruleId: "rul_absent",
      answers: { "an id no schema declares": 1, q_another: "text" },
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as BenchBody).outcome).toBe("unavailable");
  });

  it("refuses an unknown key on the body that wraps the open map", async () => {
    const definition = formDefinition(formId, [["stp_only", []]], []);
    const res = await bench(formId, { definition, ruleId: "rul_absent", answers: {}, extra: true });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrBody;
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.message).toContain('"extra"');
  });
});

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

    // Publishing consumed the draft; the rest of the block needs one.
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
    // The admin's copy for this code promises "the reasons are listed below", so a
    // rejection with no reason would render an empty list.
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
    const before = await outboxRowsInEveryEnvironment();
    await preview(formId, { definition, answers: { q_preview_choice: "opt_yes" } });
    expect(await outboxRowsInEveryEnvironment()).toBe(before);

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

async function seedPublishedMulti(id: string, optionIds: readonly string[]): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition({
    questionId: id,
    type: "multiChoice",
    label: { en: id },
    options: optionIds.map((optionId) => ({ optionId, label: { en: optionId } })),
  });
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: id.replace(/_/g, "-"),
  });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}

function repeatDefinition(
  formId: string,
  rules: readonly unknown[],
  max: number | null = 9,
): Record<string, unknown> {
  return {
    formId,
    defaultLocale: "en",
    title: { en: "Booking" },
    steps: [
      {
        stepId: "stp_trip",
        title: { en: "Trip" },
        items: [{ questionId: "q_rp_trip", version: 1 }],
      },
      {
        stepId: "stp_travellers",
        title: { en: "Travellers" },
        items: [
          {
            groupId: "grp_rp_passengers",
            label: { en: "Passengers" },
            instanceLabel: { en: "Passenger {n}" },
            items: [
              { questionId: "q_rp_passport", version: 1 },
              { questionId: "q_rp_fare", version: 1 },
            ],
            count: max === null ? { source: "open", min: 1 } : { source: "open", min: 1, max },
            presentation: "stacked",
          },
        ],
      },
      {
        stepId: "stp_declaration",
        title: { en: "Declaration" },
        items: [{ questionId: "q_rp_declaration", version: 1 }],
      },
    ],
    rules,
  };
}

interface RepeatBenchBody extends BenchBody {
  rosters: { groupId: string; instances: string[] }[];
  targetGroupId?: string;
  instanceOutcomes?: { instanceId: string; outcome: "match" | "noMatch" }[];
}

interface RepeatPreviewBody extends PreviewBody {
  flow: {
    visibleSteps: string[];
    visibleQuestions: string[];
    complete: boolean;
    rosters: { groupId: string; instances: string[] }[];
  };
}

describe("the admin preview routes with a repeating group (074)", () => {
  const formId = "frm_repeat_preview";

  beforeAll(async () => {
    await seedPublishedQuestion("q_rp_trip", "Trip purpose");
    await seedPublishedQuestion("q_rp_passport", "Passport number");
    await seedPublishedQuestion("q_rp_fare", "Fare basis");
    await seedPublishedQuestion("q_rp_declaration", "Declaration");
    // A question is pinned at most once per form, so the cross-group case needs a member
    // of its own rather than borrowing one from the first group.
    await seedPublishedQuestion("q_rp_bag_tag", "Bag tag");
    await post("/forms", { formId, slug: "repeat-preview", defaultLocale: "en" });
    await put(`/forms/${formId}/draft`, { definition: repeatDefinition(formId, []) });
  }, CONTAINER_BOOT_TIMEOUT_MS);

  const everyRule = {
    ruleId: "rul_rp_every",
    when: {
      op: "everyInstance",
      groupId: "grp_rp_passengers",
      condition: { op: "answered", questionId: "q_rp_passport" },
    },
    show: ["q_rp_declaration"],
  };
  const notAnyRule = {
    ruleId: "rul_rp_every",
    when: {
      op: "not",
      condition: {
        op: "anyInstance",
        groupId: "grp_rp_passengers",
        condition: { op: "not", condition: { op: "answered", questionId: "q_rp_passport" } },
      },
    },
    show: ["q_rp_declaration"],
  };

  it("evaluates a whole-group rule at ZERO instances, where everyInstance is false", async () => {
    const res = await bench(formId, {
      definition: repeatDefinition(formId, [everyRule]),
      ruleId: "rul_rp_every",
      answers: {},
      instances: { grp_rp_passengers: [] },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as RepeatBenchBody;
    expect(body.outcome).toBe("noMatch");
    expect(body.rosters).toStrictEqual([{ groupId: "grp_rp_passengers", instances: [] }]);
    expect(body.targetGroupId).toBeUndefined();
    expect(body.instanceOutcomes).toBeUndefined();
  });

  it("is NOT the same as not(anyInstance(not c)) over that empty group, which is the ruling", async () => {
    const res = await bench(formId, {
      definition: repeatDefinition(formId, [notAnyRule]),
      ruleId: "rul_rp_every",
      answers: {},
      instances: { grp_rp_passengers: [] },
    });

    // The two are equivalent only when at least one instance is live, so neither may be
    // treated as a rewrite of the other.
    expect(((await res.json()) as RepeatBenchBody).outcome).toBe("match");
  });

  it("matches `everyInstance` once every live instance answers, and not before", async () => {
    const instances = { grp_rp_passengers: ["ins_g1_1", "ins_g1_2"] };
    const partial = await bench(formId, {
      definition: repeatDefinition(formId, [everyRule]),
      ruleId: "rul_rp_every",
      answers: { "ins_g1_1/q_rp_passport": "PA1" },
      instances,
    });
    expect(((await partial.json()) as RepeatBenchBody).outcome).toBe("noMatch");

    const all = await bench(formId, {
      definition: repeatDefinition(formId, [everyRule]),
      ruleId: "rul_rp_every",
      answers: { "ins_g1_1/q_rp_passport": "PA1", "ins_g1_2/q_rp_passport": "PA2" },
      instances,
    });
    const body = (await all.json()) as RepeatBenchBody;
    expect(body.outcome).toBe("match");
    expect(body.rosters).toStrictEqual([
      { groupId: "grp_rp_passengers", instances: ["ins_g1_1", "ins_g1_2"] },
    ]);
  });

  it("reports one verdict per instance for a rule whose target is inside the group", async () => {
    const perInstance = {
      ruleId: "rul_rp_fare",
      when: { op: "answered", questionId: "q_rp_passport" },
      show: ["q_rp_fare"],
    };
    const res = await bench(formId, {
      definition: repeatDefinition(formId, [perInstance]),
      ruleId: "rul_rp_fare",
      answers: { "ins_g1_2/q_rp_passport": "PA2" },
      instances: { grp_rp_passengers: ["ins_g1_1", "ins_g1_2", "ins_g1_3"] },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as RepeatBenchBody;
    // Scope is implicit by position: the target sits inside the group, so each instance
    // resolves the answer to its own value.
    expect(body.targetGroupId).toBe("grp_rp_passengers");
    expect(body.instanceOutcomes).toStrictEqual([
      { instanceId: "ins_g1_1", outcome: "noMatch" },
      { instanceId: "ins_g1_2", outcome: "match" },
      { instanceId: "ins_g1_3", outcome: "noMatch" },
    ]);
    expect(body.outcome, "the rule's own answer is match when any instance matched").toBe("match");
  });

  it("reports an EMPTY instance list for a per-instance rule with no instance", async () => {
    const perInstance = {
      ruleId: "rul_rp_fare",
      when: { op: "answered", questionId: "q_rp_passport" },
      show: ["q_rp_fare"],
    };
    const res = await bench(formId, {
      definition: repeatDefinition(formId, [perInstance]),
      ruleId: "rul_rp_fare",
      answers: {},
      instances: { grp_rp_passengers: [] },
    });

    const body = (await res.json()) as RepeatBenchBody;
    // Empty rather than absent: absent means the rule is not per-instance at all.
    expect(body.targetGroupId).toBe("grp_rp_passengers");
    expect(body.instanceOutcomes).toStrictEqual([]);
    expect(body.outcome).toBe("noMatch");
  });

  it("truncates the asked-for roster at the author's own declared maximum", async () => {
    const res = await bench(formId, {
      definition: repeatDefinition(formId, [everyRule], 2),
      ruleId: "rul_rp_every",
      answers: {},
      instances: { grp_rp_passengers: ["ins_g1_1", "ins_g1_2", "ins_g1_3", "ins_g1_1"] },
    });

    expect(((await res.json()) as RepeatBenchBody).rosters).toStrictEqual([
      { groupId: "grp_rp_passengers", instances: ["ins_g1_1", "ins_g1_2"] },
    ]);
  });

  it("truncates a group whose author has not declared a maximum at the preview cap", async () => {
    // With no declared `max`, nothing but this cap bounds the caller's instance list, so one
    // authenticated request could be evaluated against any number of instances (SEC-16).
    const res = await bench(formId, {
      definition: repeatDefinition(formId, [everyRule], null),
      ruleId: "rul_rp_every",
      answers: {},
      instances: {
        grp_rp_passengers: Array.from({ length: 200 }, (_entry, at) => `ins_c${String(at + 1)}`),
      },
    });

    expect(res.status).toBe(200);
    const roster = ((await res.json()) as RepeatBenchBody).rosters[0];
    expect(roster?.groupId).toBe("grp_rp_passengers");
    expect(roster?.instances).toHaveLength(50);
    expect(roster?.instances[0], "the cap truncates the tail, keeping roster order").toBe("ins_c1");
    expect(roster?.instances.at(-1)).toBe("ins_c50");
  });

  it("bounds a cross-group rule over two groups that declare no maximum", async () => {
    // `REPEAT_EVALUATION_BUDGET` is checked at publish against declared maxima only, and
    // neither preview route runs `analyzeRuleGraph`, so the per-request cap is the only
    // bound on the product of two unbounded rosters.
    const definition = repeatDefinition(formId, [], null);
    const steps = [...(definition["steps"] as Record<string, unknown>[])];
    steps.splice(2, 0, {
      stepId: "stp_bags",
      title: { en: "Bags" },
      items: [
        {
          groupId: "grp_rp_bags",
          label: { en: "Bags" },
          instanceLabel: { en: "Bag {n}" },
          items: [{ questionId: "q_rp_bag_tag", version: 1 }],
          count: { source: "open", min: 0 },
          presentation: "stacked",
        },
      ],
    });
    const crossGroup = {
      ...definition,
      steps,
      rules: [
        {
          ruleId: "rul_rp_cross",
          when: {
            op: "anyInstance",
            groupId: "grp_rp_passengers",
            condition: { op: "answered", questionId: "q_rp_passport" },
          },
          show: ["q_rp_bag_tag"],
        },
      ],
    };
    const asked = (prefix: string) =>
      Array.from({ length: 400 }, (_entry, at) => `ins_${prefix}${String(at + 1)}`);

    const res = await bench(formId, {
      definition: crossGroup,
      ruleId: "rul_rp_cross",
      answers: {},
      instances: { grp_rp_passengers: asked("p"), grp_rp_bags: asked("b") },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as RepeatBenchBody;
    for (const roster of body.rosters) {
      expect(roster.instances, `group ${roster.groupId}`).toHaveLength(50);
    }
    expect(body.outcome).toBe("noMatch");
    expect(body.targetGroupId).toBe("grp_rp_bags");
    expect(body.instanceOutcomes).toHaveLength(50);
  });

  it("ignores an instance id that is not well formed, and a group the form does not declare", async () => {
    const res = await bench(formId, {
      definition: repeatDefinition(formId, [everyRule]),
      ruleId: "rul_rp_every",
      answers: {},
      instances: { grp_rp_passengers: ["not-an-id", "ins_g1_1"], grp_nowhere: ["ins_x1"] },
    });

    const body = (await res.json()) as RepeatBenchBody;
    expect(body.rosters).toStrictEqual([{ groupId: "grp_rp_passengers", instances: ["ins_g1_1"] }]);
  });

  it("projects the preview's visible set as ANSWER KEYS, and echoes the roster it used", async () => {
    const res = await preview(formId, {
      definition: repeatDefinition(formId, []),
      answers: {},
      instances: { grp_rp_passengers: ["ins_p1", "ins_p2"] },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as RepeatPreviewBody;
    expect(body.flow.rosters).toStrictEqual([
      { groupId: "grp_rp_passengers", instances: ["ins_p1", "ins_p2"] },
    ]);
    expect(body.flow.visibleQuestions).toContain("q_rp_trip");
    expect(body.flow.visibleQuestions).toContain("ins_p1/q_rp_passport");
    expect(body.flow.visibleQuestions).toContain("ins_p2/q_rp_passport");
    expect(body.flow.visibleQuestions).not.toContain("q_rp_passport");
  });

  it("reads a per-instance answer only for the instance it names", async () => {
    const perInstance = {
      ruleId: "rul_rp_fare",
      when: { op: "answered", questionId: "q_rp_passport" },
      show: ["q_rp_fare"],
    };
    const res = await preview(formId, {
      definition: repeatDefinition(formId, [perInstance]),
      answers: { "ins_p1/q_rp_passport": "PA1" },
      instances: { grp_rp_passengers: ["ins_p1", "ins_p2"] },
    });

    const visible = ((await res.json()) as RepeatPreviewBody).flow.visibleQuestions;
    expect(visible).toContain("ins_p1/q_rp_fare");
    expect(visible, "the second instance answered nothing, so its fare stays hidden").not.toContain(
      "ins_p2/q_rp_fare",
    );
  });

  it("drops an answer keyed for an instance the roster does not hold", async () => {
    const perInstance = {
      ruleId: "rul_rp_fare",
      when: { op: "answered", questionId: "q_rp_passport" },
      show: ["q_rp_fare"],
    };
    const res = await preview(formId, {
      definition: repeatDefinition(formId, [perInstance]),
      answers: { "ins_p9/q_rp_passport": "PA9" },
      instances: { grp_rp_passengers: ["ins_p1"] },
    });

    // The same "is this instance live" precondition SEC-16 puts on every real answer write.
    expect(((await res.json()) as RepeatPreviewBody).flow.visibleQuestions).not.toContain(
      "ins_p1/q_rp_fare",
    );
  });

  it("previews a group with no instance at all without refusing the request", async () => {
    const res = await preview(formId, {
      definition: repeatDefinition(formId, []),
      answers: {},
      instances: { grp_rp_passengers: [] },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as RepeatPreviewBody;
    expect(body.flow.rosters).toStrictEqual([{ groupId: "grp_rp_passengers", instances: [] }]);
    expect(body.documents.map((document) => document.stepId)).toContain("stp_travellers");
  });

  it("previews with no `instances` key at all, as the pane's first render does", async () => {
    const res = await preview(formId, { definition: repeatDefinition(formId, []) });

    expect(res.status).toBe(200);
    expect(((await res.json()) as RepeatPreviewBody).flow.rosters).toStrictEqual([
      { groupId: "grp_rp_passengers", instances: [] },
    ]);
  });
});

describe("publish warnings reach the author without blocking a publish (#123)", () => {
  const formId = "frm_warn";
  const layout: [string, string[]][] = [
    ["stp_warn_one", ["q_warn_multi", "q_warn_detail"]],
    ["stp_warn_two", ["q_warn_later"]],
  ];
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
    // A whitespace-only title: the schema accepts it and the publish gate refuses it.
    const broken = formDefinition(formId, layout, [sameStepRule], "   ");
    const res = await post(`/forms/${formId}/draft/validate`, { definition: broken });
    const body = (await res.json()) as { valid: boolean; issues: Issue[]; warnings: Issue[] };

    expect(body.valid).toBe(false);
    expect(body.issues.map((issue) => issue.code)).toContain("BLANK_LOCALIZED_TEXT");
    expect(body.warnings).toEqual([]);
  });

  it("a DEPRECATED_PIN issue and a warning coexist, and both are reported", async () => {
    // `DEPRECATED_PIN` is raised by this layer rather than by `compileDraft`, so it can
    // stand beside a kernel advisory about the same draft.
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

    expect(body.issues.map((issue) => issue.code)).toContain("DEPRECATED_PIN");
    expect(body.warnings.map((warning) => warning.code)).toEqual(["MULTICHOICE_SAME_STEP_TARGET"]);
    expect(body.issues.every((issue) => issue.code === "DEPRECATED_PIN")).toBe(true);
    expect(body.valid).toBe(false);
  });

  it("a warned draft publishes: a warning never refuses (#123)", async () => {
    await put(`/forms/${formId}/draft`, { definition: sameStep });
    const res = await post(`/forms/${formId}/publish`);

    expect(res.status).toBe(200);
    expect((await res.json()) as { version: number }).toMatchObject({ version: 1 });
  });
});

describe("admin schema refusals and out-of-range versions", () => {
  const formId = "frm_envelope";

  beforeAll(async () => {
    await post("/forms", { formId, slug: "envelope", defaultLocale: "en" });
  });

  it("renders a route-schema refusal as the documented ErrorEnvelope (#182)", async () => {
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
    // One past the `form_versions.version` column's int4 ceiling.
    const over = await get(`/forms/${formId}/versions/2147483648`);
    expect(over.status).toBe(404);
    expect(((await over.json()) as ErrBody).error.code).toBe("VERSION_NOT_FOUND");

    const inRange = await get(`/forms/${formId}/versions/2147483647`);
    expect(inRange.status).toBe(404);
    expect(((await inRange.json()) as ErrBody).error.code).toBe("VERSION_NOT_FOUND");
  });
});

describe("GET /admin/forms - search, status filter and sort", () => {
  // The suite shares one database, so every assertion here is scoped by a slug prefix
  // this block owns.
  const SCOPE = "search=lst-";

  // A clock advancing a second per read, so two publishes carry distinct `published_at`. A
  // second, not a minute, because the clock also decides whether the admin session is live.
  let listApp: ReturnType<typeof createApp>;

  async function listGet(path: string): Promise<Response> {
    return listApp.request(`/admin${path}`, { headers: authHeaders() });
  }

  async function listPost(path: string, body?: unknown): Promise<Response> {
    return listApp.request(`/admin${path}`, {
      method: "POST",
      headers: authHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  beforeAll(async () => {
    let ms = new Date("2026-07-20T00:00:00.000Z").getTime();
    listApp = createApp(
      makeDeps({
        db: testDb.db,
        // The file-level app's own config: `validEnv()` generates its secrets per call,
        // so a second one would issue a different internal token and 401 every request.
        config: deps.config,
        clock: {
          now: () => {
            ms += 1_000;
            return new Date(ms);
          },
        },
      }),
      ADMIN_ONLY,
      { groups: { admin: [registerAdminAuth, registerGrantCheck, registerForms] } },
    );

    await seedPublishedQuestion("q_lst_one", "One");

    for (const [id, slug, title] of [
      ["frm_lst_alpha", "lst-alpha", "Alpha zebra"],
      ["frm_lst_bravo", "lst-bravo", "Bravo quokka"],
      ["frm_lst_charlie", "lst-charlie", "Charlie zebra"],
    ] as const) {
      expect((await listPost("/forms", { formId: id, slug, defaultLocale: "en" })).status).toBe(
        201,
      );
      const definition = formDefinition(id, [["stp_one", ["q_lst_one"]]], [], title);
      expect((await put(`/forms/${id}/draft`, { definition })).status).toBe(200);
    }

    // Alpha publishes first and charlie never publishes, so the date sorts below have a
    // fixed order and one row with no date.
    expect((await listPost("/forms/frm_lst_alpha/publish")).status).toBe(200);
    // Bravo also releases, because the closed state lives on the release row: there is
    // no intake to close in an environment nothing is released to.
    expect(
      (
        await listPost("/forms/frm_lst_bravo/publish-and-release", {
          environment: "test",
        })
      ).status,
    ).toBe(200);
    await insertFormRelease(testDb.db, {
      formId: FormId.parse("frm_lst_bravo"),
      environment: DEFAULT_TEST_ENVIRONMENT,
      version: 1,
      releasedBy: "list-fixture",
    });
    expect(
      (await listPost("/forms/frm_lst_bravo/close", { environment: DEFAULT_TEST_ENVIRONMENT }))
        .status,
    ).toBe(200);
  }, 60_000);

  async function slugs(query: string): Promise<string[]> {
    const res = await listGet(`/forms?${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { forms: { slug: string }[] }).forms.map((form) => form.slug);
  }

  it("searches the slug", async () => {
    expect(await slugs("search=lst-alpha")).toEqual(["lst-alpha"]);
  });

  it("searches any locale of the form title, case-insensitively", async () => {
    expect(await slugs("search=QUOKKA")).toEqual(["lst-bravo"]);
  });

  it("answers an empty library rather than an error when nothing matches", async () => {
    expect(await slugs("search=lst-nothing-matches-this")).toEqual([]);
  });

  it("filters by the request environment's lifecycle status", async () => {
    expect(await slugs(`${SCOPE}&status=closed`)).toEqual(["lst-bravo"]);
    expect(await slugs(`${SCOPE}&status=open`)).toEqual(["lst-alpha", "lst-charlie"]);
  });

  it("orders by slug in both directions, and slug ascending is the default", async () => {
    expect(await slugs(SCOPE)).toEqual(["lst-alpha", "lst-bravo", "lst-charlie"]);
    expect(await slugs(`${SCOPE}&sort=slug-asc`)).toEqual([
      "lst-alpha",
      "lst-bravo",
      "lst-charlie",
    ]);
    expect(await slugs(`${SCOPE}&sort=slug-desc`)).toEqual([
      "lst-charlie",
      "lst-bravo",
      "lst-alpha",
    ]);
  });

  it("orders by publish date, with a never-published form last in both directions", async () => {
    expect(await slugs(`${SCOPE}&sort=published-desc`)).toEqual([
      "lst-bravo",
      "lst-alpha",
      "lst-charlie",
    ]);
    expect(await slugs(`${SCOPE}&sort=published-asc`)).toEqual([
      "lst-alpha",
      "lst-bravo",
      "lst-charlie",
    ]);
  });

  it("applies the three together", async () => {
    expect(await slugs(`search=zebra&status=open&sort=slug-desc`)).toEqual([
      "lst-charlie",
      "lst-alpha",
    ]);
  });

  it.each([
    ["an unknown status", "status=archived"],
    ["an unknown sort key", "sort=oldest"],
    ["a search term past the length bound", `search=${"x".repeat(201)}`],
  ])("400s %s before the handler runs", async (_name, query) => {
    expect((await listGet(`/forms?${query}`)).status).toBe(400);
  });
});
