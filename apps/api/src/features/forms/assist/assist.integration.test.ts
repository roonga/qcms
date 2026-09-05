/**
 * The assist slice through HTTP, against the real kernel and a real database
 * (041). Requires Docker.
 *
 * Three things are proved here that no unit test can:
 *
 *  1. **The PII boundary.** A submitted answer exists in the database while the
 *     turn runs, and the exact bytes the provider was handed are captured and
 *     searched for it. The fixture is asserted present first, so a green here
 *     means the answer was reachable and did not travel, not that there was
 *     nothing to leak.
 *  2. **The refusal, end to end.** A scripted rogue model attempts publish over
 *     the wire; the response refuses, the log records it, and the form is still
 *     unpublished afterwards.
 *  3. **The advisory issues are the server's.** The proposal that comes back
 *     carries the same `PublishError[]` 022's validation produces.
 */

import { parseQuestionDefinition, QuestionId } from "@roonga/qcms-core";
import {
  createQuestion,
  createQuestionVersion,
  getDraft,
  listQuestionVersions,
  publishQuestionVersion,
} from "@roonga/qcms-db";
import { startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { MockLanguageModelV3 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../../middleware/admin-auth.js";
import {
  internalTokenFor,
  makeDeps,
  recordingLogger,
  seedAdminSession,
  validEnv,
} from "../../../test-support.js";
import { registerForms } from "../route.js";
import { aiSdkDraftAssistant } from "./assistant.js";
import { fakeAssistantModel } from "./fake-model.js";
import { registerFormsAssist } from "./route.js";
import type { AssistEvent } from "./types.js";

const BOOT_TIMEOUT = 120_000;
const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

/** A value that exists only inside a respondent's answer. If it turns up in a
 * provider payload, the boundary is broken. */
const SENTINEL = "RESPONDENT-ONLY-SENTINEL-VALUE";

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let adminSessionToken: string;
let logLines: Record<string, unknown>[];
/** Every call options object the provider was handed. */
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
    groups: { admin: [registerAdminAuth, registerForms, registerFormsAssist] },
  });
  internalToken = internalTokenFor(deps.config);
  adminSessionToken = (await seedAdminSession(testDb.db)).token;
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
  await createQuestion(testDb.db, { questionId, slug: id.replace(/_/g, "-") });
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

/** Create a form with a saved draft; returns the draft's state token. */
async function seedForm(formId: string, questionIds: readonly string[]): Promise<string> {
  await post("/forms", { formId, slug: formId.replace("frm_", ""), defaultLocale: "en" });
  const res = await put(`/forms/${formId}/draft`, { definition: draftFor(formId, questionIds) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { updatedAt: string }).updatedAt;
}

/** Read an SSE body back into the events it carried. */
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

      // A real respondent answer, in the same database, while the turn runs.
      // The form is published first so a session can pin a version, then a new
      // draft is opened for the agent to work against.
      expect((await post("/forms/frm_assist/publish")).status).toBe(200);
      await testDb.client.query(
        `insert into sessions (session_id, form_id, form_version, access_mode, expires_at)
         values ('ses_pii', 'frm_assist', 1, 'anonymous', now() + interval '1 hour')`,
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
      // The fixture is present: what follows is a boundary assertion, not an
      // assertion about an empty database.
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
      // The server ran 022's validation: the pinned questions are published, so
      // this proposal is clean.
      expect(proposal.proposal.issues).toEqual([]);

      // The provider was really called, and none of what it saw was the answer.
      expect(providerCalls.length).toBeGreaterThan(before);
      expect(JSON.stringify(providerCalls)).not.toContain(SENTINEL);
    },
    BOOT_TIMEOUT,
  );

  it(
    "offers the newest PUBLISHED version of a question, not the newest overall",
    async () => {
      // Three versions: v1 and v2 published, v3 still a draft. The library must
      // offer v2 - not v1 (the first row), and not v3 (the highest number, but
      // unpublishable, so pinning it would only produce a validation issue).
      const questionId = QuestionId.parse("q_versions_only");
      const parsed = parseQuestionDefinition({
        questionId: "q_versions_only",
        type: "shortText",
        label: { en: "Versioned" },
      });
      if (!parsed.ok) throw new Error("fixture question did not parse");
      await createQuestion(testDb.db, { questionId, slug: "versions-only" });
      for (const version of [1, 2, 3]) {
        await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
        if (version < 3) await publishQuestionVersion(testDb.db, { questionId, version });
      }
      // The fixture really is shaped as described, so what follows is about the
      // selection rather than about an accidentally-empty library.
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

      const pinned = proposal.proposal.proposedDraft.steps[0]?.items[0];
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

      // Nothing published, and the draft still exists untouched.
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
      // A library whose only published question is pinned by the draft, plus a
      // draft that references a question that does not exist: the proposal the
      // fake builds inherits the form identity, and validation has something to
      // say about the draft it validates.
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
      // The draft endpoint itself reports the backward target (022), which is
      // the same validation the assist slice runs.
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
      // Publish removes the open draft, and the builder then shows one seeded from
      // v1. The assistant must work against that same thing rather than 404.
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

      // A plain save afterwards must not quietly erase the provenance the human
      // is about to publish against.
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

/**
 * Accepting a proposal that carries NEW questions (issue #823).
 *
 * The defect these pin: accept used to store a draft pinning `q_first_name@1`
 * while the `questions` table stayed empty, so the builder rendered "Version not
 * found" and the assistant's promise that the warning "will resolve once the
 * question is published" named a publish step that could not be performed. What
 * accept has to produce instead is the human-publishes half of ADR-25: the
 * question drafts exist, unpublished, and the advisories say exactly that.
 */
describe("accepting a proposal with new questions", () => {
  /** A shortText definition the kernel takes and the authoring boundary allows. */
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

  /** Every refusal record the API has written so far, oldest first. */
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

      // Exactly those two, at version 1, DRAFT. Accept creates; it never publishes.
      expect(body.createdQuestions).toEqual([
        { questionId: "q_first_name", slug: "first-name", version: 1, status: "draft" },
        { questionId: "q_last_name", slug: "last-name", version: 1, status: "draft" },
      ]);
      expect(body.agentAssisted).toBe(true);

      // The rows are really there, and really unpublished.
      expect(await storedVersions("q_first_name")).toEqual([{ version: 1, status: "draft" }]);
      expect(await storedVersions("q_last_name")).toEqual([{ version: 1, status: "draft" }]);

      // The advisories now describe reality. Nothing dangles - every pin resolves to
      // a stored version - and the set of "publish this first" findings is exactly
      // the set that was created.
      expect(body.issues.filter((issue) => issue.code === "DANGLING_QUESTION_REF")).toEqual([]);
      const unpublished = body.issues
        .filter((issue) => issue.code === "UNPUBLISHED_QUESTION_PIN")
        .map((issue) => issue.path?.question);
      expect(unpublished).toEqual(["q_first_name", "q_last_name"]);

      // And the draft that pins them is stored, not merely echoed.
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

      // A pin to a published library question is clean: nothing to publish first.
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
              // compiles `pattern` with the `v` flag and drops this one (issue #53).
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
      // Which question, and why: the operator is looking at a card listing three.
      expect(body.error.message).toContain("q_bad_pattern");
      expect(body.error.message).toContain("'v' flag");
      expect(body.error.details?.questionId).toBe("q_bad_pattern");

      // The boundary refusal takes the same record, with its own `reason`.
      expect(refusalLines().at(-1)).toMatchObject({
        formId: "frm_refused",
        questionId: "q_bad_pattern",
        reason: "INVALID_QUESTION_DEFINITION",
      });

      // No half-accepted state. Neither proposed question exists - not even the one
      // that was fine - and the stored draft is untouched.
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
      // The envelope names the question, because the accept refused a list and the
      // operator is looking at a card that lists several.
      expect((await res.json()) as { error: { code: string; details?: unknown } }).toMatchObject({
        error: { code: "QUESTION_ID_REUSED", details: { questionId: "q_taken_id" } },
      });
      // One transaction: the first insert rolled back with the second's refusal.
      expect(await storedVersions("q_fresh_one")).toEqual([]);
      expect(await storedVersions("q_taken_id")).toEqual([{ version: 1, status: "published" }]);

      // Every refusal is recorded, not only the authoring-boundary one, and under the
      // same event name so the three are counted together. A refused accept is the one
      // outcome an operator cannot reconstruct from the screen: the proposal that
      // caused it is gone the moment they ask the assistant again.
      const refusal = refusalLines().at(-1);
      expect(refusal).toMatchObject({
        formId: "frm_reuse",
        questionId: "q_taken_id",
        reason: "QUESTION_ID_REUSED",
      });
      // Never the definition itself (SEC-8), on any refusal path.
      expect(JSON.stringify(refusal)).not.toContain("Reused");
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
        groups: { admin: [registerAdminAuth, registerForms, registerFormsAssist] },
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

      // Accept goes with it (issue #823). Gating the mount is what keeps a
      // default build from carrying a second way to create library questions.
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
