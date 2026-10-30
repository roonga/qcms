import { parseQuestionDefinition, QuestionId, stepQuestionRefs } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createQuestion,
  createQuestionVersion,
  getDraft,
  listQuestionVersions,
  publishQuestionVersion,
} from "@roonga/qcms-db";
import { startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { MockLanguageModelV3 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  internalTokenFor,
  makeDeps,
  recordingLogger,
  seedAdminSession,
  validEnv,
} from "../../test-support.js";
import { registerForms } from "../forms/route.js";
import { aiSdkDraftAssistant } from "./assistant.js";
import { fakeAssistantModel } from "./fake-model.js";
import { SCREEN_IDS } from "./screens.js";
import { AGENT_TOOL_NAMES } from "./tools/registry.js";
import { registerFormsAssist } from "./route.js";
import type { AssistEvent } from "./types.js";

const BOOT_TIMEOUT = 120_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

const SENTINEL = "RESPONDENT-ONLY-SENTINEL-VALUE";

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let adminSessionToken: string;
let adminUserId: string;
let logLines: Record<string, unknown>[];
let providerCalls: unknown[];

beforeAll(async () => {
  testDb = await startTestDb();

  const scripted = fakeAssistantModel();
  providerCalls = [];
  const recordingModel = new MockLanguageModelV3({
    provider: "qcms-fake",
    modelId: "qcms-fake-assistant",
    doStream: (options) => {
      providerCalls.push(options);
      return scripted.doStream(options);
    },
  });

  const recorder = recordingLogger();
  logLines = recorder.lines;

  deps = makeDeps({
    db: testDb.db,
    env: validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }),
    logger: recorder.logger,
    draftAssistant: aiSdkDraftAssistant({
      model: recordingModel,
      providerId: "fake",
      logger: recorder.logger,
    }),
  });
  app = createApp(deps, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerGrantCheck, registerForms, registerFormsAssist] },
  });
  internalToken = internalTokenFor(deps.config);
  const seeded = await seedAdminSession(testDb.db);
  adminSessionToken = seeded.token;
  adminUserId = seeded.userId;
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

function authHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
  };
}

/** The one per-principal key both turn routes share (Q19), cleared between fixtures. */
async function resetLimiter(): Promise<void> {
  await deps.rateLimitStore.reset(`rl:agent-assist:${adminUserId}`);
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
    slug: id.replace(/_/g, "-"),
  });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}

function draftFor(formId: string, questionIds: readonly string[]): Record<string, unknown> {
  return {
    formId,
    defaultLocale: "en",
    title: { en: "Vehicle insurance quote" },
    steps: [
      {
        stepId: "stp_start",
        title: { en: "Start" },
        items: questionIds.map((questionId) => ({ questionId, version: 1 })),
      },
    ],
    rules: [],
  };
}

async function seedForm(formId: string, questionIds: readonly string[]): Promise<string> {
  await post("/forms", { formId, slug: formId.replace("frm_", ""), defaultLocale: "en" });
  const res = await put(`/forms/${formId}/draft`, { definition: draftFor(formId, questionIds) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { updatedAt: string }).updatedAt;
}

async function readEvents(res: Response): Promise<AssistEvent[]> {
  const body = await res.text();
  return body
    .split("\n\n")
    .map((chunk) => chunk.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice("data: ".length)) as AssistEvent);
}

async function assist(formId: string, message: string, clientState?: string): Promise<Response> {
  return post(`/forms/${formId}/draft/assist`, {
    conversation: [{ role: "user", content: message }],
    ...(clientState === undefined ? {} : { clientState }),
  });
}

describe("the assist slice over HTTP", () => {
  it(
    "proposes a validated draft, and no respondent answer reaches the provider",
    async () => {
      await seedPublishedQuestion("q_at_fault", "At-fault accident");
      await seedPublishedQuestion("q_accident_detail", "Accident detail");
      await seedForm("frm_assist", ["q_at_fault"]);

      // The form is published first so a session can pin a version, then a new draft is
      // opened for the agent to work against.
      expect((await post("/forms/frm_assist/publish")).status).toBe(200);
      await testDb.client.query(
        `insert into sessions (session_id, form_id, form_version, access_mode, environment, expires_at)
         values ('ses_pii', 'frm_assist', 1, 'anonymous', 'prod', now() + interval '1 hour')`,
      );
      await testDb.client.query(
        `insert into answers (session_id, question_id, value) values ('ses_pii', 'q_at_fault', $1::jsonb)`,
        [JSON.stringify(SENTINEL)],
      );
      await put(`/forms/frm_assist/draft`, { definition: draftFor("frm_assist", ["q_at_fault"]) });

      const stored = await testDb.client.query(
        `select count(*)::int as n from answers where value::text like $1`,
        [`%${SENTINEL}%`],
      );
      // The sentinel is reachable, so the boundary assertion below is not about an
      // empty database.
      expect((stored.rows[0] as { n: number }).n).toBe(1);

      const before = providerCalls.length;
      const res = await assist("frm_assist", "a vehicle-insurance quote with a follow-up");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const events = await readEvents(res);
      const proposal = events.find((e) => e.type === "proposal");
      expect(proposal, JSON.stringify(events)).toBeDefined();
      if (proposal?.type !== "proposal") throw new Error("unreachable");
      expect(proposal.proposal.proposedDraft.formId).toBe("frm_assist");
      expect(proposal.proposal.issues).toEqual([]);

      expect(providerCalls.length).toBeGreaterThan(before);
      expect(JSON.stringify(providerCalls)).not.toContain(SENTINEL);
    },
    BOOT_TIMEOUT,
  );

  it(
    "offers the newest PUBLISHED version of a question, not the newest overall",
    async () => {
      const questionId = QuestionId.parse("q_versions_only");
      const parsed = parseQuestionDefinition({
        questionId: "q_versions_only",
        type: "shortText",
        label: { en: "Versioned" },
      });
      if (!parsed.ok) throw new Error("fixture question did not parse");
      await createQuestion(testDb.db, {
        workspaceId: SEED_WORKSPACE_ID,
        questionId,
        slug: "versions-only",
      });
      for (const version of [1, 2, 3]) {
        await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
        if (version < 3) await publishQuestionVersion(testDb.db, { questionId, version });
      }
      const rows = await listQuestionVersions(testDb.db, questionId);
      expect(rows.map((r) => `${String(r.version)}:${r.status}`)).toEqual([
        "1:published",
        "2:published",
        "3:draft",
      ]);

      await seedForm("frm_versions", ["q_versions_only"]);
      const res = await assist("frm_versions", "reuse it #qcms-fake-search:versions-only");
      const events = await readEvents(res);
      const proposal = events.find((e) => e.type === "proposal");
      if (proposal?.type !== "proposal") throw new Error(JSON.stringify(events));

      const step = proposal.proposal.proposedDraft.steps[0];
      const pinned = step === undefined ? undefined : stepQuestionRefs(step)[0];
      expect(pinned?.questionId).toBe("q_versions_only");
      expect(pinned?.version).toBe(2);
    },
    BOOT_TIMEOUT,
  );

  it(
    "refuses a rogue publish attempt, logs it, and publishes nothing",
    async () => {
      await seedPublishedQuestion("q_rogue", "Rogue");
      await seedForm("frm_rogue", ["q_rogue"]);

      const res = await assist("frm_rogue", "#qcms-fake:rogue-publish ship it");
      expect(res.status).toBe(200);

      const events = await readEvents(res);
      expect(events.find((e) => e.type === "tool-rejected")).toEqual({
        type: "tool-rejected",
        tool: "publish_form",
      });
      expect(events.filter((e) => e.type === "proposal")).toHaveLength(0);
      expect(JSON.stringify(logLines)).toContain("draft assistant tool call rejected");

      const versions = await testDb.client.query(
        `select count(*)::int as n from form_versions where form_id = 'frm_rogue'`,
      );
      expect((versions.rows[0] as { n: number }).n).toBe(0);
      expect(await getDraft(testDb.db, "frm_rogue" as never)).toBeDefined();
    },
    BOOT_TIMEOUT,
  );

  it(
    "attaches the server's advisory issues when the proposal is not publishable",
    async () => {
      await seedPublishedQuestion("q_issue_a", "A");
      await seedForm("frm_issues", ["q_issue_a"]);

      const res = await put(`/forms/frm_issues/draft`, {
        definition: {
          ...draftFor("frm_issues", ["q_issue_a"]),
          rules: [
            {
              ruleId: "rul_backward",
              when: { op: "answered", questionId: "q_issue_a" },
              show: ["stp_start"],
            },
          ],
        },
      });
      const saved = (await res.json()) as { issues: { code: string }[] };
      expect(saved.issues.map((i) => i.code)).toContain("RULE_BACKWARD_TARGET");
    },
    BOOT_TIMEOUT,
  );

  it(
    "works against the seeded draft after a publish removed the open one",
    async () => {
      await seedPublishedQuestion("q_seeded", "Seeded");
      await seedForm("frm_seeded", ["q_seeded"]);
      expect((await post("/forms/frm_seeded/publish")).status).toBe(200);
      // Publish removes the open draft; the builder then shows one seeded from v1.
      expect(await getDraft(testDb.db, "frm_seeded" as never)).toBeUndefined();

      const res = await assist("frm_seeded", "add a follow-up");
      expect(res.status).toBe(200);
      const events = await readEvents(res);
      expect(events.find((e) => e.type === "proposal")).toBeDefined();
    },
    BOOT_TIMEOUT,
  );

  it(
    "404s for a form that has neither a draft nor a published version",
    async () => {
      await post("/forms", { formId: "frm_empty", slug: "empty", defaultLocale: "en" });
      await testDb.client.query(`delete from form_drafts where form_id = 'frm_empty'`);
      const res = await assist("frm_empty", "hello");
      expect(res.status).toBe(404);
    },
    BOOT_TIMEOUT,
  );

  it(
    "refuses a turn whose client state token is stale",
    async () => {
      await seedPublishedQuestion("q_stale", "Stale");
      await seedForm("frm_stale", ["q_stale"]);

      const fresh = await assist("frm_stale", "hello", "1999-01-01T00:00:00.000Z");
      expect(fresh.status).toBe(409);
    },
    BOOT_TIMEOUT,
  );

  it(
    "marks a draft as agent-assisted when a proposal is accepted, and keeps the mark",
    async () => {
      await seedPublishedQuestion("q_prov", "Provenance");
      await seedForm("frm_prov", ["q_prov"]);

      const accepted = await put(`/forms/frm_prov/draft`, {
        definition: draftFor("frm_prov", ["q_prov"]),
        agentAssisted: true,
      });
      expect((await accepted.json()) as { agentAssisted: boolean }).toMatchObject({
        agentAssisted: true,
      });

      const plain = await put(`/forms/frm_prov/draft`, {
        definition: draftFor("frm_prov", ["q_prov"]),
      });
      expect((await plain.json()) as { agentAssisted: boolean }).toMatchObject({
        agentAssisted: true,
      });

      const detail = await app.request(`/admin/forms/frm_prov`, { headers: authHeaders() });
      expect((await detail.json()) as { draftAgentAssisted: boolean }).toMatchObject({
        draftAgentAssisted: true,
      });
    },
    BOOT_TIMEOUT,
  );
});

describe("accepting a proposal with new questions", () => {
  function questionDefinition(id: string, label: string): Record<string, unknown> {
    return { questionId: id, type: "shortText", label: { en: label } };
  }

  async function accept(
    formId: string,
    questionIds: readonly string[],
    newQuestions: readonly unknown[],
  ): Promise<Response> {
    return post(`/forms/${formId}/draft/assist/accept`, {
      definition: draftFor(formId, questionIds),
      newQuestions,
    });
  }

  function refusalLines(): Record<string, unknown>[] {
    return logLines.filter((line) => line["msg"] === "agent proposal refused");
  }

  async function storedVersions(id: string): Promise<{ version: number; status: string }[]> {
    const rows = await listQuestionVersions(testDb.db, QuestionId.parse(id));
    return rows.map((row) => ({ version: row.version, status: row.status }));
  }

  it(
    "creates exactly the proposed questions as unpublished drafts, and stores the draft that pins them",
    async () => {
      await post("/forms", { formId: "frm_new_q", slug: "new-q", defaultLocale: "en" });

      const res = await accept(
        "frm_new_q",
        ["q_first_name", "q_last_name"],
        [
          { definition: questionDefinition("q_first_name", "First name") },
          { definition: questionDefinition("q_last_name", "Last name") },
        ],
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        agentAssisted: boolean;
        createdQuestions: { questionId: string; slug: string; version: number; status: string }[];
        issues: { code: string; path?: { question?: string } }[];
      };

      expect(body.createdQuestions).toEqual([
        { questionId: "q_first_name", slug: "first-name", version: 1, status: "draft" },
        { questionId: "q_last_name", slug: "last-name", version: 1, status: "draft" },
      ]);
      expect(body.agentAssisted).toBe(true);

      expect(await storedVersions("q_first_name")).toEqual([{ version: 1, status: "draft" }]);
      expect(await storedVersions("q_last_name")).toEqual([{ version: 1, status: "draft" }]);

      expect(body.issues.filter((issue) => issue.code === "DANGLING_QUESTION_REF")).toEqual([]);
      const unpublished = body.issues
        .filter((issue) => issue.code === "UNPUBLISHED_QUESTION_PIN")
        .map((issue) => issue.path?.question);
      expect(unpublished).toEqual(["q_first_name", "q_last_name"]);

      const draft = await getDraft(testDb.db, "frm_new_q" as never);
      expect(draft?.agentAssisted).toBe(true);
    },
    BOOT_TIMEOUT,
  );

  it(
    "creates nothing when the proposal references only library questions",
    async () => {
      await seedPublishedQuestion("q_library_only", "Library only");
      await post("/forms", { formId: "frm_lib_only", slug: "lib-only", defaultLocale: "en" });

      const before = await testDb.client.query(`select count(*)::int as n from questions`);
      const res = await accept("frm_lib_only", ["q_library_only"], []);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        createdQuestions: unknown[];
        issues: { code: string }[];
      };
      expect(body.createdQuestions).toEqual([]);
      const after = await testDb.client.query(`select count(*)::int as n from questions`);
      expect(after.rows[0]).toEqual(before.rows[0]);

      expect(body.issues).toEqual([]);
    },
    BOOT_TIMEOUT,
  );

  it(
    "fails the WHOLE accept when the authoring boundary refuses a proposed definition",
    async () => {
      await seedPublishedQuestion("q_ok_pin", "Fine");
      const before = await seedForm("frm_refused", ["q_ok_pin"]);

      const res = await accept(
        "frm_refused",
        ["q_ok_pin", "q_good_one", "q_bad_pattern"],
        [
          { definition: questionDefinition("q_good_one", "Good one") },
          {
            definition: {
              ...questionDefinition("q_bad_pattern", "Bad pattern"),
              // Valid to the kernel, refused at the authoring boundary: a browser
              // compiles `pattern` with the `v` flag and drops this one.
              constraints: { pattern: "^[A-Za-z][A-Za-z .,'-]{0,99}$" },
            },
          },
        ],
      );

      expect(res.status).toBe(422);
      const body = (await res.json()) as {
        error: { code: string; message: string; details?: { questionId?: string } };
      };
      expect(body.error.code).toBe("INVALID_QUESTION_DEFINITION");
      expect(body.error.message).toContain("q_bad_pattern");
      expect(body.error.message).toContain("'v' flag");
      expect(body.error.details?.questionId).toBe("q_bad_pattern");

      expect(refusalLines().at(-1)).toMatchObject({
        formId: "frm_refused",
        questionId: "q_bad_pattern",
        reason: "INVALID_QUESTION_DEFINITION",
      });

      expect(await storedVersions("q_good_one")).toEqual([]);
      expect(await storedVersions("q_bad_pattern")).toEqual([]);
      const draft = await getDraft(testDb.db, "frm_refused" as never);
      expect(draft?.agentAssisted).toBe(false);
      expect(draft?.updatedAt.toISOString()).toBe(before);
    },
    BOOT_TIMEOUT,
  );

  it(
    "refuses a proposed id that has been used before, and creates nothing (R6)",
    async () => {
      await seedPublishedQuestion("q_taken_id", "Taken");
      await post("/forms", { formId: "frm_reuse", slug: "reuse", defaultLocale: "en" });

      const res = await accept(
        "frm_reuse",
        ["q_taken_id", "q_fresh_one"],
        [
          { definition: questionDefinition("q_fresh_one", "Fresh") },
          { definition: questionDefinition("q_taken_id", "Reused") },
        ],
      );

      expect(res.status).toBe(409);
      expect((await res.json()) as { error: { code: string; details?: unknown } }).toMatchObject({
        error: { code: "QUESTION_ID_REUSED", details: { questionId: "q_taken_id" } },
      });
      expect(await storedVersions("q_fresh_one")).toEqual([]);
      expect(await storedVersions("q_taken_id")).toEqual([{ version: 1, status: "published" }]);

      const refusal = refusalLines().at(-1);
      expect(refusal).toMatchObject({
        formId: "frm_reuse",
        questionId: "q_taken_id",
        reason: "QUESTION_ID_REUSED",
      });
      // SEC-8: never the definition itself, on any refusal path.
      expect(JSON.stringify(refusal)).not.toContain("Reused");
    },
    BOOT_TIMEOUT,
  );
});

describe("unknown keys are refused inside a nested body object (issue #893)", () => {
  function questionDefinition(id: string, label: string): Record<string, unknown> {
    return { questionId: id, type: "shortText", label: { en: label } };
  }

  interface Envelope {
    error: {
      code: string;
      message: string;
      details?: { issues?: { code: string; path?: string; keys?: string[] }[] };
    };
  }

  it(
    "refuses an unknown key on a newQuestions entry, naming the key and its path",
    async () => {
      await post("/forms", { formId: "frm_nested_key", slug: "nested-key", defaultLocale: "en" });

      const res = await post("/forms/frm_nested_key/draft/assist/accept", {
        definition: draftFor("frm_nested_key", ["q_nested"]),
        newQuestions: [
          { definition: questionDefinition("q_nested", "Nested"), unexpectedNested: true },
        ],
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Envelope;
      expect(body.error.code).toBe("INVALID_REQUEST");
      expect(body.error.message).toContain('"unexpectedNested"');
      expect(body.error.details?.issues?.[0]).toMatchObject({
        code: "unrecognized_keys",
        path: "newQuestions.0",
        keys: ["unexpectedNested"],
      });
    },
    BOOT_TIMEOUT,
  );

  it(
    "still accepts the nested entry's own open definition map, keyed by the kernel's names",
    async () => {
      await post("/forms", { formId: "frm_nested_ok", slug: "nested-ok", defaultLocale: "en" });

      // `definition` is an opaque record the kernel owns, so its keys stay open.
      const res = await post("/forms/frm_nested_ok/draft/assist/accept", {
        definition: draftFor("frm_nested_ok", ["q_nested_ok"]),
        newQuestions: [
          { definition: questionDefinition("q_nested_ok", "Nested ok"), slug: "nested-ok-q" },
        ],
      });

      expect(res.status).toBe(200);
    },
    BOOT_TIMEOUT,
  );
});

describe("the assist slice when the flag is none", () => {
  it(
    "404s for an authenticated admin, because the route is not mounted",
    async () => {
      const offDeps = makeDeps({ db: testDb.db, env: validEnv() });
      const offApp = createApp(offDeps, ADMIN_ONLY, {
        groups: {
          admin: [registerAdminAuth, registerGrantCheck, registerForms, registerFormsAssist],
        },
      });
      const headers = {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(offDeps.config),
        [ADMIN_SESSION_HEADER]: adminSessionToken,
      };
      const res = await offApp.request("/admin/forms/frm_assist/draft/assist", {
        method: "POST",
        headers,
        body: JSON.stringify({ conversation: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(404);

      // Gating the mount is what keeps a default build from carrying a second way to
      // create library questions.
      const accept = await offApp.request("/admin/forms/frm_assist/draft/assist/accept", {
        method: "POST",
        headers,
        body: JSON.stringify({ definition: draftFor("frm_assist", []), newQuestions: [] }),
      });
      expect(accept.status).toBe(404);
    },
    BOOT_TIMEOUT,
  );
});

/**
 * SEC-17's two halves, against a real database: no answer value, answer-ledger row or
 * webhook payload reaches the provider from any screen, and response metadata does.
 */
describe("every screen's context, with a sentinel in the database", () => {
  const SESSION_ID = "ses_sentinel";
  const FORM_ID = "frm_sentinel";
  let screenStatuses: Map<string, number>;

  async function seedSentinelData(): Promise<void> {
    await seedPublishedQuestion("q_sentinel", "Sentinel");
    await seedForm(FORM_ID, ["q_sentinel"]);
    expect((await post(`/forms/${FORM_ID}/publish`)).status).toBe(200);
    await testDb.client.query(
      `insert into sessions (session_id, form_id, form_version, access_mode, environment, status, expires_at)
       values ($1, $2, 1, 'anonymous', 'prod', 'submitted', now() + interval '1 hour')`,
      [SESSION_ID, FORM_ID],
    );
    await testDb.client.query(
      `insert into answers (session_id, question_id, value) values ($1, 'q_sentinel', $2::jsonb)`,
      [SESSION_ID, JSON.stringify(SENTINEL)],
    );
    await testDb.client.query(
      `insert into submissions (session_id, content_hash, locked_answers)
       values ($1, 'hash_sentinel', $2::jsonb)`,
      [SESSION_ID, JSON.stringify({ q_sentinel: SENTINEL })],
    );
    // A delivery whose payload carries the sentinel: the webhook screens give state and
    // never a payload, so this is the second half of the boundary.
    await testDb.client.query(
      `insert into webhooks (webhook_id, form_id, url, secret_encrypted, active)
       values ('whk_sentinel', $1, 'https://example.test/hook?t=abc', 'enc', true)`,
      [FORM_ID],
    );
    const outbox = await testDb.client.query<{ id: string }>(
      `insert into outbox (event_type, payload) values ('response.submitted', $1::jsonb) returning id`,
      [JSON.stringify({ sessionId: SESSION_ID, answers: { q_sentinel: SENTINEL } })],
    );
    const outboxId = (outbox.rows[0] as { id: string }).id;
    await testDb.client.query(
      `insert into webhook_deliveries
         (outbox_id, webhook_id, attempts, next_attempt_at, last_error, last_status, dead_lettered_at)
       values ($1, 'whk_sentinel', 5, now(), $2, 500, now())`,
      [outboxId, `consumer said ${SENTINEL}`],
    );
  }

  function paramsFor(screen: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    if (screen.includes("[formId]")) params.formId = FORM_ID;
    if (screen.includes("[sessionId]")) params.sessionId = SESSION_ID;
    if (screen.includes("[version]")) params.version = 1;
    if (screen.includes("[questionId]")) params.questionId = "q_sentinel";
    if (screen.includes("[workspaceId]")) params.workspaceId = SEED_WORKSPACE_ID;
    return params;
  }

  beforeAll(async () => {
    await seedSentinelData();
    screenStatuses = new Map<string, number>();
    for (const screen of SCREEN_IDS) {
      // The limiter is the caller's whole budget across both routes, and this fixture
      // walks more screens than a minute allows.
      await resetLimiter();
      // `read-all` calls every tool the screen offers, so each read tool's own executor
      // runs under the sentinel rather than only the ones a narrative script needs.
      const res = await post("/assist", {
        conversation: [{ role: "user", content: "what can you see here #qcms-fake:read-all" }],
        screen,
        params: paramsFor(screen),
        conversationId: "cnv_sentinel",
      });
      screenStatuses.set(screen, res.status);
      // Drain the stream, so the turn and its provider call have completed.
      if (res.status === 200) await readEvents(res);
    }
    // Every screen in the registry runs a turn here, so this fixture is longer than one
    // boot.
  }, BOOT_TIMEOUT * 3);

  it("builds a context for every screen in the registry", () => {
    expect([...screenStatuses.entries()].filter(([, status]) => status !== 200)).toEqual([]);
  });

  it("ran every registered read tool during the walk", () => {
    const executed = new Set<string>();
    for (const call of providerCalls) {
      const prompt = (call as { prompt?: unknown }).prompt;
      if (!Array.isArray(prompt)) continue;
      for (const message of prompt as { role?: unknown; content?: unknown }[]) {
        if (message.role !== "tool" || !Array.isArray(message.content)) continue;
        for (const part of message.content as { toolName?: unknown }[]) {
          if (typeof part.toolName === "string") executed.add(part.toolName);
        }
      }
    }
    expect([...executed].sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("has the sentinel in the database, so the assertions below are not about an empty one", async () => {
    const answers = await testDb.client.query(
      `select count(*)::int as n from answers where value::text like $1`,
      [`%${SENTINEL}%`],
    );
    const payloads = await testDb.client.query(
      `select count(*)::int as n from outbox where payload::text like $1`,
      [`%${SENTINEL}%`],
    );
    expect((answers.rows[0] as { n: number }).n).toBeGreaterThan(0);
    expect((payloads.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it("sends the provider no answer value and no webhook payload, from any screen", () => {
    expect(JSON.stringify(providerCalls)).not.toContain(SENTINEL);
  });

  it("does send response metadata, so the metadata half of the rule is pinned too", () => {
    expect(JSON.stringify(providerCalls)).toContain(SESSION_ID);
  });

  it("refuses a screen id the registry does not hold", async () => {
    await resetLimiter();
    const res = await post("/assist", {
      conversation: [{ role: "user", content: "hi" }],
      screen: "/forms/[formId]/export",
      params: {},
      conversationId: "cnv_unknown",
    });
    expect(res.status).toBe(400);
  });

  it("refuses a screen outside the form subtree on the per-form route", async () => {
    await resetLimiter();
    const res = await post(`/forms/${FORM_ID}/draft/assist`, {
      conversation: [{ role: "user", content: "hi" }],
      screen: "/workspaces",
      conversationId: "cnv_outside",
    });
    expect(res.status).toBe(400);
  });

  it("writes one SEC-15 read row per conversation for each distinct filter set", async () => {
    const countRows = async (): Promise<number> => {
      const res = await testDb.client.query<{ n: number }>(
        `select count(*)::int as n from control.access_audit where kind = 'read' and form_id = $1`,
        [FORM_ID],
      );
      return (res.rows[0] as { n: number }).n;
    };
    const turn = async (conversationId: string, flagged?: boolean): Promise<void> => {
      await resetLimiter();
      const res = await post("/assist", {
        conversation: [{ role: "user", content: "how many came in" }],
        screen: "/forms/[formId]/responses",
        params: { formId: FORM_ID, ...(flagged === undefined ? {} : { filters: { flagged } }) },
        conversationId,
      });
      expect(res.status).toBe(200);
      await readEvents(res);
    };

    const start = await countRows();
    await turn("cnv_rows");
    await turn("cnv_rows");
    await turn("cnv_rows");
    // Three turns, one filter set, one row.
    expect((await countRows()) - start).toBe(1);
    // A different filter set in the same conversation is a second row.
    await turn("cnv_rows", true);
    expect((await countRows()) - start).toBe(2);
    // A new conversation on the first filter set is a third.
    await turn("cnv_rows_2");
    expect((await countRows()) - start).toBe(3);
  });
});

describe("one limiter key across every assist route (Q19)", () => {
  it(
    "counts turns on both routes against one per-principal budget",
    async () => {
      await seedPublishedQuestion("q_limit", "Limit");
      await seedForm("frm_limit", ["q_limit"]);
      await resetLimiter();
      const statuses: number[] = [];
      for (let turn = 0; turn < 11; turn += 1) {
        // Alternating routes: a second budget would let this run to eleven.
        const res =
          turn % 2 === 0
            ? await post("/forms/frm_limit/draft/assist", {
                conversation: [{ role: "user", content: "hi" }],
              })
            : await post("/assist", {
                conversation: [{ role: "user", content: "hi" }],
                screen: "/forms",
                conversationId: "cnv_limit",
              });
        statuses.push(res.status);
        if (res.status === 200) await readEvents(res);
      }
      expect(statuses.filter((status) => status === 200).length).toBe(10);
      expect(statuses.at(-1)).toBe(429);
      await resetLimiter();
    },
    BOOT_TIMEOUT,
  );
});

/**
 * A caller holding `forms.viewer` and no claim, through the real `authorize` the route
 * middleware and the context builders use. The unit tests pin the door with a stubbed
 * evaluator; this pins it with grants a workspace actually holds.
 */
describe("a reduced-grant caller over HTTP", () => {
  const FORM_ID = "frm_viewer";
  let viewer: { token: string; userId: string };
  let stranger: { token: string; userId: string };

  async function turnAs(
    caller: { token: string; userId: string },
    path: string,
    body: unknown,
  ): Promise<Response> {
    await deps.rateLimitStore.reset(`rl:agent-assist:${caller.userId}`);
    return app.request(`/admin${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalToken,
        [ADMIN_SESSION_HEADER]: caller.token,
      },
      body: JSON.stringify(body),
    });
  }

  /** Which tool each step ran, and how that step ended. */
  function outcomes(events: readonly AssistEvent[]): Map<string, string> {
    const tools = new Map<number, string>();
    const ended = new Map<string, string>();
    for (const event of events) {
      if (event.type === "status" && event.step !== undefined && event.tool !== undefined) {
        tools.set(event.step, event.tool);
      }
      if (event.type === "tool-outcome") {
        const tool = tools.get(event.step);
        if (tool !== undefined) ended.set(tool, event.outcome);
      }
    }
    return ended;
  }

  beforeAll(async () => {
    await seedPublishedQuestion("q_viewer", "Viewer");
    await seedForm(FORM_ID, ["q_viewer"]);
    viewer = await seedAdminSession(testDb.db, {
      label: "viewer",
      claim: false,
      grants: ["forms.viewer"],
      owner: false,
    });
    stranger = await seedAdminSession(testDb.db, {
      label: "stranger",
      claim: false,
      membership: false,
    });
  }, BOOT_TIMEOUT);

  it(
    "builds the builder screen's facts for a caller holding only forms.viewer",
    async () => {
      const res = await turnAs(viewer, "/assist", {
        conversation: [{ role: "user", content: "what is on this screen #qcms-fake:no-proposal" }],
        screen: "/forms/[formId]",
        params: { formId: FORM_ID },
        conversationId: "cnv_viewer_facts",
      });
      expect(res.status).toBe(200);
      const events = await readEvents(res);
      expect(events.some((event) => event.type === "text")).toBe(true);
      // The one error is the script withholding a proposal, so nothing the screen read was
      // refused for this caller.
      expect(events.flatMap((event) => (event.type === "error" ? [event.code] : []))).toEqual([
        "NO_PROPOSAL",
      ]);
      // The facts the screen built reached the provider, so this is a turn with a context
      // rather than one that answered from nothing.
      expect(JSON.stringify(providerCalls)).toContain(FORM_ID);
    },
    BOOT_TIMEOUT,
  );

  it(
    "refuses that caller every draft verb and reaches no proposal",
    async () => {
      const res = await turnAs(viewer, "/assist", {
        conversation: [{ role: "user", content: "rewrite this form #qcms-fake:read-all" }],
        screen: "/forms/[formId]",
        params: { formId: FORM_ID },
        conversationId: "cnv_viewer_verbs",
      });
      expect(res.status).toBe(200);
      const events = await readEvents(res);
      const ended = outcomes(events);
      // The read tool the viewer's grants do cover, so the three refusals below are the
      // cell and not a turn that failed before any tool ran.
      expect(ended.get("search_question_library")).toBe("done");
      expect(ended.get("propose_questions")).toBe("failed");
      expect(ended.get("propose_draft")).toBe("failed");
      expect(ended.get("validate_draft")).toBe("failed");
      expect(events.some((event) => event.type === "proposal")).toBe(false);
    },
    BOOT_TIMEOUT,
  );

  it("refuses that caller the builder's own route, which asks for form write", async () => {
    const res = await turnAs(viewer, `/forms/${FORM_ID}/draft/assist`, {
      conversation: [{ role: "user", content: "rewrite this form" }],
    });
    expect(res.status).toBe(403);
  });

  it("refuses a caller holding no grant in any workspace", async () => {
    const res = await turnAs(stranger, "/assist", {
      conversation: [{ role: "user", content: "what can you see" }],
      screen: "/forms",
      conversationId: "cnv_stranger",
    });
    expect(res.status).toBe(403);
  });
});
