import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FormId } from "@roonga/qcms-core";
import type { FormDefinition } from "@roonga/qcms-core";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import {
  archiveWorkspace,
  createForm,
  getForm,
  insertFormVersion,
  listAccessAudit,
  listSiteAudit,
  removeAccessGroupHolder,
  setMemberRole,
  setRequireSecondApprover,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  REQUEST_ENVIRONMENT_HEADER,
  registerRequestEnvironment,
} from "../../middleware/request-environment.js";
import {
  internalTokenFor,
  makeDeps,
  seedAdminSession,
  seedGrants,
  validEnv,
} from "../../test-support.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { registerMembership } from "../membership/route.js";
import { registerAdminResponses } from "../responses/admin/route.js";
import { registerWorkspaces } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

interface Actor {
  readonly token: string;
  readonly userId: string;
  readonly email: string;
}

interface ErrorBody {
  error: { code: string; message: string };
}

interface PreviewBody {
  requiresApproval: boolean;
  holdReason: string | null;
  gains: { userId: string; email: string; acts: { act: string; environments: string[] }[] }[];
  losses: { userId: string; email: string; acts: { act: string; environments: string[] }[] }[];
}

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let site: Actor;
let workspaces = 0;

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
        registerMembership,
        registerAdminResponses,
      ],
    },
  });
  internalToken = internalTokenFor(deps.config);
  site = await seedAdminSession(testDb.db, {
    label: "site",
    siteAdministrator: true,
    membership: false,
  });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

async function as(actor: Actor, method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(`/admin${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalToken,
      [ADMIN_SESSION_HEADER]: actor.token,
      [REQUEST_ENVIRONMENT_HEADER]: "prod",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.clone().json()) as ErrorBody).error.code;
}

async function newWorkspace(): Promise<string> {
  workspaces += 1;
  const res = await as(site, "POST", "/workspaces", {
    name: `Move ${String(workspaces)}`,
    slug: `move-${String(workspaces)}`,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const workspaceId = ((await res.json()) as { workspace: { workspaceId: string } }).workspace
    .workspaceId;
  // The creator is named first administrator; each test seeds the people it needs.
  await setMemberRole(testDb.db, workspaceId, site.userId, "member");
  return workspaceId;
}

let forms = 0;

async function seedForm(workspaceId: string): Promise<FormId> {
  forms += 1;
  const formId = FormId.parse(`frm_move_${String(forms).padStart(3, "0")}`);
  await createForm(testDb.db, {
    workspaceId,
    formId,
    slug: `move-form-${String(forms)}`,
    defaultLocale: "en",
  });
  await insertFormVersion(testDb.db, {
    formId,
    definition: {} as unknown as FormDefinition,
    appearance: null,
    compiled: {} as unknown as CompiledForm,
    compilerVersion: "1.0.0",
    a2uiSpecVersion: "1.0.0",
    semanticsVersion: "1",
  });
  return formId;
}

/** Edit forms in both workspaces, administering neither unless `administers` names one. */
async function editor(
  label: string,
  inWorkspaces: readonly string[],
  options: { readonly administers?: readonly string[]; readonly siteAdministrator?: boolean } = {},
): Promise<Actor> {
  const administers = options.administers ?? [];
  const [first = "", ...rest] = inWorkspaces;
  const actor = await seedAdminSession(testDb.db, {
    label,
    workspaceId: first,
    owner: administers.includes(first),
    grants: ["forms.editor"],
    ...(options.siteAdministrator === undefined
      ? {}
      : { siteAdministrator: options.siteAdministrator }),
  });
  for (const workspaceId of rest) {
    await seedGrants(testDb.db, {
      userId: actor.userId,
      workspaceId,
      grants: ["forms.editor"],
      owner: administers.includes(workspaceId),
    });
  }
  return actor;
}

async function administrator(workspaceId: string): Promise<Actor> {
  return seedAdminSession(testDb.db, {
    label: "wsadmin",
    workspaceId,
    owner: true,
    grants: [],
  });
}

async function move(actor: Actor, formId: FormId, workspaceId: string): Promise<Response> {
  return as(actor, "POST", `/forms/${formId}/workspace`, { workspaceId });
}

async function requestIdOf(res: Response): Promise<string> {
  return ((await res.clone().json()) as { request: { requestId: string } }).request.requestId;
}

async function decide(
  actor: Actor,
  workspaceId: string,
  requestId: string,
  act: "approve" | "reject",
): Promise<Response> {
  return as(actor, "POST", `/workspaces/${workspaceId}/approval-requests/${requestId}/${act}`);
}

async function requestStatus(workspaceId: string, requestId: string): Promise<string> {
  const listed = await as(site, "GET", `/workspaces/${workspaceId}/approval-requests`);
  const body = (await listed.json()) as { requests: { requestId: string; status: string }[] };
  return body.requests.find((row) => row.requestId === requestId)?.status ?? "absent";
}

async function settingDetails(workspaceId: string): Promise<string[]> {
  const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "setting", limit: 200 });
  return rows.map((row) => row.detail ?? "");
}

async function workspaceOf(formId: FormId): Promise<string | undefined> {
  return (await getForm(testDb.db, formId))?.workspaceId;
}

async function editorGroupOf(workspaceId: string, actor: Actor): Promise<string> {
  const seeded = await seedGrants(testDb.db, {
    userId: actor.userId,
    workspaceId,
    grants: ["forms.editor"],
    owner: false,
  });
  return seeded.teamIds["forms.editor"] ?? "";
}

describe("Move form, applied or held (criteria 16, 99, 100, 102, 103)", () => {
  it("refuses a mover holding Edit forms in the source only (criterion 99)", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("source-only", [source], { administers: [source] });

    const refused = await move(mover, formId, destination);
    expect(refused.status).toBe(403);
    expect(await workspaceOf(formId)).toBe(source);
  });

  it("refuses a move into an archived workspace (criterion 100)", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("archived-destination", [source, destination], {
      administers: [source, destination],
    });
    await archiveWorkspace(testDb.db, destination, deps.clock.now());

    const refused = await move(mover, formId, destination);
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("WORKSPACE_ARCHIVED");
    expect(await workspaceOf(formId)).toBe(source);
  });

  it("applies a source administrator's move at once, auditing both sides (criteria 16, 103)", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("applies", [source, destination], { administers: [source] });

    const applied = await move(mover, formId, destination);
    expect(applied.status, await applied.clone().text()).toBe(200);
    expect(await workspaceOf(formId)).toBe(destination);

    expect(await settingDetails(source)).toContain(`setting=form-moved-out to=${destination}`);
    expect(await settingDetails(destination)).toContain(`setting=form-moved-in from=${source}`);

    // Criterion 16: the move changes no group on either side.
    for (const workspaceId of [source, destination]) {
      const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "group" });
      expect(rows).toEqual([]);
    }
  });

  it("holds a move by a holder of Edit forms who administers neither workspace (criterion 102)", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("holds-no-admin", [source, destination]);
    const sourceAdministrator = await administrator(source);
    const destinationAdministrator = await administrator(destination);

    const held = await move(mover, formId, destination);
    expect(held.status, await held.clone().text()).toBe(202);
    const requestId = await requestIdOf(held);
    expect(await workspaceOf(formId)).toBe(source);

    // This mover administers neither workspace, so the approve route refuses them before
    // the request is read at all; an administrator's own approval is the 409 below.
    const own = await decide(mover, source, requestId, "approve");
    expect(own.status).toBe(403);

    const destinationOnly = await decide(destinationAdministrator, source, requestId, "approve");
    expect(destinationOnly.status).toBe(403);
    expect(await workspaceOf(formId)).toBe(source);

    const approved = await decide(sourceAdministrator, source, requestId, "approve");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await workspaceOf(formId)).toBe(destination);
    expect(await settingDetails(destination)).toContainEqual(
      expect.stringContaining(`setting=form-moved-in from=${source} request=${requestId}`),
    );
  });

  it("holds a Site administrator's move who does not administer the source (criterion 102)", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("holds-site", [source, destination], { siteAdministrator: true });
    const sourceAdministrator = await administrator(source);

    const held = await move(mover, formId, destination);
    expect(held.status, await held.clone().text()).toBe(202);
    expect(await workspaceOf(formId)).toBe(source);

    const approved = await decide(sourceAdministrator, source, await requestIdOf(held), "approve");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await workspaceOf(formId)).toBe(destination);
  });
});

describe("Move form with second approval on in the source (criteria 104, 105, 106)", () => {
  it("holds a source administrator's own move, refusing their own approval (criterion 104)", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("rule-on-admin", [source, destination], { administers: [source] });
    const second = await administrator(source);
    await setRequireSecondApprover(testDb.db, source, true);

    const held = await move(mover, formId, destination);
    expect(held.status, await held.clone().text()).toBe(202);
    const requestId = await requestIdOf(held);
    expect(await workspaceOf(formId)).toBe(source);

    const own = await decide(mover, source, requestId, "approve");
    expect(own.status).toBe(409);
    expect(await codeOf(own)).toBe("OWN_REQUEST");

    const approved = await decide(second, source, requestId, "approve");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await workspaceOf(formId)).toBe(destination);
  });

  it("holds a Site administrator's move and takes another administrator's approval (criterion 105)", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("rule-on-site", [source, destination], {
      administers: [source],
      siteAdministrator: true,
    });
    const sourceAdministrator = await administrator(source);
    await setRequireSecondApprover(testDb.db, source, true);

    const held = await move(mover, formId, destination);
    expect(held.status, await held.clone().text()).toBe(202);
    const requestId = await requestIdOf(held);

    const own = await decide(mover, source, requestId, "approve");
    expect(own.status).toBe(409);
    expect(await workspaceOf(formId)).toBe(source);

    const approved = await decide(sourceAdministrator, source, requestId, "approve");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await workspaceOf(formId)).toBe(destination);
  });

  it("takes a Site administrator who administers neither workspace as the approver (criterion 106)", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("site-approves", [source, destination], { administers: [source] });
    await setRequireSecondApprover(testDb.db, source, true);

    const held = await move(mover, formId, destination);
    expect(held.status, await held.clone().text()).toBe(202);

    const approved = await decide(site, source, await requestIdOf(held), "approve");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await workspaceOf(formId)).toBe(destination);
  });

  it("applies nothing when the held move is rejected", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("rejected", [source, destination], { administers: [source] });
    await setRequireSecondApprover(testDb.db, source, true);

    const requestId = await requestIdOf(await move(mover, formId, destination));
    const rejected = await decide(site, source, requestId, "reject");
    expect(rejected.status, await rejected.clone().text()).toBe(200);
    expect(await workspaceOf(formId)).toBe(source);
    expect(await requestStatus(source, requestId)).toBe("rejected");
  });
});

describe("the re-check when a held request is applied (criterion 48)", () => {
  it("refuses the approval once the mover no longer holds Edit forms in the destination", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("lost-edit-forms", [source, destination], {
      administers: [source],
    });
    await setRequireSecondApprover(testDb.db, source, true);

    const requestId = await requestIdOf(await move(mover, formId, destination));
    await removeAccessGroupHolder(testDb.db, await editorGroupOf(destination, mover), mover.userId);

    const refused = await decide(site, source, requestId, "approve");
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("MOVER_LOST_EDIT_FORMS");
    expect(await workspaceOf(formId)).toBe(source);
    expect(await requestStatus(source, requestId)).toBe("lapsed");
  });

  it("refuses the approval once the destination was archived", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("archived-since", [source, destination], { administers: [source] });
    await setRequireSecondApprover(testDb.db, source, true);

    const requestId = await requestIdOf(await move(mover, formId, destination));
    await archiveWorkspace(testDb.db, destination, deps.clock.now());

    const refused = await decide(site, source, requestId, "approve");
    expect(refused.status).toBe(409);
    expect(await codeOf(refused)).toBe("MOVE_DESTINATION_ARCHIVED");
    expect(await workspaceOf(formId)).toBe(source);
    expect(await requestStatus(source, requestId)).toBe("lapsed");
  });
});

describe("the Move form preview (criterion 101)", () => {
  it("names who gains and who loses, and nobody outside the two workspaces", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const elsewhere = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("preview", [source, destination], { administers: [source] });
    const loses = await seedAdminSession(testDb.db, {
      label: "loses",
      workspaceId: source,
      owner: false,
      grants: ["responses.viewer"],
    });
    const gains = await seedAdminSession(testDb.db, {
      label: "gains",
      workspaceId: destination,
      owner: false,
      grants: ["responses.viewer"],
    });
    const stranger = await seedAdminSession(testDb.db, {
      label: "stranger",
      workspaceId: elsewhere,
      owner: false,
      grants: ["responses.viewer"],
    });

    const res = await as(
      mover,
      "GET",
      `/forms/${formId}/workspace/preview?workspaceId=${destination}`,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PreviewBody;

    expect(body.gains.map((person) => person.userId)).toContain(gains.userId);
    expect(body.losses.map((person) => person.userId)).toContain(loses.userId);
    const named = [...body.gains, ...body.losses].map((person) => person.userId);
    expect(named).not.toContain(stranger.userId);

    const gained = body.gains.find((person) => person.userId === gains.userId);
    expect(gained?.acts.map((entry) => entry.act)).toContain("response.read");
    expect(gained?.acts.find((entry) => entry.act === "response.read")?.environments).toContain(
      "prod",
    );
    expect(body.requiresApproval).toBe(false);
    expect(body.holdReason).toBeNull();
  });

  it("says when the move needs an approver and why", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("preview-held", [source, destination]);

    const asked = await as(
      mover,
      "GET",
      `/forms/${formId}/workspace/preview?workspaceId=${destination}`,
    );
    expect(asked.status, await asked.clone().text()).toBe(200);
    expect((await asked.json()) as PreviewBody).toMatchObject({
      requiresApproval: true,
      holdReason: "not-source-administrator",
    });

    await setRequireSecondApprover(testDb.db, source, true);
    const again = await as(
      mover,
      "GET",
      `/forms/${formId}/workspace/preview?workspaceId=${destination}`,
    );
    expect((await again.json()) as PreviewBody).toMatchObject({
      requiresApproval: true,
      holdReason: "second-approval",
    });
  });

  it("refuses the preview to a caller holding Edit forms in the source only", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("preview-refused", [source], { administers: [source] });

    const refused = await as(
      mover,
      "GET",
      `/forms/${formId}/workspace/preview?workspaceId=${destination}`,
    );
    expect(refused.status).toBe(403);
  });
});

describe("responses after the move", () => {
  it("are readable through the destination's groups and no longer through the source's", async () => {
    const source = await newWorkspace();
    const destination = await newWorkspace();
    const formId = await seedForm(source);
    const mover = await editor("responses", [source, destination], { administers: [source] });
    const inSource = await seedAdminSession(testDb.db, {
      label: "source-reader",
      workspaceId: source,
      owner: false,
      grants: ["responses.viewer"],
    });
    const inDestination = await seedAdminSession(testDb.db, {
      label: "destination-reader",
      workspaceId: destination,
      owner: false,
      grants: ["responses.viewer"],
    });

    const before = await as(inSource, "GET", `/forms/${formId}/responses`);
    expect(before.status, await before.clone().text()).toBe(200);

    expect((await move(mover, formId, destination)).status).toBe(200);

    const after = await as(inSource, "GET", `/forms/${formId}/responses`);
    expect(after.status).toBe(403);
    const now = await as(inDestination, "GET", `/forms/${formId}/responses`);
    expect(now.status, await now.clone().text()).toBe(200);
  });
});

describe("the shared question library (criterion 109)", () => {
  it("writes a site row and a mirrored workspace row on marking and on unmarking", async () => {
    const library = await newWorkspace();

    expect((await as(site, "PUT", `/workspaces/${library}/shared`, { shared: true })).status).toBe(
      200,
    );
    expect((await as(site, "PUT", `/workspaces/${library}/shared`, { shared: false })).status).toBe(
      200,
    );

    const { rows } = await listSiteAudit(testDb.db, { kind: "library", limit: 100 });
    const mine = rows.filter((row) => row.workspaceId === library);
    const details = mine.map((row) => row.detail);
    details.sort();
    expect(details).toEqual(["library=marked", "library=unmarked"]);
    expect(mine.every((row) => row.subject === library)).toBe(true);

    const mirrored = (await settingDetails(library)).filter((detail) =>
      detail.startsWith(`subject=${library} library=`),
    );
    mirrored.sort();
    expect(mirrored).toEqual([
      `subject=${library} library=marked`,
      `subject=${library} library=unmarked`,
    ]);
  });
});
