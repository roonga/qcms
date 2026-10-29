import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId, QuestionId, parseQuestionDefinition } from "@roonga/qcms-core";
import type { FormDefinition } from "@roonga/qcms-core";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import {
  SEED_WORKSPACE_ID,
  addAccessGroupHolder,
  authOrganization,
  createAccessGroup,
  createForm,
  createQuestion,
  createQuestionVersion,
  deleteAccessGroup,
  ensureWorkspaceMember,
  getDraft,
  insertFormRelease,
  insertFormVersion,
  listAccessAudit,
  listFormReleases,
  listFormVersions,
  publishQuestionVersion,
  purgeExpiredReleaseBatches,
  schema,
  setRequireSecondApprover,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  searchPathOptions,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import type { Databases } from "../../environments.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { registerForms } from "../forms/route.js";
import { registerReleases } from "./route.js";

const { Pool } = pg;

const LIVE_SET = ["test", "prod"] as const;
const MOUNTED = { public: false, internal: false, admin: true } as const;

const OTHER_WORKSPACE = "org_batch_other";

let testDb: TestDb;
const executors = new Map<string, Executor>();
let control: Executor;
let app: ReturnType<typeof createApp>;
let internalToken: string;

interface Persona {
  readonly token: string;
  readonly userId: string;
}

let editorTest: Persona;
let approverProd: Persona;
let secondApprover: Persona;
let publisher: Persona;
let claim: Persona;
let otherWorkspaceEditor: Persona;
let revocable: Persona;
let revocableGroupId: string;

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

interface GrantSpec {
  readonly role: string;
  readonly environments: readonly string[];
  readonly workspaceId?: string;
}

async function persona(
  label: string,
  grants: readonly GrantSpec[],
  options: { readonly claim?: boolean } = {},
): Promise<Persona & { readonly groupIds: readonly string[] }> {
  const seeded = await seedAdminSession(control, {
    label,
    grants: [],
    owner: false,
    claim: options.claim ?? false,
  });
  const groupIds: string[] = [];
  for (const grant of grants) {
    const workspaceId = grant.workspaceId ?? SEED_WORKSPACE_ID;
    await ensureWorkspaceMember(control, workspaceId, seeded.userId);
    const group = await createAccessGroup(control, {
      workspaceId,
      name: `${label}.${grant.environments.join("-")}.${grant.role}`,
      role: grant.role,
      environments: [...grant.environments],
      forms: ["all"],
    });
    await addAccessGroupHolder(control, group.teamId, seeded.userId);
    groupIds.push(group.teamId);
  }
  return { ...seeded, groupIds };
}

const emptyCompiled = {} as unknown as CompiledForm;
const emptyDef = {} as unknown as FormDefinition;

let questionSeeded = false;
const QUESTION_ID = "q_batch_field";

async function seedQuestion(): Promise<void> {
  if (questionSeeded) return;
  const questionId = QuestionId.parse(QUESTION_ID);
  const parsed = parseQuestionDefinition({
    questionId: QUESTION_ID,
    type: "shortText",
    label: { en: "Field" },
  });
  if (!parsed.ok) throw new Error("fixture question did not parse");
  await createQuestion(control, {
    workspaceId: SEED_WORKSPACE_ID,
    questionId,
    slug: "q-batch-field",
  });
  await createQuestionVersion(control, { questionId, definition: parsed.value });
  await publishQuestionVersion(control, { questionId, version: 1 });
  questionSeeded = true;
}

function draftDefinition(formId: string): Record<string, unknown> {
  return {
    formId,
    defaultLocale: "en",
    title: { en: "A form" },
    steps: [{ stepId: "stp_one", title: { en: "One" }, items: [{ questionId: QUESTION_ID, version: 1 }] }],
    rules: [],
  };
}

let forms = 0;

/** A form with `versions` published snapshots, published by nobody in particular. */
async function seedForm(
  versions: number,
  options: { readonly workspaceId?: string; readonly publishedBy?: string } = {},
): Promise<FormId> {
  forms += 1;
  const formId = FormId.parse(`frm_batch${String(forms)}`);
  await createForm(control, {
    formId,
    slug: `batch-${String(forms)}`,
    workspaceId: options.workspaceId ?? SEED_WORKSPACE_ID,
    defaultLocale: "en",
  });
  for (let i = 0; i < versions; i += 1) {
    await insertFormVersion(control, {
      formId,
      definition: emptyDef,
      compiled: emptyCompiled,
      compilerVersion: "1.0.0",
      a2uiSpecVersion: "1.0.0",
      semanticsVersion: "1.0.0",
      publishedBy: options.publishedBy ?? "au_someone_else",
    });
  }
  return formId;
}

function headers(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: token,
  };
}

async function call(
  token: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request(`/admin${path}`, {
    method,
    headers: headers(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>) };
}

function codeOf(body: Record<string, unknown>): string {
  return (body as { error?: { code?: string } }).error?.code ?? "";
}

async function saveDraft(token: string, formId: FormId): Promise<number> {
  await seedQuestion();
  const saved = await call(token, "PUT", `/forms/${formId}/draft`, {
    definition: draftDefinition(formId),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return (await getDraft(control, formId))!.revision;
}

async function releasedEvents(environment: string, formId: FormId): Promise<number> {
  const res = await testDb.client.query<{ n: string }>(
    `select count(*) as n from data_${environment}.outbox
      where event_type = 'form.released' and payload->>'formId' = $1`,
    [formId],
  );
  return Number(res.rows[0]?.n ?? "-1");
}

/**
 * Reset the installation to "no revision configured", which is the derived default. The
 * tables are append-only at the database, so the owner has to turn the guard off to clear
 * them; that no application role can do this is the property the guard exists for.
 */
async function clearWorkflow(): Promise<void> {
  for (const table of ["release_workflow_rules", "release_workflow_revisions"]) {
    await testDb.client.query(`alter table control.${table} disable trigger all`);
    await testDb.client.query(`delete from control.${table}`);
    await testDb.client.query(`alter table control.${table} enable trigger all`);
  }
}

const KEYS = (() => {
  let minted = 0;
  return (): string => {
    minted += 1;
    return `00000000-0000-4000-8000-${String(minted).padStart(12, "0")}`;
  };
})();

beforeAll(async () => {
  testDb = await startTestDb();
  for (const environment of LIVE_SET) {
    const pool = testDb.register(
      new Pool({ connectionString: testDb.connectionUri, options: searchPathOptions(environment) }),
      `${environment} pool`,
    );
    executors.set(environment, drizzle(pool, { schema }));
  }
  control = executors.get("test")!;

  await control
    .insert(authOrganization)
    .values({ id: OTHER_WORKSPACE, name: "batch-other", slug: "batch-other" })
    .onConflictDoNothing({ target: authOrganization.id });

  editorTest = await persona("bEditor", [{ role: "forms.editor", environments: ["test"] }]);
  approverProd = await persona("bApprover", [{ role: "forms.approver", environments: ["prod"] }]);
  secondApprover = await persona("bSecond", [{ role: "forms.approver", environments: ["prod"] }]);
  publisher = await persona("bPublisher", [
    { role: "forms.editor", environments: ["test"] },
    { role: "forms.approver", environments: ["prod"] },
  ]);
  claim = await seedAdminSession(control, { label: "bClaim", membership: false });
  otherWorkspaceEditor = await persona("bOther", [
    { role: "forms.editor", environments: ["all"], workspaceId: OTHER_WORKSPACE },
  ]);
  const revoking = await persona("bRevocable", [
    { role: "forms.approver", environments: ["prod"] },
  ]);
  revocable = revoking;
  revocableGroupId = revoking.groupIds[0]!;

  const deps: Deps = makeDeps({ databases: databases(), env: validEnv() });
  internalToken = internalTokenFor(deps.config);
  app = createApp(deps, MOUNTED, {
    groups: {
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

describe("the release-workflow configuration", () => {
  it("reports the derived default with no revision written, and no role sees it change", async () => {
    await clearWorkflow();
    const read = await call(editorTest.token, "GET", "/release-workflow");
    expect(read.status).toBe(200);
    expect(read.body.revision).toBeNull();
    expect(read.body.source).toBe("default");
    const byName = new Map(
      (read.body.environments as { name: string }[]).map((row) => [row.name, row]),
    );
    expect(byName.get("prod")).toMatchObject({
      protected: true,
      requiresPriorReleaseIn: ["test"],
      allowsDraftPublish: false,
      allowsInBatch: true,
    });
    expect(byName.get("test")).toMatchObject({
      protected: false,
      requiresPriorReleaseIn: [],
      allowsDraftPublish: true,
    });
  });

  it("refuses the write to every grant and admits the installation claim alone", async () => {
    await clearWorkflow();
    for (const who of [editorTest, approverProd, publisher, otherWorkspaceEditor]) {
      const refused = await call(who.token, "PUT", "/release-workflow", {
        expectedRevision: null,
        rules: [],
      });
      expect(refused.status).toBe(403);
    }
    const written = await call(claim.token, "PUT", "/release-workflow", {
      expectedRevision: null,
      rules: [
        {
          environment: "prod",
          requiresPriorReleaseIn: ["test"],
          allowsDraftPublish: true,
          allowsInBatch: true,
        },
      ],
      note: "allow a combined publish into production",
    });
    expect(written.status).toBe(200);
    expect(written.body.revision).toBe(1);
    expect(written.body.source).toBe("configured");
    await clearWorkflow();
  });

  it("refuses the read to a caller holding no authoring role", async () => {
    const nobody = await seedAdminSession(control, {
      label: "bNobody",
      grants: [],
      owner: false,
      claim: false,
    });
    expect((await call(nobody.token, "GET", "/release-workflow")).status).toBe(403);
  });

  it("refuses an unserved name, a self-reference, a duplicate and a cycle", async () => {
    await clearWorkflow();
    const cases: { rules: unknown[]; environment: string }[] = [
      {
        rules: [
          {
            environment: "staging",
            requiresPriorReleaseIn: [],
            allowsDraftPublish: true,
            allowsInBatch: true,
          },
        ],
        environment: "staging",
      },
      {
        rules: [
          {
            environment: "prod",
            requiresPriorReleaseIn: ["prod"],
            allowsDraftPublish: false,
            allowsInBatch: true,
          },
        ],
        environment: "prod",
      },
      {
        rules: [
          {
            environment: "test",
            requiresPriorReleaseIn: [],
            allowsDraftPublish: true,
            allowsInBatch: true,
          },
          {
            environment: "test",
            requiresPriorReleaseIn: [],
            allowsDraftPublish: true,
            allowsInBatch: true,
          },
        ],
        environment: "test",
      },
      {
        rules: [
          {
            environment: "test",
            requiresPriorReleaseIn: ["prod"],
            allowsDraftPublish: true,
            allowsInBatch: true,
          },
          {
            environment: "prod",
            requiresPriorReleaseIn: ["test"],
            allowsDraftPublish: false,
            allowsInBatch: true,
          },
        ],
        environment: "test",
      },
    ];
    for (const one of cases) {
      const refused = await call(claim.token, "PUT", "/release-workflow", {
        expectedRevision: null,
        rules: one.rules,
      });
      expect(codeOf(refused.body)).toBe("WORKFLOW_RULE_INVALID");
      expect((refused.body as { error: { details: { environment: string } } }).error.details
        .environment).toBe(one.environment);
    }
    const read = await call(editorTest.token, "GET", "/release-workflow");
    expect(read.body.revision).toBeNull();
  });

  it("refuses a stale expectation rather than overwriting another account's revision", async () => {
    await clearWorkflow();
    const first = await call(claim.token, "PUT", "/release-workflow", {
      expectedRevision: null,
      rules: [],
    });
    expect(first.status).toBe(200);
    const stale = await call(claim.token, "PUT", "/release-workflow", {
      expectedRevision: null,
      rules: [],
    });
    expect(stale.status).toBe(409);
    expect(codeOf(stale.body)).toBe("WORKFLOW_REVISION_STALE");
    await clearWorkflow();
  });

  it("writes one access-audit setting row per active workspace, naming no content", async () => {
    await clearWorkflow();
    const before = await listAccessAudit(control, SEED_WORKSPACE_ID, { kind: "setting" });
    const written = await call(claim.token, "PUT", "/release-workflow", {
      expectedRevision: null,
      rules: [
        {
          environment: "prod",
          requiresPriorReleaseIn: ["test"],
          allowsDraftPublish: false,
          allowsInBatch: false,
        },
      ],
    });
    expect(written.status).toBe(200);
    const after = await listAccessAudit(control, SEED_WORKSPACE_ID, { kind: "setting" });
    const added = after.rows.filter((row) => !before.rows.some((old) => old.id === row.id));
    expect(added).toHaveLength(1);
    expect(added[0]?.detail).toContain("setting=releaseWorkflow");
    expect(added[0]?.detail).toContain("prod:after=test");
    expect(added[0]?.environment).toBeNull();
    expect(added[0]?.formId).toBeNull();
    const other = await listAccessAudit(control, OTHER_WORKSPACE, { kind: "setting" });
    expect(other.rows.length).toBeGreaterThan(0);
    await clearWorkflow();
  });

  it("is append-only at the database, so a rule change cannot rewrite history", async () => {
    await clearWorkflow();
    expect((await call(claim.token, "PUT", "/release-workflow", {
      expectedRevision: null,
      rules: [],
    })).status).toBe(200);
    await expect(
      testDb.client.query(`update control.release_workflow_revisions set note = 'edited'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      testDb.client.query(`delete from control.release_workflow_revisions`),
    ).rejects.toThrow(/append-only/);
    await clearWorkflow();
  });
});

describe("every destination is authorised on its own", () => {
  it("refuses a test-scoped editor the production half of a crafted batch", async () => {
    const formId = await seedForm(1);
    await insertFormRelease(control, {
      formId,
      environment: "test",
      version: 1,
      releasedBy: "au_seed",
    });
    const refused = await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [
        { environment: "test", expectedSequence: 1 },
        { environment: "prod", expectedSequence: null },
      ],
    });
    expect(refused.status).toBe(403);
    expect(refused.body).not.toHaveProperty("releases");
    // Not even the first destination: the refusal lands before the transaction opens.
    expect((await listFormReleases(control, formId, "test")).length).toBe(1);
    expect(await releasedEvents("prod", formId)).toBe(0);
  });

  it("refuses the same editor a direct production release and a single-target batch", async () => {
    const formId = await seedForm(1);
    await insertFormRelease(control, {
      formId,
      environment: "test",
      version: 1,
      releasedBy: "au_seed",
    });
    const direct = await call(editorTest.token, "POST", `/forms/${formId}/releases`, {
      environment: "prod",
      version: 1,
    });
    expect(direct.status).toBe(403);
    const batch = await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [{ environment: "prod", expectedSequence: null }],
    });
    expect(batch.status).toBe(403);
    expect(await listFormReleases(control, formId, "prod")).toEqual([]);
  });

  it("refuses an approver the publish half, draft and all", async () => {
    const formId = await seedForm(0);
    const revision = await saveDraft(editorTest.token, formId);
    for (const environment of ["prod", "test"]) {
      const refused = await call(approverProd.token, "POST", `/forms/${formId}/publish-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: null,
        source: { kind: "draft", draftRevision: revision },
        targets: [{ environment, expectedSequence: null }],
      });
      expect(refused.status).toBe(403);
    }
    // Nor the version-without-releasing case, which is `form: publish` by itself.
    const alone = await call(approverProd.token, "POST", `/forms/${formId}/publish-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "draft", draftRevision: revision },
      targets: [],
    });
    expect(alone.status).toBe(403);
    expect(await listFormVersions(control, formId)).toEqual([]);
    expect(await getDraft(control, formId)).toBeDefined();
  });

  it("publishes a version without releasing it when no destination is named", async () => {
    const formId = await seedForm(0);
    const revision = await saveDraft(editorTest.token, formId);
    const done = await call(editorTest.token, "POST", `/forms/${formId}/publish-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "draft", draftRevision: revision },
      targets: [],
    });
    expect(done.status).toBe(200);
    expect(done.body.version).toBe(1);
    expect(done.body.releases).toEqual([]);
    expect(await listFormVersions(control, formId)).toHaveLength(1);
    expect(await listFormReleases(control, formId)).toEqual([]);
    expect(await releasedEvents("test", formId)).toBe(0);
  });

  it("refuses an empty destination list on a batch whose only cell is environment-scoped", async () => {
    const formId = await seedForm(1);
    const refused = await call(approverProd.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [],
    });
    expect(refused.status).toBe(400);
  });

  it("refuses a grant held in another workspace, whatever its environment scope", async () => {
    const formId = await seedForm(1);
    const refused = await call(otherWorkspaceEditor.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [{ environment: "test", expectedSequence: null }],
    });
    expect(refused.status).toBe(403);
    expect(await listFormReleases(control, formId)).toEqual([]);
  });

  it("refuses a confirmation whose grant was revoked after the review", async () => {
    const formId = await seedForm(1);
    await insertFormRelease(control, {
      formId,
      environment: "test",
      version: 1,
      releasedBy: "au_seed",
    });
    const review = await call(revocable.token, "POST", `/forms/${formId}/release-review`, {
      source: { kind: "version", version: 1 },
    });
    expect(review.status).toBe(200);
    await deleteAccessGroup(control, revocableGroupId);
    const refused = await call(revocable.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [{ environment: "prod", expectedSequence: null }],
    });
    expect(refused.status).toBe(403);
    expect(await listFormReleases(control, formId, "prod")).toEqual([]);
    expect(await releasedEvents("prod", formId)).toBe(0);
  });
});

describe("the second-person rule holds through the batch", () => {
  it("refuses the publishing account and records the second one otherwise", async () => {
    await setRequireSecondApprover(control, SEED_WORKSPACE_ID, true);
    try {
      const formId = await seedForm(1, { publishedBy: approverProd.userId });
      await insertFormRelease(control, {
        formId,
        environment: "test",
        version: 1,
        releasedBy: "au_seed",
      });
      const self = await call(approverProd.token, "POST", `/forms/${formId}/release-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: null,
        source: { kind: "version", version: 1 },
        targets: [{ environment: "prod", expectedSequence: null }],
      });
      expect(self.status).toBe(403);
      expect(codeOf(self.body)).toBe("APPROVER_IS_AUTHOR");
      expect(await listFormReleases(control, formId, "prod")).toEqual([]);

      const second = await call(secondApprover.token, "POST", `/forms/${formId}/release-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: null,
        source: { kind: "version", version: 1 },
        targets: [{ environment: "prod", expectedSequence: null }],
      });
      expect(second.status).toBe(200);
      expect((second.body.releases as { approvedBy: string }[])[0]?.approvedBy).toBe(
        secondApprover.userId,
      );
    } finally {
      await setRequireSecondApprover(control, SEED_WORKSPACE_ID, false);
    }
  });

  it("refuses a combined publish into a gated production destination even when the workflow allows one", async () => {
    await clearWorkflow();
    await setRequireSecondApprover(control, SEED_WORKSPACE_ID, true);
    try {
      expect(
        (
          await call(claim.token, "PUT", "/release-workflow", {
            expectedRevision: null,
            rules: [
              {
                environment: "prod",
                requiresPriorReleaseIn: [],
                allowsDraftPublish: true,
                allowsInBatch: true,
              },
            ],
          })
        ).status,
      ).toBe(200);
      const formId = await seedForm(0);
      const revision = await saveDraft(publisher.token, formId);
      const refused = await call(publisher.token, "POST", `/forms/${formId}/publish-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: 1,
        source: { kind: "draft", draftRevision: revision },
        targets: [{ environment: "prod", expectedSequence: null }],
      });
      expect(refused.status).toBe(403);
      expect(codeOf(refused.body)).toBe("APPROVER_IS_AUTHOR");
      expect(await listFormVersions(control, formId)).toEqual([]);
      expect(await getDraft(control, formId)).toBeDefined();
    } finally {
      await setRequireSecondApprover(control, SEED_WORKSPACE_ID, false);
      await clearWorkflow();
    }
  });
});

describe("one confirmation is one transaction", () => {
  it("freezes one snapshot and releases it into every destination", async () => {
    await clearWorkflow();
    expect(
      (
        await call(claim.token, "PUT", "/release-workflow", {
          expectedRevision: null,
          rules: [
            {
              environment: "prod",
              requiresPriorReleaseIn: [],
              allowsDraftPublish: true,
              allowsInBatch: true,
            },
          ],
        })
      ).status,
    ).toBe(200);
    try {
      const formId = await seedForm(0);
      const revision = await saveDraft(publisher.token, formId);
      const done = await call(publisher.token, "POST", `/forms/${formId}/publish-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: 1,
        source: { kind: "draft", draftRevision: revision },
        targets: [
          { environment: "test", expectedSequence: null },
          { environment: "prod", expectedSequence: null },
        ],
      });
      expect(done.status).toBe(200);
      // One snapshot, not one per destination.
      expect(await listFormVersions(control, formId)).toHaveLength(1);
      expect(done.body.version).toBe(1);
      expect((done.body.releases as unknown[]).length).toBe(2);
      expect(await getDraft(control, formId)).toBeUndefined();
      expect(await releasedEvents("test", formId)).toBe(1);
      expect(await releasedEvents("prod", formId)).toBe(1);
    } finally {
      await clearWorkflow();
    }
  });

  it("writes nothing when a destination the workflow keeps out of a batch is named", async () => {
    await clearWorkflow();
    expect(
      (
        await call(claim.token, "PUT", "/release-workflow", {
          expectedRevision: null,
          rules: [
            {
              environment: "prod",
              requiresPriorReleaseIn: [],
              allowsDraftPublish: true,
              allowsInBatch: false,
            },
          ],
        })
      ).status,
    ).toBe(200);
    try {
      const formId = await seedForm(1);
      const refused = await call(publisher.token, "POST", `/forms/${formId}/release-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: 1,
        source: { kind: "version", version: 1 },
        targets: [
          { environment: "test", expectedSequence: null },
          { environment: "prod", expectedSequence: null },
        ],
      });
      expect(refused.status).toBe(409);
      expect(codeOf(refused.body)).toBe("BATCH_NOT_ALLOWED");
      expect(await listFormReleases(control, formId)).toEqual([]);
      expect(await releasedEvents("test", formId)).toBe(0);
    } finally {
      await clearWorkflow();
    }
  });

  it("refuses a workflow revision written between the review and the confirmation", async () => {
    await clearWorkflow();
    const formId = await seedForm(1);
    const refusedAfter = async (): Promise<{ status: number; body: Record<string, unknown> }> =>
      call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: null,
        source: { kind: "version", version: 1 },
        targets: [{ environment: "test", expectedSequence: null }],
      });
    expect(
      (
        await call(claim.token, "PUT", "/release-workflow", {
          expectedRevision: null,
          rules: [],
        })
      ).status,
    ).toBe(200);
    try {
      const refused = await refusedAfter();
      expect(refused.status).toBe(409);
      expect(codeOf(refused.body)).toBe("STALE_REVIEW");
      expect(
        (refused.body as { error: { details: { field: string } } }).error.details.field,
      ).toBe("workflowRevision");
      expect(await listFormReleases(control, formId)).toEqual([]);
    } finally {
      await clearWorkflow();
    }
  });

  it("refuses a draft saved between the review and the confirmation", async () => {
    const formId = await seedForm(0);
    const revision = await saveDraft(editorTest.token, formId);
    await saveDraft(editorTest.token, formId);
    const refused = await call(editorTest.token, "POST", `/forms/${formId}/publish-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "draft", draftRevision: revision },
      targets: [{ environment: "test", expectedSequence: null }],
    });
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe("STALE_REVIEW");
    expect(await listFormVersions(control, formId)).toEqual([]);
    expect(await getDraft(control, formId)).toBeDefined();
  });

  it("refuses a destination whose intake changed, which the sequence carries", async () => {
    const formId = await seedForm(2);
    await insertFormRelease(control, {
      formId,
      environment: "test",
      version: 1,
      releasedBy: "au_seed",
    });
    const review = await call(editorTest.token, "POST", `/forms/${formId}/release-review`, {
      source: { kind: "version", version: 2 },
    });
    const target = (review.body.targets as { environment: string; currentSequence: number }[]).find(
      (one) => one.environment === "test",
    );
    expect(target?.currentSequence).toBe(1);
    // A close appends a row, so the sequence the review reported is no longer the newest.
    expect((await call(editorTest.token, "POST", `/forms/${formId}/close`, {
      environment: "test",
    })).status).toBe(200);
    const refused = await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 2 },
      targets: [{ environment: "test", expectedSequence: 1 }],
    });
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe("STALE_REVIEW");
    expect(
      (refused.body as { error: { details: { environment: string } } }).error.details.environment,
    ).toBe("test");
    expect((await listFormReleases(control, formId, "test")).length).toBe(2);

    // And the same confirmation carrying the new sequence succeeds without reopening intake.
    const done = await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 2 },
      targets: [{ environment: "test", expectedSequence: 2 }],
    });
    expect(done.status).toBe(200);
    expect((done.body.releases as { closed: boolean }[])[0]?.closed).toBe(true);
  });

  it("refuses a production candidate with no prior release, writing nothing", async () => {
    const formId = await seedForm(1);
    const refused = await call(approverProd.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [{ environment: "prod", expectedSequence: null }],
    });
    expect(refused.status).toBe(409);
    expect(codeOf(refused.body)).toBe("TEST_RELEASE_REQUIRED");
    expect(await listFormReleases(control, formId)).toEqual([]);
  });

  it("names the configured code once a revision is written", async () => {
    await clearWorkflow();
    expect(
      (
        await call(claim.token, "PUT", "/release-workflow", {
          expectedRevision: null,
          rules: [
            {
              environment: "prod",
              requiresPriorReleaseIn: ["test"],
              allowsDraftPublish: false,
              allowsInBatch: true,
            },
          ],
        })
      ).status,
    ).toBe(200);
    try {
      const formId = await seedForm(1);
      const refused = await call(approverProd.token, "POST", `/forms/${formId}/release-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: 1,
        source: { kind: "version", version: 1 },
        targets: [{ environment: "prod", expectedSequence: null }],
      });
      expect(codeOf(refused.body)).toBe("PRIOR_RELEASE_REQUIRED");
      const review = await call(approverProd.token, "POST", `/forms/${formId}/release-review`, {
        source: { kind: "version", version: 1 },
      });
      expect(review.body.workflowSource).toBe("configured");
      expect(review.body.workflowRevision).toBe(1);
      expect(
        (review.body.targets as { blockers: { code: string }[] }[])[0]?.blockers.map(
          (blocker) => blocker.code,
        ),
      ).toEqual(["PRIOR_RELEASE_REQUIRED"]);
    } finally {
      await clearWorkflow();
    }
  });

  it("rolls the whole act back when the outbox write fails", async () => {
    const formId = await seedForm(0);
    const revision = await saveDraft(editorTest.token, formId);
    await testDb.client.query(
      `create function data_test.refuse_outbox() returns trigger as $$
        begin raise exception 'outbox refused'; end; $$ language plpgsql`,
    );
    await testDb.client.query(
      `create trigger refuse_outbox before insert on data_test.outbox
         for each row execute function data_test.refuse_outbox()`,
    );
    try {
      const failed = await call(editorTest.token, "POST", `/forms/${formId}/publish-batch`, {
        idempotencyKey: KEYS(),
        expectedWorkflowRevision: null,
        source: { kind: "draft", draftRevision: revision },
        targets: [{ environment: "test", expectedSequence: null }],
      });
      expect(failed.status).toBe(500);
      // No snapshot, no release row, no consumed draft: the version and the event commit
      // or roll back together.
      expect(await listFormVersions(control, formId)).toEqual([]);
      expect(await listFormReleases(control, formId)).toEqual([]);
      expect(await getDraft(control, formId)).toBeDefined();
    } finally {
      await testDb.client.query(`drop trigger refuse_outbox on data_test.outbox`);
      await testDb.client.query(`drop function data_test.refuse_outbox()`);
    }
  });

  it("refuses the same version already released there, and a destination named twice", async () => {
    const formId = await seedForm(1);
    await insertFormRelease(control, {
      formId,
      environment: "test",
      version: 1,
      releasedBy: "au_seed",
    });
    const already = await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [{ environment: "test", expectedSequence: 1 }],
    });
    expect(codeOf(already.body)).toBe("ALREADY_RELEASED");
    const twice = await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: KEYS(),
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [
        { environment: "test", expectedSequence: 1 },
        { environment: "test", expectedSequence: 1 },
      ],
    });
    expect(codeOf(twice.body)).toBe("DUPLICATE_TARGET");
  });
});

describe("idempotency and result lookup", () => {
  it("replays the stored result rather than creating a second version or event", async () => {
    const formId = await seedForm(0);
    const revision = await saveDraft(editorTest.token, formId);
    const key = KEYS();
    const body = {
      idempotencyKey: key,
      expectedWorkflowRevision: null,
      source: { kind: "draft", draftRevision: revision },
      targets: [{ environment: "test", expectedSequence: null }],
    };
    const first = await call(editorTest.token, "POST", `/forms/${formId}/publish-batch`, body);
    expect(first.status).toBe(200);
    expect(first.body.replayed).toBe(false);
    const again = await call(editorTest.token, "POST", `/forms/${formId}/publish-batch`, body);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.version).toBe(first.body.version);
    expect(again.body.releases).toEqual(first.body.releases);
    expect(await listFormVersions(control, formId)).toHaveLength(1);
    expect(await releasedEvents("test", formId)).toBe(1);
    expect((await listFormReleases(control, formId, "test")).length).toBe(1);

    const looked = await call(
      editorTest.token,
      "GET",
      `/forms/${formId}/release-batches/${key}`,
    );
    expect(looked.status).toBe(200);
    expect(looked.body.version).toBe(first.body.version);
  });

  it("refuses the same key for a different intent, and keeps the first result", async () => {
    const formId = await seedForm(2);
    const key = KEYS();
    const first = await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: key,
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [{ environment: "test", expectedSequence: null }],
    });
    expect(first.status).toBe(200);
    const changed = await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: key,
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 2 },
      targets: [{ environment: "test", expectedSequence: 1 }],
    });
    expect(changed.status).toBe(422);
    expect(codeOf(changed.body)).toBe("IDEMPOTENCY_KEY_REUSED");
    expect((await listFormReleases(control, formId, "test")).length).toBe(1);
  });

  it("stores no result for a refusal, so the same key may be retried", async () => {
    const formId = await seedForm(1);
    const key = KEYS();
    const refused = await call(approverProd.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: key,
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [{ environment: "prod", expectedSequence: null }],
    });
    expect(refused.status).toBe(409);
    expect(
      (await call(approverProd.token, "GET", `/forms/${formId}/release-batches/${key}`)).status,
    ).toBe(404);
    await insertFormRelease(control, {
      formId,
      environment: "test",
      version: 1,
      releasedBy: "au_seed",
    });
    const retried = await call(approverProd.token, "POST", `/forms/${formId}/release-batch`, {
      idempotencyKey: key,
      expectedWorkflowRevision: null,
      source: { kind: "version", version: 1 },
      targets: [{ environment: "prod", expectedSequence: null }],
    });
    expect(retried.status).toBe(200);
  });

  it("keeps a key scoped to the account that minted it", async () => {
    const formId = await seedForm(1);
    const key = KEYS();
    expect(
      (
        await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
          idempotencyKey: key,
          expectedWorkflowRevision: null,
          source: { kind: "version", version: 1 },
          targets: [{ environment: "test", expectedSequence: null }],
        })
      ).status,
    ).toBe(200);
    // The same key, the same form, another account: no result of its own to read.
    expect(
      (await call(publisher.token, "GET", `/forms/${formId}/release-batches/${key}`)).status,
    ).toBe(404);
  });

  it("sweeps a stored result past its retention and leaves a fresh one", async () => {
    const formId = await seedForm(1);
    const key = KEYS();
    expect(
      (
        await call(editorTest.token, "POST", `/forms/${formId}/release-batch`, {
          idempotencyKey: key,
          expectedWorkflowRevision: null,
          source: { kind: "version", version: 1 },
          targets: [{ environment: "test", expectedSequence: null }],
        })
      ).status,
    ).toBe(200);
    const kept = await purgeExpiredReleaseBatches(control, new Date(0));
    expect(kept.purgedCount).toBe(0);
    expect(
      (await call(editorTest.token, "GET", `/forms/${formId}/release-batches/${key}`)).status,
    ).toBe(200);
    const swept = await purgeExpiredReleaseBatches(control, new Date(Date.now() + 86_400_000));
    expect(swept.purgedCount).toBeGreaterThan(0);
    expect(
      (await call(editorTest.token, "GET", `/forms/${formId}/release-batches/${key}`)).status,
    ).toBe(404);
  });
});
