/**
 * The workspace routes against a real Postgres (task 068, ADR-41). Requires Docker.
 *
 * Driven through `app.request()` with a real admin session, because what these tests are
 * about is the refusals: the archive that is refused while the workspace owns **any**
 * form - open, closed and never released, or released - or while it is the shared
 * question library (criterion 4 as Q64 and Q65 widened it), the second shared workspace,
 * the ambiguous create, and the move that makes the archive possible. Each of those is a
 * handler rule over several tables, so a fake database would be asserting the fake.
 *
 * Which criteria live here: **4** in full (each refusal with its named blockers, then
 * allowed once the forms are reassigned and the library is handed on, and the archive
 * asserted terminal), **5**'s route half (no path deletes a workspace, and the one that
 * ends its life reaches no response row), and the create-path half of **1** (a form or
 * question created with no workspace named is resolved or refused, never left unowned).
 * Criterion **2** is in `../forms/forms.integration.test.ts`, where publish lives; **3**
 * and the database half of 1, 5 and 7 are in
 * `packages/db/src/queries/workspaces.integration.test.ts`; **6**'s two halves are
 * `rules.test.ts` and that publish test.
 */

import { QuestionId, parseQuestionDefinition } from "@roonga/qcms-core";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import type { FormDefinition } from "@roonga/qcms-core";
import {
  SEED_WORKSPACE_ID,
  closeFormInEnvironment,
  createForm,
  getForm,
  getQuestion,
  insertFormRelease,
  insertFormVersion,
  listWorkspaces,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { FormId } from "@roonga/qcms-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { registerGrantCheck } from "../membership/middleware.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import {
  internalTokenFor,
  makeDeps,
  seedAdminSession,
  seedGrants,
  validEnv,
} from "../../test-support.js";
import { registerForms } from "../forms/route.js";
import { registerQuestions } from "../questions/route.js";
import { registerWorkspaces } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let adminSessionToken: string;
let adminUserId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerWorkspaces,
        registerForms,
        registerQuestions,
      ],
    },
  });
  internalToken = internalTokenFor(deps.config);
  const admin = await seedAdminSession(testDb.db);
  adminSessionToken = admin.token;
  adminUserId = admin.userId;
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function authHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: adminSessionToken,
  };
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(`/admin${path}`, {
    method,
    headers: authHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface WorkspaceBody {
  workspace: {
    workspaceId: string;
    slug: string;
    isShared: boolean;
    requireSecondApprover: boolean;
    archivedAt: string | null;
    forms: number;
    questions: number;
  };
}

const emptyDef = {} as unknown as FormDefinition;
const emptyCompiled = {} as unknown as CompiledForm;

/** A workspace created the way the product creates one: through the route. */
/**
 * A workspace, with this suite's administrator granted the authoring roles in it.
 *
 * The grants are the addition task 069 made (ADR-41): `createOrganization` writes the
 * creator's `forms.owner` member row, and **`forms.owner` touches no form, release, link,
 * webhook or response row at all** - an owner administers a workspace and does nothing
 * inside it. So a suite that creates a workspace and then authors in it has to grant
 * itself the authoring roles there, exactly as an operator does through the membership
 * screen, or every act inside the new workspace is a 403 and the suite would be asserting
 * the authorisation middleware rather than the workspace model.
 */
async function createWorkspace(slug: string): Promise<string> {
  const res = await send("POST", "/workspaces", { name: slug, slug });
  expect(res.status, await res.clone().text()).toBe(201);
  const workspaceId = ((await res.json()) as WorkspaceBody).workspace.workspaceId;
  await seedGrants(testDb.db, { userId: adminUserId, workspaceId });
  return workspaceId;
}

/** A published form in one workspace, written straight to the database. */
async function seedForm(label: string, workspaceId: string): Promise<FormId> {
  const formId = FormId.parse(`frm_${label}`);
  await createForm(testDb.db, {
    workspaceId,
    formId,
    slug: `${label}-slug`,
    defaultLocale: "en",
  });
  await insertFormVersion(testDb.db, {
    formId,
    definition: emptyDef,
    compiled: emptyCompiled,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  return formId;
}

describe("creating a workspace", () => {
  it("writes the organisation row and the owner's member row, with the switch off", async () => {
    const workspaceId = await createWorkspace("creating-one");

    // The `member` row carrying `forms.owner` is what makes this better-auth's
    // `createOrganization` rather than an insert (ADR-41): a workspace never exists
    // without an owner, and the owner is the account that made the request.
    const members = await testDb.db.query.authMember.findMany();
    const owner = members.find((row) => row.organizationId === workspaceId);
    expect(owner?.role).toBe("forms.owner");

    const listed = await listWorkspaces(testDb.db);
    const row = listed.find((entry) => entry.id === workspaceId);
    // Q13: the two-person switch is off, on a created workspace as on the seeded one.
    expect(row?.requireSecondApprover).toBe(false);
    expect(row?.isShared).toBe(false);
    expect(row?.archivedAt).toBeNull();
  });

  it("refuses a slug another workspace holds, installation-wide", async () => {
    await createWorkspace("slug-held");
    const again = await send("POST", "/workspaces", { name: "Again", slug: "slug-held" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorBody).error.code).toBe("WORKSPACE_SLUG_TAKEN");
  });

  it("answers two concurrent creates of one slug with a 201 and a typed 409", async () => {
    // The race the pre-check cannot close, and the reason it is mapped twice. Both
    // requests read the slug as free before either writes, so the loser is refused either
    // by the plugin's own slug check (a vendor `APIError`, `crud-org.mjs:62`) or by
    // `organization_slug_unique` underneath it (SQLSTATE 23505) - which one depends on how
    // the two interleave, and neither is a 500. The assertion is deliberately
    // order-blind: what is pinned is that one create wins, the other gets
    // `WORKSPACE_SLUG_TAKEN`, and no caller ever sees a vendor error.
    const [first, second] = await Promise.all([
      send("POST", "/workspaces", { name: "Race A", slug: "slug-race" }),
      send("POST", "/workspaces", { name: "Race B", slug: "slug-race" }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const loser = first.status === 409 ? first : second;
    expect(((await loser.json()) as ErrorBody).error.code).toBe("WORKSPACE_SLUG_TAKEN");

    // Exactly one row, whichever path refused the other.
    const held = (await listWorkspaces(testDb.db)).filter((row) => row.slug === "slug-race");
    expect(held).toHaveLength(1);
  });

  it("refuses a dotted slug at the edge, because an access-group name is dotted", async () => {
    const res = await send("POST", "/workspaces", { name: "Dotted", slug: "home.insurance" });
    expect(res.status).toBe(400);
  });
});

describe("the shared workspace", () => {
  it("is at most one, and the refusal names the workspace that holds it", async () => {
    const library = await createWorkspace("shared-library");
    const other = await createWorkspace("shared-other");

    const marked = await send("PUT", `/workspaces/${library}/shared`, { shared: true });
    expect(marked.status).toBe(200);
    expect(((await marked.json()) as WorkspaceBody).workspace.isShared).toBe(true);

    const second = await send("PUT", `/workspaces/${other}/shared`, { shared: true });
    expect(second.status).toBe(409);
    const body = (await second.json()) as ErrorBody;
    expect(body.error.code).toBe("SHARED_WORKSPACE_EXISTS");
    expect(body.error.message).toContain("shared-library");

    // Unmarking frees it, so an installation can move its library deliberately.
    expect((await send("PUT", `/workspaces/${library}/shared`, { shared: false })).status).toBe(
      200,
    );
    expect((await send("PUT", `/workspaces/${other}/shared`, { shared: true })).status).toBe(200);
    await send("PUT", `/workspaces/${other}/shared`, { shared: false });
  });
});

describe("archiving a workspace (criterion 4)", () => {
  it("refuses while an open form remains, names it, and succeeds once it is reassigned", async () => {
    const workspaceId = await createWorkspace("archive-open");
    const elsewhere = await createWorkspace("archive-open-target");
    const formId = await seedForm("archive_open_form", workspaceId);
    // Released, which is what makes it open **somewhere** since task 066 (Q18): there is
    // no `forms.status`, so a form is open in an environment only where a release says
    // so. Without the release this case would be about a form in neither narrower list,
    // which is the case below.
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_test",
      fromEnvironment: null,
    });

    const refused = await send("POST", `/workspaces/${workspaceId}/archive`);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as ErrorBody;
    expect(body.error.code).toBe("WORKSPACE_NOT_EMPTY");
    expect(body.error.details).toEqual({
      forms: [formId],
      openForms: [formId],
      releasedForms: [formId],
      shared: false,
    });

    // **Reassignment is the operator's act, never the archive's.** Nothing was closed or
    // moved on their behalf by the refusal above, which is the spirit of Q15 rather than
    // only its letter.
    const moved = await send("POST", `/forms/${formId}/workspace`, { workspaceId: elsewhere });
    expect(moved.status).toBe(200);
    expect((await getForm(testDb.db, formId))?.workspaceId).toBe(elsewhere);

    const archived = await send("POST", `/workspaces/${workspaceId}/archive`);
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as WorkspaceBody).workspace.archivedAt).not.toBeNull();

    // A second archive is refused rather than re-stamped: the time it was archived is a
    // fact about the act, and the act happened once.
    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(409);
  });

  it("refuses while a released version remains, even with the form closed (Q63)", async () => {
    const workspaceId = await createWorkspace("archive-released");
    const elsewhere = await createWorkspace("archive-released-target");
    const formId = await seedForm("archive_released_form", workspaceId);
    await insertFormRelease(testDb.db, {
      formId,
      environment: "prod",
      version: 1,
      releasedBy: "usr_test",
      fromEnvironment: null,
    });
    // Closed **in the environment it was released to**, since task 066 (Q18): the closed
    // state lives on the release state, so there is no whole-form status to set. That is
    // what empties the open-form half here, leaving the release-state half as the thing
    // refusing the archive - which reads task 065's table and is why this task depends
    // on it.
    await closeFormInEnvironment(testDb.db, {
      formId,
      environment: "prod",
      closedBy: "usr_test",
    });

    const refused = await send("POST", `/workspaces/${workspaceId}/archive`);
    expect(refused.status).toBe(409);
    expect(refused.status === 409 && ((await refused.json()) as ErrorBody).error.details).toEqual({
      forms: [formId],
      openForms: [],
      releasedForms: [formId],
      shared: false,
    });

    await send("POST", `/forms/${formId}/workspace`, { workspaceId: elsewhere });
    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);
  });

  it("refuses while a form in NEITHER narrower list remains (Code Owner, 2026-10-16)", async () => {
    // The reopen loophole, closed where it was opened. This form is neither open nor
    // released, so the first reading of criterion 4 let the archive through and left the
    // form owned by an archived workspace - and `POST /admin/forms/{id}/reopen` reads no
    // workspace state, so it could then be reopened. The ruling is that an archived
    // workspace owns no form at all.
    //
    // Since task 066 the form this describes is a **never-released** one rather than a
    // closed one: the closed state lives on the per-environment release state (Q18), so a
    // form with no release is neither open anywhere nor closable anywhere. It is exactly
    // the case both narrower lists miss, which is what the ruling is about.
    const workspaceId = await createWorkspace("archive-closed-form");
    const elsewhere = await createWorkspace("archive-closed-target");
    const formId = await seedForm("archive_closed_form", workspaceId);

    const refused = await send("POST", `/workspaces/${workspaceId}/archive`);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as ErrorBody;
    expect(body.error.code).toBe("WORKSPACE_NOT_EMPTY");
    expect(body.error.details).toEqual({
      forms: [formId],
      openForms: [],
      releasedForms: [],
      shared: false,
    });

    // And the reopen the refusal was protecting against is now impossible for a second
    // reason: with nothing released in any environment there is no intake to reopen, so
    // the route refuses `NOT_RELEASED`. The archive refusal is still what stops an
    // archived workspace owning the form at all.
    await send("POST", `/forms/${formId}/workspace`, { workspaceId: elsewhere });
    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);
    const reopened = await send("POST", `/forms/${formId}/reopen`, { environment: "prod" });
    expect(reopened.status).toBe(409);
    expect(((await reopened.json()) as ErrorBody).error.code).toBe("NOT_RELEASED");
    expect((await getForm(testDb.db, formId))?.workspaceId).toBe(elsewhere);
  });

  it("refuses while it is the shared library, and says to hand it on (Code Owner, 2026-10-16)", async () => {
    // Refuse rather than tidy (Q15). Clearing `isShared` for the operator would change
    // what every other workspace may pin as a side effect of an archive, so the flag is
    // named as a blocker and the repair is the operator's act.
    const workspaceId = await createWorkspace("archive-library");
    expect((await send("PUT", `/workspaces/${workspaceId}/shared`, { shared: true })).status).toBe(
      200,
    );

    const refused = await send("POST", `/workspaces/${workspaceId}/archive`);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as ErrorBody;
    expect(body.error.code).toBe("WORKSPACE_NOT_EMPTY");
    expect(body.error.message).toContain("shared question library");
    expect(body.error.details).toMatchObject({ shared: true, forms: [] });
    // The flag is untouched: nothing was tidied on the way to the refusal.
    expect((await listWorkspaces(testDb.db)).find((row) => row.id === workspaceId)?.isShared).toBe(
      true,
    );

    expect((await send("PUT", `/workspaces/${workspaceId}/shared`, { shared: false })).status).toBe(
      200,
    );
    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);
  });

  it("has no unarchive, which is a decision and not an omission (Code Owner, 2026-10-16)", async () => {
    // An archive is terminal (ADR-41's Note). Asserted as the absence of a route rather
    // than as a sentence: a later `POST .../unarchive` would have to change this test.
    const workspaceId = await createWorkspace("archive-terminal");
    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);

    for (const path of [
      `/workspaces/${workspaceId}/unarchive`,
      `/workspaces/${workspaceId}/restore`,
    ]) {
      expect((await send("POST", path, {})).status).toBe(404);
    }
    // And the only write an archived workspace still takes is unmarking the library, so
    // the one repair path Q15 leaves open stays open.
    expect((await send("PUT", `/workspaces/${workspaceId}/shared`, { shared: false })).status).toBe(
      200,
    );
  });

  it("leaves the questions it owns exactly where they were (criterion 5)", async () => {
    const workspaceId = await createWorkspace("archive-questions");
    const questionId = QuestionId.parse("q_archive_kept");
    const created = await send("POST", "/questions", {
      slug: "q-archive-kept",
      workspaceId,
      definition: definitionFor(questionId),
    });
    expect(created.status).toBe(201);

    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);

    // Archiving is one column on one row: the question is still there, still owned by the
    // archived workspace, and no form, version or response row was reached at all.
    const question = await getQuestion(testDb.db, questionId);
    expect(question?.workspaceId).toBe(workspaceId);
  });

  it("refuses to create in, or move into, an archived workspace", async () => {
    const workspaceId = await createWorkspace("archived-closed");
    const live = await createWorkspace("archived-closed-live");
    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);

    const created = await send("POST", "/forms", {
      formId: "frm_into_archived",
      slug: "into-archived",
      workspaceId,
      defaultLocale: "en",
    });
    expect(created.status).toBe(409);
    expect(((await created.json()) as ErrorBody).error.code).toBe("WORKSPACE_ARCHIVED");

    const formId = await seedForm("archived_move_target", live);
    const moved = await send("POST", `/forms/${formId}/workspace`, { workspaceId });
    expect(moved.status).toBe(409);
    expect(((await moved.json()) as ErrorBody).error.code).toBe("WORKSPACE_ARCHIVED");
  });
});

describe("the owning workspace of something new (criterion 1)", () => {
  it("is refused rather than guessed when more than one workspace could be meant", async () => {
    // By this point the suite has created several workspaces, which is the installation
    // Q19's reasoning is about: there is no safe default among them, and a form created
    // in the wrong one is visible to the wrong group from the moment it exists.
    const res = await send("POST", "/forms", {
      formId: "frm_ambiguous",
      slug: "ambiguous",
      defaultLocale: "en",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("WORKSPACE_REQUIRED");
    // The candidates are named, so the caller can act on the refusal.
    expect(JSON.stringify(body.error.details)).toContain(SEED_WORKSPACE_ID);
  });

  it("is the named one, and is echoed back", async () => {
    const workspaceId = await createWorkspace("named-owner");
    const res = await send("POST", "/forms", {
      formId: "frm_named_owner",
      slug: "named-owner-form",
      workspaceId,
      defaultLocale: "en",
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { workspaceId: string }).workspaceId).toBe(workspaceId);
  });

  it("refuses a workspace that does not exist", async () => {
    const res = await send("POST", "/questions", {
      slug: "q-nowhere",
      workspaceId: "org_not_a_workspace",
      definition: definitionFor(QuestionId.parse("q_nowhere")),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe("WORKSPACE_NOT_FOUND");
  });
});

describe("moving a question (Q14)", () => {
  it("is one update on the identity row and answers 404 for an id that is not there", async () => {
    const from = await createWorkspace("question-move-from");
    const to = await createWorkspace("question-move-to");
    const questionId = QuestionId.parse("q_route_move");
    expect(
      (
        await send("POST", "/questions", {
          slug: "q-route-move",
          workspaceId: from,
          definition: definitionFor(questionId),
        })
      ).status,
    ).toBe(201);

    const moved = await send("POST", `/questions/${questionId}/workspace`, { workspaceId: to });
    expect(moved.status).toBe(200);
    expect((await getQuestion(testDb.db, questionId))?.workspaceId).toBe(to);

    const missing = await send("POST", "/questions/q_never_created/workspace", {
      workspaceId: to,
    });
    expect(missing.status).toBe(404);
  });
});

/** A minimal valid question definition for the id given. */
function definitionFor(questionId: QuestionId): unknown {
  const parsed = parseQuestionDefinition({
    questionId,
    type: "shortText",
    label: { en: "Anything" },
  });
  if (!parsed.ok) throw new Error("the fixture definition is invalid");
  return parsed.value;
}
