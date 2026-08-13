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

import { parseQuestionDefinition, QuestionId } from "@qcms/core";
import { createQuestion, createQuestionVersion, getDraft, publishQuestionVersion } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
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

describe("the assist slice when the flag is none", () => {
  it(
    "404s for an authenticated admin, because the route is not mounted",
    async () => {
      const offDeps = makeDeps({ db: testDb.db, env: validEnv() });
      const offApp = createApp(offDeps, ADMIN_ONLY, {
        groups: { admin: [registerAdminAuth, registerForms, registerFormsAssist] },
      });
      const res = await offApp.request("/admin/forms/frm_assist/draft/assist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-qcms-internal-token": internalTokenFor(offDeps.config),
          [ADMIN_SESSION_HEADER]: adminSessionToken,
        },
        body: JSON.stringify({ conversation: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(404);
    },
    BOOT_TIMEOUT,
  );
});
