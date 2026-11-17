import { parseQuestionDefinition, QuestionId } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  createQuestion,
  createQuestionVersion,
  insertWorkspace,
  publishQuestionVersion,
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
import {
  disableSeededAccount,
  internalTokenFor,
  makeDeps,
  recordingLogger,
  seedAdminSession,
  validEnv,
} from "../../test-support.js";
import { registerForms } from "../forms/route.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { registerQuestions } from "../questions/route.js";
import { aiSdkDraftAssistant } from "./assistant.js";
import { EDIT_HEADER } from "./edit-provenance.js";
import { BUILDER_SCREEN } from "./edit-token.js";
import { fakeAssistantModel } from "./fake-model.js";
import { registerAgentProvenance } from "./provenance-mount.js";
import { PROPOSAL_HEADER, PROPOSAL_STEP_HEADER } from "./provenance.js";
import { registerAgentChanges, registerFormsAssist } from "./route.js";
import type { AssistEvent } from "./types.js";

/**
 * The builder's write path over HTTP (U7): a new form exists only once its card is
 * confirmed, the card names the workspace, the create and every later edit recheck the
 * caller, and the docked assistant's accept is recorded like any other agent change.
 */

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

type Caller = { token: string; userId: string };
type PlanEvent = Extract<AssistEvent, { type: "plan" }>;
type EditsEvent = Extract<AssistEvent, { type: "edits" }>;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let owner: Caller;
let viewer: Caller;
let otherWorkspace = "";
const now = new Date("2026-07-20T00:00:00.000Z");

beforeAll(async () => {
  testDb = await startTestDb();
  const recorder = recordingLogger();
  deps = makeDeps({
    db: testDb.db,
    env: validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }),
    logger: recorder.logger,
    clock: { now: () => now },
    draftAssistant: aiSdkDraftAssistant({
      model: fakeAssistantModel(),
      providerId: "fake",
      logger: recorder.logger,
    }),
  });
  app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerAgentProvenance,
        registerQuestions,
        registerForms,
        registerFormsAssist,
        registerAgentChanges,
      ],
    },
  });
  internalToken = internalTokenFor(deps.config);
  owner = await seedAdminSession(testDb.db, { label: "crt_owner", at: now });
  viewer = await seedAdminSession(testDb.db, {
    label: "crt_viewer",
    at: now,
    grants: ["forms.viewer"],
    owner: false,
  });
  const workspace = await insertWorkspace(testDb.db, {
    name: "Elsewhere",
    slug: "elsewhere",
    firstAdministratorId: owner.userId,
  });
  otherWorkspace = workspace.id;
  await seedPublishedQuestion("q_crt_name", "Your name");
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function headersFor(caller: Caller, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: caller.token,
    [REQUEST_ENVIRONMENT_HEADER]: "test",
    ...extra,
  };
}

async function seedPublishedQuestion(id: string, label: string): Promise<void> {
  const questionId = QuestionId.parse(id);
  const parsed = parseQuestionDefinition({ questionId: id, type: "shortText", label: { en: label } });
  if (!parsed.ok) throw new Error(`fixture question ${id} did not parse`);
  await createQuestion(testDb.db, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: id.replaceAll("_", "-"),
  });
  await createQuestionVersion(testDb.db, { questionId, definition: parsed.value });
  await publishQuestionVersion(testDb.db, { questionId, version: 1 });
}

async function readEvents(res: Response): Promise<AssistEvent[]> {
  const body = await res.text();
  return body
    .split("\n\n")
    .map((chunk) => chunk.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => line !== undefined)
    .map((line) => JSON.parse(line.slice("data: ".length)) as AssistEvent);
}

/** A turn on the New form builder, which has no form id yet and names the screen's workspace. */
async function newFormTurn(caller: Caller, word: string, workspaceId?: string) {
  await deps.rateLimitStore.reset(`rl:agent-assist:${caller.userId}`);
  const res = await app.request("/admin/assist", {
    method: "POST",
    headers: headersFor(caller),
    body: JSON.stringify({
      conversation: [
        { role: "user", content: `a form #qcms-fake:propose-form-create #qcms-fake-new:${word}` },
      ],
      screen: "/forms/new",
      params: { workspaceId: workspaceId ?? SEED_WORKSPACE_ID },
      conversationId: `cnv_${word}`,
    }),
  });
  expect(res.status).toBe(200);
  return (await readEvents(res)).filter((event): event is PlanEvent => event.type === "plan");
}

function formIdFor(slug: string): string {
  return `frm_${slug.replaceAll("-", "_")}`;
}

function confirmCreate(caller: Caller, plan: PlanEvent): Promise<Response> {
  const args = plan.proposal.steps[0]?.args ?? {};
  const slug = String(args["slug"]);
  return Promise.resolve(
    app.request("/admin/forms", {
      method: "POST",
      headers: headersFor(caller, {
        [PROPOSAL_HEADER]: plan.proposal.token ?? "",
        [PROPOSAL_STEP_HEADER]: "0",
      }),
      body: JSON.stringify({ formId: formIdFor(slug), ...args }),
    }),
  );
}

async function formsWithSlug(slug: string): Promise<number> {
  const res = await testDb.client.query<{ n: number }>(
    `select count(*)::int as n from control.forms where slug = $1`,
    [slug],
  );
  return res.rows[0]?.n ?? 0;
}

async function draftsFor(formId: string): Promise<number> {
  const res = await testDb.client.query<{ n: number }>(
    `select count(*)::int as n from control.form_drafts where form_id = $1`,
    [formId],
  );
  return res.rows[0]?.n ?? 0;
}

async function rowsFor(formId: string): Promise<{ kind: string; detail: string | null }[]> {
  const res = await testDb.client.query<{ kind: string; detail: string | null }>(
    `select kind, detail from control.agent_actions where form_id = $1 order by id`,
    [formId],
  );
  return res.rows;
}

describe("creating a form from the builder (Q15)", () => {
  it(
    "names the screen's workspace and the slug on the card, and creates nothing until Confirm",
    async () => {
      const [plan, ...more] = await newFormTurn(owner, "lazy");
      expect(more).toEqual([]);
      if (plan === undefined) throw new Error("no create card");
      expect(plan.proposal.steps.map((step) => step.kind)).toEqual(["form.create"]);
      expect(plan.proposal.steps[0]?.args).toMatchObject({
        slug: "fake-new-lazy",
        workspaceId: SEED_WORKSPACE_ID,
      });
      expect(plan.proposal.workspaces?.map((entry) => entry.workspaceId)).toEqual([
        SEED_WORKSPACE_ID,
      ]);
      expect(await formsWithSlug("fake-new-lazy")).toBe(0);

      const created = await confirmCreate(owner, plan);
      expect(created.status).toBe(201);
      const formId = formIdFor("fake-new-lazy");
      expect(await formsWithSlug("fake-new-lazy")).toBe(1);
      expect(await draftsFor(formId)).toBe(1);
      expect(await rowsFor(formId)).toEqual([{ kind: "form.create", detail: formId }]);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "offers a View forms holder no create card at all",
    async () => {
      expect(await newFormTurn(viewer, "viewer")).toEqual([]);
      expect(await formsWithSlug("fake-new-viewer")).toBe(0);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "refuses the create in a workspace where the caller does not hold Edit forms",
    async () => {
      const editor = await seedAdminSession(testDb.db, {
        label: "crt_editor_elsewhere",
        at: now,
        grants: ["forms.editor"],
        owner: false,
      });
      const [plan] = await newFormTurn(editor, "elsewhere", otherWorkspace);
      if (plan === undefined) throw new Error("no create card");
      expect(plan.proposal.steps[0]?.args["workspaceId"]).toBe(otherWorkspace);
      const refused = await confirmCreate(editor, plan);
      expect(refused.status).toBe(403);
      expect(await formsWithSlug("fake-new-elsewhere")).toBe(0);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "refuses Confirm once the account is disabled, and leaves no form",
    async () => {
      const editor = await seedAdminSession(testDb.db, { label: "crt_disabled", at: now });
      const [plan] = await newFormTurn(editor, "disabled");
      if (plan === undefined) throw new Error("no create card");
      await disableSeededAccount(testDb.db, editor.userId, now);
      const refused = await confirmCreate(editor, plan);
      expect(refused.status).toBe(401);
      expect(await formsWithSlug("fake-new-disabled")).toBe(0);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );
});

describe("the builder's edits after the create", () => {
  it(
    "applies the first edits to the new form, and refuses the next once the account is disabled",
    async () => {
      const editor = await seedAdminSession(testDb.db, { label: "crt_edits", at: now });
      const [plan] = await newFormTurn(editor, "edited");
      if (plan === undefined) throw new Error("no create card");
      expect((await confirmCreate(editor, plan)).status).toBe(201);
      const formId = formIdFor("fake-new-edited");

      await deps.rateLimitStore.reset(`rl:agent-assist:${editor.userId}`);
      const turn = await app.request(`/admin/forms/${formId}/draft/assist`, {
        method: "POST",
        headers: headersFor(editor),
        body: JSON.stringify({
          conversation: [
            {
              role: "user",
              content: "start it #qcms-fake:builder-first-edits #qcms-fake-search:name",
            },
          ],
          screen: BUILDER_SCREEN,
          conversationId: "cnv_edits",
        }),
      });
      expect(turn.status).toBe(200);
      const edits = (await readEvents(turn)).find(
        (event): event is EditsEvent => event.type === "edits",
      );
      expect(edits?.edits.map((edit) => edit.op)).toEqual(["step", "copy", "copy"]);
      const [first, second] = edits?.edits ?? [];
      if (first === undefined || second === undefined) throw new Error("no edits");

      const put = (edit: typeof first) =>
        app.request(`/admin/forms/${formId}/draft`, {
          method: "PUT",
          headers: headersFor(editor, { [EDIT_HEADER]: edit.token }),
          body: JSON.stringify({ definition: edit.definition }),
        });
      expect((await put(first)).status).toBe(200);
      await disableSeededAccount(testDb.db, editor.userId, now);
      expect((await put(second)).status).toBe(401);
      expect((await rowsFor(formId)).map((row) => row.kind)).toEqual(["form.create", "draft.step"]);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );
});

describe("the docked assistant's accept (provenance)", () => {
  it(
    "writes one audit row, which the wizard's read reports",
    async () => {
      const formId = "frm_crt_accept";
      const created = await app.request("/admin/forms", {
        method: "POST",
        headers: headersFor(owner),
        body: JSON.stringify({ formId, slug: "crt-accept", defaultLocale: "en" }),
      });
      expect(created.status).toBe(201);
      const accepted = await app.request(`/admin/forms/${formId}/draft/assist/accept`, {
        method: "POST",
        headers: headersFor(owner),
        body: JSON.stringify({
          definition: {
            formId,
            defaultLocale: "en",
            title: { en: "Accepted" },
            steps: [
              {
                stepId: "stp_one",
                title: { en: "One" },
                items: [{ questionId: "q_crt_name", version: 1 }],
              },
            ],
            rules: [],
          },
        }),
      });
      expect(accepted.status).toBe(200);
      expect(await rowsFor(formId)).toEqual([{ kind: "apply-draft", detail: "2" }]);

      const read = await app.request(`/admin/forms/${formId}/draft/agent-changes`, {
        headers: headersFor(owner),
      });
      expect(read.status).toBe(200);
      const body = (await read.json()) as {
        agentAssisted: boolean;
        changes: { kind: string; revision: number | null }[];
      };
      expect(body.agentAssisted).toBe(true);
      expect(body.changes).toEqual([
        expect.objectContaining({ kind: "apply-draft", revision: 2 }),
      ]);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );

  it(
    "takes no agentAssisted mark on a plain save, so a client cannot claim the assistant's work",
    async () => {
      const formId = "frm_crt_forged";
      const created = await app.request("/admin/forms", {
        method: "POST",
        headers: headersFor(owner),
        body: JSON.stringify({ formId, slug: "crt-forged", defaultLocale: "en" }),
      });
      expect(created.status).toBe(201);
      const forged = await app.request(`/admin/forms/${formId}/draft`, {
        method: "PUT",
        headers: headersFor(owner),
        body: JSON.stringify({
          definition: {
            formId,
            defaultLocale: "en",
            title: { en: "Forged" },
            steps: [
              {
                stepId: "stp_one",
                title: { en: "One" },
                items: [{ questionId: "q_crt_name", version: 1 }],
              },
            ],
            rules: [],
          },
          agentAssisted: true,
        }),
      });
      expect(forged.status).toBe(400);
      expect(await rowsFor(formId)).toEqual([]);
    },
    CONTAINER_BOOT_TIMEOUT_MS,
  );
});
