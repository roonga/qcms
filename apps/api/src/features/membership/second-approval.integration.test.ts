import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAccessGroup,
  getWorkspace,
  insertApprovalRequest,
  listAccessAudit,
  listAccessGroupHolders,
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
import { expireDueApprovalRequests } from "../../schedulers/retention-sweep.js";
import {
  disableSeededAccount,
  internalTokenFor,
  makeDeps,
  seedAdminSession,
  validEnv,
} from "../../test-support.js";
import { argumentsDigest, signProposalToken } from "../agent/proposal-token.js";
import { registerAgentProvenance } from "../agent/provenance-mount.js";
import { PROPOSAL_HEADER, PROPOSAL_STEP_HEADER } from "../agent/provenance.js";
import { registerSiteAdministrators } from "../site-admins/route.js";
import { registerWorkspaces } from "../workspaces/route.js";
import { registerGrantCheck } from "./middleware.js";
import { registerMembership } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

interface Actor {
  readonly token: string;
  readonly userId: string;
  readonly email: string;
}

let testDb: TestDb;
let deps: Deps;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let site: Actor;
let workspaces = 0;
let groups = 0;

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }) });
  app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerAgentProvenance,
        registerMembership,
        registerWorkspaces,
        registerSiteAdministrators,
      ],
    },
  });
  internalToken = internalTokenFor(deps.config);
  // The one Site administrator in this database, which is what lets a sole Workspace
  // administrator be told apart from one with a Site administrator behind them.
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
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.clone().json()) as { error?: { code?: string } }).error?.code ?? "";
}

async function newWorkspace(): Promise<string> {
  workspaces += 1;
  const res = await as(site, "POST", "/workspaces", {
    name: `Second approval ${String(workspaces)}`,
    slug: `second-approval-${String(workspaces)}`,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const workspaceId = ((await res.json()) as { workspace: { workspaceId: string } }).workspace
    .workspaceId;
  // The creator is named first administrator; these workspaces are administered by the
  // people each test seeds.
  await setMemberRole(testDb.db, workspaceId, site.userId, "member");
  return workspaceId;
}

async function administrator(
  workspaceId: string,
  options: { readonly claimed?: boolean } = {},
): Promise<Actor> {
  return seedAdminSession(testDb.db, {
    label: "wsadmin",
    workspaceId,
    owner: true,
    grants: [],
    ...(options.claimed === undefined ? {} : { claimed: options.claimed }),
  });
}

async function publisher(workspaceId: string): Promise<Actor> {
  return seedAdminSession(testDb.db, {
    label: "publisher",
    workspaceId,
    owner: false,
    grants: ["forms.publisher"],
  });
}

async function setSwitch(actor: Actor, workspaceId: string, on: boolean): Promise<Response> {
  return as(actor, "PUT", `/workspaces/${workspaceId}/settings`, { requireSecondApprover: on });
}

async function switchOf(workspaceId: string): Promise<boolean> {
  return (await getWorkspace(testDb.db, workspaceId))?.requireSecondApprover ?? false;
}

async function decide(
  actor: Actor,
  workspaceId: string,
  requestId: string,
  act: "approve" | "reject",
): Promise<Response> {
  return as(actor, "POST", `/workspaces/${workspaceId}/approval-requests/${requestId}/${act}`);
}

async function requestIdOf(res: Response): Promise<string> {
  return ((await res.clone().json()) as { request: { requestId: string } }).request.requestId;
}

async function approvalActs(workspaceId: string): Promise<string[]> {
  const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "approval", limit: 200 });
  return rows.map((row) => /act=(\w+)/u.exec(row.detail ?? "")?.[1] ?? "").sort();
}

let proposals = 0;

/**
 * One confirmed assistant step on an admin route: the token binds the arguments the card
 * showed, so the step row is written only where the route accepted exactly that request.
 */
async function asStep(
  actor: Actor,
  method: string,
  path: string,
  step: { readonly kind: string; readonly args: Readonly<Record<string, unknown>> },
  body?: unknown,
): Promise<{ readonly res: Response; readonly proposalId: string }> {
  proposals += 1;
  const proposalId = `prp_sa_${String(proposals).padStart(4, "0")}`;
  const token = await signProposalToken(deps.config.keys.app, {
    sub: actor.userId,
    pid: proposalId,
    steps: [
      { kind: step.kind, argsDigest: await argumentsDigest(step.args), environment: "prod" },
    ],
    issuedAt: deps.clock.now(),
  });
  const res = await app.request(`/admin${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalToken,
      [ADMIN_SESSION_HEADER]: actor.token,
      [REQUEST_ENVIRONMENT_HEADER]: "prod",
      [PROPOSAL_HEADER]: token,
      [PROPOSAL_STEP_HEADER]: "0",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { res, proposalId };
}

async function stepRows(
  proposalId: string,
): Promise<{ kind: string; detail: string | null }[]> {
  const rows = await testDb.client.query<{ kind: string; detail: string | null }>(
    `select kind, detail from control.agent_actions where proposal_id = $1`,
    [proposalId],
  );
  return rows.rows;
}

async function responseGroup(workspaceId: string, roles = ["responses.viewer"]): Promise<string> {
  groups += 1;
  const group = await createAccessGroup(testDb.db, {
    workspaceId,
    name: `Readers ${String(groups)}`,
    roles,
    environments: ["prod"],
  });
  return group.teamId;
}

describe("turning second approval on (criteria 38, 39, 41)", () => {
  it("is refused for a sole administrator with no other Site administrator", async () => {
    const workspaceId = await newWorkspace();
    await setMemberRole(testDb.db, workspaceId, site.userId, "forms.owner");
    await publisher(workspaceId);
    await publisher(workspaceId);

    const refused = await setSwitch(site, workspaceId, true);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "SECOND_APPROVAL_NO_APPROVER",
        details: { administrator: true, publisher: false },
      },
    });
    expect(await switchOf(workspaceId)).toBe(false);
  });

  it("is refused while the only other administrator is unclaimed or disabled", async () => {
    const workspaceId = await newWorkspace();
    await setMemberRole(testDb.db, workspaceId, site.userId, "forms.owner");
    await publisher(workspaceId);
    await publisher(workspaceId);
    await administrator(workspaceId, { claimed: false });
    const disabled = await administrator(workspaceId);
    await disableSeededAccount(testDb.db, disabled.userId, new Date());

    expect(await codeOf(await setSwitch(site, workspaceId, true))).toBe(
      "SECOND_APPROVAL_NO_APPROVER",
    );

    await administrator(workspaceId);
    expect((await setSwitch(site, workspaceId, true)).status).toBe(200);
    expect(await switchOf(workspaceId)).toBe(true);
  });

  it("is refused without a second active holder of Publish forms for prod", async () => {
    const workspaceId = await newWorkspace();
    const admin = await administrator(workspaceId);
    await publisher(workspaceId);
    const res = await setSwitch(admin, workspaceId, true);
    expect(await res.json()).toMatchObject({
      error: { details: { administrator: false, publisher: true } },
    });

    const gone = await publisher(workspaceId);
    await disableSeededAccount(testDb.db, gone.userId, new Date());
    expect(await codeOf(await setSwitch(admin, workspaceId, true))).toBe(
      "SECOND_APPROVAL_NO_APPROVER",
    );
  });

  it("counts a Site administrator who is not the requester as the second administrator", async () => {
    const workspaceId = await newWorkspace();
    const sole = await administrator(workspaceId);
    await publisher(workspaceId);
    await publisher(workspaceId);
    expect((await setSwitch(sole, workspaceId, true)).status).toBe(200);
    expect(await switchOf(workspaceId)).toBe(true);
  });
});

describe("the Settings warning (criterion 44)", () => {
  it("is set once the only other holder of Publish forms for prod is disabled", async () => {
    const workspaceId = await newWorkspace();
    const admin = await administrator(workspaceId);
    await publisher(workspaceId);
    const second = await publisher(workspaceId);
    expect((await setSwitch(admin, workspaceId, true)).status).toBe(200);

    const before = await as(admin, "GET", `/workspaces/${workspaceId}/settings`);
    expect(before.status, await before.clone().text()).toBe(200);
    expect(await before.json()).toEqual({
      workspaceId,
      requireSecondApprover: true,
      nobodyElseCouldApprove: false,
      missingApprover: { administrator: false, publisher: false },
    });

    await disableSeededAccount(testDb.db, second.userId, new Date());
    expect(
      await (await as(admin, "GET", `/workspaces/${workspaceId}/settings`)).json(),
    ).toMatchObject({ nobodyElseCouldApprove: true, missingApprover: { publisher: true } });
  });

  it("is set once the only other administrator is disabled", async () => {
    const workspaceId = await newWorkspace();
    await setMemberRole(testDb.db, workspaceId, site.userId, "forms.owner");
    const other = await administrator(workspaceId);
    await publisher(workspaceId);
    await publisher(workspaceId);
    expect((await setSwitch(site, workspaceId, true)).status).toBe(200);
    expect(
      (
        (await (await as(site, "GET", `/workspaces/${workspaceId}/settings`)).json()) as {
          nobodyElseCouldApprove: boolean;
        }
      ).nobodyElseCouldApprove,
    ).toBe(false);

    await disableSeededAccount(testDb.db, other.userId, new Date());
    expect(
      await (await as(site, "GET", `/workspaces/${workspaceId}/settings`)).json(),
    ).toMatchObject({ nobodyElseCouldApprove: true, missingApprover: { administrator: true } });
  });

  it("is not readable by a publisher", async () => {
    const workspaceId = await newWorkspace();
    const holder = await publisher(workspaceId);
    expect((await as(holder, "GET", `/workspaces/${workspaceId}/settings`)).status).toBe(403);
  });
});

async function ruledWorkspace(): Promise<{
  readonly workspaceId: string;
  readonly a: Actor;
  readonly b: Actor;
}> {
  const workspaceId = await newWorkspace();
  const a = await administrator(workspaceId);
  const b = await administrator(workspaceId);
  await publisher(workspaceId);
  await publisher(workspaceId);
  expect((await setSwitch(a, workspaceId, true)).status).toBe(200);
  return { workspaceId, a, b };
}

describe("turning second approval off (criteria 36, 37, 42, 43, 46, 47)", () => {
  it("is held until a different administrator approves, never the requester", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const held = await setSwitch(a, workspaceId, false);
    expect(held.status).toBe(202);
    expect(await held.clone().json()).toMatchObject({
      requireSecondApprover: true,
      request: { kind: "second-approval-off", status: "pending", requestedBy: a.userId },
    });
    expect(await switchOf(workspaceId)).toBe(true);
    const requestId = await requestIdOf(held);

    expect(await codeOf(await setSwitch(a, workspaceId, false))).toBe("REQUEST_PENDING");
    expect(await codeOf(await decide(a, workspaceId, requestId, "approve"))).toBe("OWN_REQUEST");
    expect(await switchOf(workspaceId)).toBe(true);

    const approved = await decide(b, workspaceId, requestId, "approve");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await approved.json()).toMatchObject({
      request: { status: "approved", decidedBy: b.userId },
    });
    expect(await switchOf(workspaceId)).toBe(false);
    expect(await approvalActs(workspaceId)).toEqual(["approve", "request"]);
    const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "setting" });
    expect(rows.map((row) => row.detail).join(" | ")).toContain(
      `value=false request=${requestId} approver=${b.userId}`,
    );
  });

  it("takes a Site administrator who is not the requester, and refuses one who is", async () => {
    const workspaceId = await newWorkspace();
    const sole = await administrator(workspaceId);
    await publisher(workspaceId);
    await publisher(workspaceId);
    expect((await setSwitch(sole, workspaceId, true)).status).toBe(200);

    const bySole = await setSwitch(sole, workspaceId, false);
    expect(bySole.status).toBe(202);
    const approved = await decide(site, workspaceId, await requestIdOf(bySole), "approve");
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await switchOf(workspaceId)).toBe(false);

    expect((await setSwitch(sole, workspaceId, true)).status).toBe(200);
    const bySite = await setSwitch(site, workspaceId, false);
    expect(bySite.status).toBe(202);
    const siteRequest = await requestIdOf(bySite);
    expect(await codeOf(await decide(site, workspaceId, siteRequest, "approve"))).toBe(
      "OWN_REQUEST",
    );
    expect((await decide(sole, workspaceId, siteRequest, "approve")).status).toBe(200);
    expect(await switchOf(workspaceId)).toBe(false);
  });

  it("applies nothing when rejected", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const requestId = await requestIdOf(await setSwitch(a, workspaceId, false));
    expect(await codeOf(await decide(a, workspaceId, requestId, "reject"))).toBe("OWN_REQUEST");
    const rejected = await decide(b, workspaceId, requestId, "reject");
    expect(rejected.status).toBe(200);
    expect(await switchOf(workspaceId)).toBe(true);
    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "REQUEST_NOT_PENDING",
    );
    expect(await approvalActs(workspaceId)).toEqual(["reject", "request"]);
  });

  it("expires after 7 days and can then no longer be approved", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const requestId = await requestIdOf(await setSwitch(a, workspaceId, false));
    await testDb.client.query(
      `update control.approval_requests
          set requested_at = requested_at - interval '8 days',
              expires_at = expires_at - interval '8 days'
        where request_id = $1`,
      [requestId],
    );
    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "REQUEST_EXPIRED",
    );
    expect(await expireDueApprovalRequests(deps, new Date())).toBeGreaterThanOrEqual(1);
    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "REQUEST_NOT_PENDING",
    );
    expect(await switchOf(workspaceId)).toBe(true);
    expect(await approvalActs(workspaceId)).toEqual(["expire", "request"]);
  });

  it("refuses the approval once the requester is no longer an administrator", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const requestId = await requestIdOf(await setSwitch(a, workspaceId, false));
    await setMemberRole(testDb.db, workspaceId, a.userId, "member");
    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "REQUESTER_NOT_ADMINISTRATOR",
    );
    expect(await switchOf(workspaceId)).toBe(true);
  });

  it("refuses a disabled or unclaimed account as the approver (criterion 40)", async () => {
    const { workspaceId, a } = await ruledWorkspace();
    const requestId = await requestIdOf(await setSwitch(a, workspaceId, false));
    const disabled = await administrator(workspaceId);
    await disableSeededAccount(testDb.db, disabled.userId, new Date());
    const unclaimed = await administrator(workspaceId, { claimed: false });
    for (const approver of [disabled, unclaimed]) {
      expect([401, 403]).toContain(
        (await decide(approver, workspaceId, requestId, "approve")).status,
      );
    }
    expect(await switchOf(workspaceId)).toBe(true);
  });
});

describe("a self-grant with second approval on (criteria 32 to 35, 49)", () => {
  it("joins the requester to the group only on another administrator's approval", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const teamId = await responseGroup(workspaceId);
    const held = await as(a, "POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
      userId: a.userId,
    });
    expect(held.status).toBe(202);
    expect(await held.clone().json()).toMatchObject({
      request: { payload: { roles: ["responses.viewer"], environments: ["prod"] } },
    });
    expect(await listAccessGroupHolders(testDb.db, teamId)).toEqual([]);
    const requestId = await requestIdOf(held);
    expect(await codeOf(await decide(a, workspaceId, requestId, "approve"))).toBe("OWN_REQUEST");

    expect((await decide(b, workspaceId, requestId, "approve")).status).toBe(200);
    expect((await listAccessGroupHolders(testDb.db, teamId)).map((row) => row.userId)).toEqual([
      a.userId,
    ]);
    const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "grant" });
    expect(rows.map((row) => row.detail).join(" | ")).toContain(
      `request=${requestId} approver=${b.userId}`,
    );
  });

  it("never grants a role or environment added to the group after the request", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const teamId = await responseGroup(workspaceId);
    const requestId = await requestIdOf(
      await as(a, "POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
        userId: a.userId,
      }),
    );
    const widened = await as(b, "PUT", `/workspaces/${workspaceId}/access-groups/${teamId}`, {
      name: "Widened",
      roles: ["responses.viewer", "responses.eraser"],
      environments: ["prod"],
    });
    expect(widened.status, await widened.clone().text()).toBe(200);

    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "ACCESS_GROUP_CHANGED",
    );
    expect(await listAccessGroupHolders(testDb.db, teamId)).toEqual([]);
    // Ended rather than left pending, and not as a rejection by the approver who tried.
    expect(await approvalActs(workspaceId)).toEqual(["lapsed", "request"]);
    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "REQUEST_NOT_PENDING",
    );
    const again = await as(
      a,
      "POST",
      `/workspaces/${workspaceId}/access-groups/${teamId}/holders`,
      { userId: a.userId },
    );
    expect(again.status, await again.clone().text()).toBe(202);
  });

  it("holds the edit that gives a group the requester is in a response role, then applies it", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const editors = await createAccessGroup(testDb.db, {
      workspaceId,
      name: "Role-less to start",
      roles: ["forms.editor"],
      environments: [],
    });
    const joined = await as(
      a,
      "POST",
      `/workspaces/${workspaceId}/access-groups/${editors.teamId}/holders`,
      { userId: a.userId },
    );
    expect(joined.status).toBe(201);

    const held = await as(a, "PUT", `/workspaces/${workspaceId}/access-groups/${editors.teamId}`, {
      name: "Role-less to start",
      roles: ["forms.editor", "responses.viewer"],
      environments: ["prod"],
    });
    expect(held.status).toBe(202);
    const requestId = await requestIdOf(held);

    expect((await decide(b, workspaceId, requestId, "approve")).status).toBe(200);
    const group = await as(b, "GET", `/workspaces/${workspaceId}/access-groups`);
    const stored = (
      (await group.json()) as { groups: { teamId: string; roles: string[] }[] }
    ).groups.find((row) => row.teamId === editors.teamId);
    expect(stored?.roles).toEqual(["forms.editor", "responses.viewer"]);
  });

  it("refuses the approval of a held edit once the group changed underneath it", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const group = await createAccessGroup(testDb.db, {
      workspaceId,
      name: "Moving",
      roles: ["forms.editor"],
      environments: [],
    });
    await as(a, "POST", `/workspaces/${workspaceId}/access-groups/${group.teamId}/holders`, {
      userId: a.userId,
    });
    const requestId = await requestIdOf(
      await as(a, "PUT", `/workspaces/${workspaceId}/access-groups/${group.teamId}`, {
        name: "Moving",
        roles: ["forms.editor", "responses.viewer"],
        environments: ["prod"],
      }),
    );
    await as(b, "PUT", `/workspaces/${workspaceId}/access-groups/${group.teamId}`, {
      name: "Moving",
      roles: ["forms.editor", "forms.viewer"],
      environments: [],
    });
    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "ACCESS_GROUP_CHANGED",
    );
    expect(await approvalActs(workspaceId)).toEqual(["lapsed", "request"]);
    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "REQUEST_NOT_PENDING",
    );
  });

  it("applies the name the held edit asked for, with its roles and environments", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const group = await createAccessGroup(testDb.db, {
      workspaceId,
      name: "Before the edit",
      roles: ["forms.editor"],
      environments: [],
    });
    expect(
      (
        await as(a, "POST", `/workspaces/${workspaceId}/access-groups/${group.teamId}/holders`, {
          userId: a.userId,
        })
      ).status,
    ).toBe(201);

    const held = await as(a, "PUT", `/workspaces/${workspaceId}/access-groups/${group.teamId}`, {
      name: "After the edit",
      roles: ["forms.editor", "responses.viewer"],
      environments: ["prod"],
    });
    expect(held.status, await held.clone().text()).toBe(202);
    expect(await held.clone().json()).toMatchObject({
      group: { name: "Before the edit" },
      request: { payload: { name: "After the edit" } },
    });

    expect((await decide(b, workspaceId, await requestIdOf(held), "approve")).status).toBe(200);
    const listed = await as(b, "GET", `/workspaces/${workspaceId}/access-groups`);
    const stored = (
      (await listed.json()) as { groups: { teamId: string; name: string; roles: string[] }[] }
    ).groups.find((row) => row.teamId === group.teamId);
    expect(stored).toMatchObject({
      name: "After the edit",
      roles: ["forms.editor", "responses.viewer"],
    });
  });

  it("applies the same edit by an administrator who is not in the group at once", async () => {
    const { workspaceId, b } = await ruledWorkspace();
    const group = await createAccessGroup(testDb.db, {
      workspaceId,
      name: "Not mine",
      roles: ["responses.viewer"],
      environments: ["test"],
    });
    const applied = await as(b, "PUT", `/workspaces/${workspaceId}/access-groups/${group.teamId}`, {
      name: "Not mine",
      roles: ["responses.viewer"],
      environments: ["test", "prod"],
    });
    expect(applied.status).toBe(200);
  });

  it("refuses the approval once the requester is no longer an administrator", async () => {
    const { workspaceId, a, b } = await ruledWorkspace();
    const teamId = await responseGroup(workspaceId);
    const requestId = await requestIdOf(
      await as(a, "POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
        userId: a.userId,
      }),
    );
    await setMemberRole(testDb.db, workspaceId, a.userId, "member");
    expect(await codeOf(await decide(b, workspaceId, requestId, "approve"))).toBe(
      "REQUESTER_NOT_ADMINISTRATOR",
    );
    expect(await listAccessGroupHolders(testDb.db, teamId)).toEqual([]);
  });

  it("with the rule off, a self-grant applies at once and writes a row (criterion 49)", async () => {
    const workspaceId = await newWorkspace();
    const a = await administrator(workspaceId);
    const teamId = await responseGroup(workspaceId);
    const res = await as(a, "POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
      userId: a.userId,
    });
    expect(res.status).toBe(201);
    const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "grant" });
    expect(rows.map((row) => row.detail).join(" | ")).toContain(`subject=${a.userId}`);
  });
});

describe("an assistant step that confirms a held act", () => {
  it("records the step for a held self-grant", async () => {
    const { workspaceId, a } = await ruledWorkspace();
    const teamId = await responseGroup(workspaceId);
    const { res, proposalId } = await asStep(
      a,
      "POST",
      `/workspaces/${workspaceId}/access-groups/${teamId}/holders`,
      { kind: "access.grant", args: { workspaceId, teamId, email: a.email } },
      { email: a.email },
    );
    expect(res.status, await res.clone().text()).toBe(202);
    expect(await listAccessGroupHolders(testDb.db, teamId)).toEqual([]);
    expect(await stepRows(proposalId)).toEqual([{ kind: "access.grant", detail: teamId }]);
  });

  it("records the step for a held switch-off", async () => {
    const { workspaceId, a } = await ruledWorkspace();
    const { res, proposalId } = await asStep(
      a,
      "PUT",
      `/workspaces/${workspaceId}/settings`,
      {
        kind: "workspace.settings",
        args: { workspaceId, requireSecondApprover: false },
      },
      { requireSecondApprover: false },
    );
    expect(res.status, await res.clone().text()).toBe(202);
    expect(await switchOf(workspaceId)).toBe(true);
    expect(await stepRows(proposalId)).toEqual([
      { kind: "workspace.settings", detail: workspaceId },
    ]);
  });
});

describe("the Requests row and Site configuration list", () => {
  it("lists workspace requests and leaves a held publish to its form", async () => {
    const { workspaceId, a } = await ruledWorkspace();
    const off = await requestIdOf(await setSwitch(a, workspaceId, false));
    const publish = await insertApprovalRequest(testDb.db, {
      kind: "draft-publish",
      workspaceId,
      target: "frm_listed",
      payload: { revision: 1, contentHash: "0".repeat(64) },
      requestedBy: a.userId,
      requestedAt: new Date(),
    });

    const row = await as(a, "GET", `/workspaces/${workspaceId}/approval-requests`);
    expect(row.status, await row.clone().text()).toBe(200);
    const listed = ((await row.json()) as { requests: { requestId: string }[] }).requests.map(
      (request) => request.requestId,
    );
    expect(listed).toEqual([off]);

    const siteList = await as(site, "GET", "/approval-requests?scope=workspace&status=pending");
    const ids = ((await siteList.json()) as { requests: { requestId: string }[] }).requests.map(
      (request) => request.requestId,
    );
    expect(ids).toContain(off);
    expect(ids).not.toContain(publish?.requestId);

    expect(await codeOf(await decide(site, workspaceId, publish!.requestId, "approve"))).toBe(
      "REQUEST_DECIDED_ON_THE_FORM",
    );
  });

  it("is not readable or decidable by a publisher", async () => {
    const { workspaceId, a } = await ruledWorkspace();
    const holder = await publisher(workspaceId);
    const requestId = await requestIdOf(await setSwitch(a, workspaceId, false));
    expect((await as(holder, "GET", `/workspaces/${workspaceId}/approval-requests`)).status).toBe(
      403,
    );
    expect((await decide(holder, workspaceId, requestId, "approve")).status).toBe(403);
  });

  it("does not decide another workspace's request", async () => {
    const first = await ruledWorkspace();
    const second = await ruledWorkspace();
    const requestId = await requestIdOf(await setSwitch(first.a, first.workspaceId, false));
    expect(await codeOf(await decide(second.b, second.workspaceId, requestId, "approve"))).toBe(
      "REQUEST_NOT_FOUND",
    );
    await setRequireSecondApprover(testDb.db, first.workspaceId, true);
    expect(await switchOf(first.workspaceId)).toBe(true);
  });
});
