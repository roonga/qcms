import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SEED_WORKSPACE_ID,
  authTeam,
  countAccessAuditByKind,
  createEnvironment,
  listAccessGroupHolders,
  listAccessGroups,
  listWorkspaceMembers,
  setMemberRole,
  setRequireSecondApprover,
  writeAgentActionRow,
  writeSiteAuditRow,
  writeSiteAuditWithMirror,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";

import { createApp, type SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import {
  disableSeededAccount,
  internalTokenFor,
  makeDeps,
  seedAdminSession,
  seedGrants,
  suspendSeededGrant,
  validEnv,
} from "../../test-support.js";
import { createAdminAuth, MEMBERSHIP_LIMIT } from "../auth/instance.js";
import { pluginWriteBackstop } from "../auth/plugin-write-backstop.js";
import { registerWorkspaces } from "../workspaces/route.js";
import { registerGrantCheck } from "./middleware.js";
import { registerMembership } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let deps: Deps;
let undecidedApp: ReturnType<typeof createApp>;
let app: ReturnType<typeof createApp>;
let internalToken: string;

let ownerToken: string;
let ownerId: string;
let secondOwnerToken: string;
let secondOwnerId: string;
let editorToken: string;
let editorId: string;
let nobodyToken: string;
let workspaceOwnerToken: string;

const registerUndecidedRoute: SliceRegistrar = (group): void => {
  // Group-relative: the admin group is mounted at `/admin`, so this serves
  // `/admin/not-in-the-matrix`.
  group.get("/not-in-the-matrix", (c) => c.json({ served: true }));
};

beforeAll(async () => {
  testDb = await startTestDb();
  deps = makeDeps({ db: testDb.db, env: validEnv() });
  undecidedApp = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerUndecidedRoute,
      ],
    },
  });
  app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerMembership,
        registerWorkspaces,
      ],
    },
  });
  internalToken = internalTokenFor(deps.config);

  const owner = await seedAdminSession(testDb.db, { label: "owner", siteAdministrator: true });
  ownerToken = owner.token;
  ownerId = owner.userId;

  const second = await seedAdminSession(testDb.db, { label: "second", grants: [] });
  secondOwnerToken = second.token;
  secondOwnerId = second.userId;

  const editor = await seedAdminSession(testDb.db, {
    label: "editor",
    owner: false,
    grants: ["forms.editor"],
  });
  editorToken = editor.token;
  editorId = editor.userId;

  // A real Workspace administrator: the `member` row's owner role.
  const workspaceOwner = await seedAdminSession(testDb.db, {
    label: "wsowner",
    owner: true,
    grants: ["forms.editor"],
  });
  workspaceOwnerToken = workspaceOwner.token;

  const nobody = await seedAdminSession(testDb.db, {
    label: "nobody",
    owner: false,
    grants: [],
  });
  nobodyToken = nobody.token;

  // A third environment, so the combined-set ordering cases have a set to be out of
  // order: the shipped set is `test` then `prod`, and `dev` lands third.
  await createEnvironment(testDb.db, { name: "dev" });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

function headersFor(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-qcms-internal-token": internalToken,
    [ADMIN_SESSION_HEADER]: token,
  };
}

async function as(token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(`/admin${path}`, {
    method,
    headers: headersFor(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  return as(ownerToken, method, path, body);
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface GroupBody {
  group: {
    teamId: string;
    name: string;
    roles: string[];
    environments: string[];
    externalGroupId: string | null;
    holders: { userId: string; email: string }[];
  };
}

async function createGroup(body: {
  name: string;
  roles: string[];
  environments: string[];
}): Promise<string> {
  const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as GroupBody).group.teamId;
}

async function auditCounts(): Promise<Readonly<Record<string, number>>> {
  return countAccessAuditByKind(testDb.db, SEED_WORKSPACE_ID);
}

const STARTER_GROUP_NAMES = ["Authors", "Publishers", "Response viewers", "Response erasers"];

async function createWorkspace(name: string, slug: string): Promise<string> {
  const res = await send("POST", "/workspaces", { name, slug });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { workspace: { workspaceId: string } }).workspace.workspaceId;
}

async function auditRowsOfKind(
  workspaceId: string,
  kind: string,
): Promise<readonly { kind: string; detail: string | null; environment: string | null }[]> {
  const res = await send("GET", `/workspaces/${workspaceId}/audit?kind=${kind}&pageSize=200`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (
    (await res.json()) as {
      rows: { kind: string; detail: string | null; environment: string | null }[];
    }
  ).rows;
}

async function administratorRows(
  workspaceId: string,
): Promise<readonly { kind: string; detail: string | null; environment: string | null }[]> {
  return auditRowsOfKind(workspaceId, "administrator");
}

/** Make a second account a Workspace administrator of this workspace. */
async function appointAdministrator(workspaceId: string, label: string): Promise<string> {
  const account = await seedAdminSession(testDb.db, {
    label,
    membership: false,
  });
  // A plain member first, so the route under test is what appoints them and the
  // `administrator` row is the route's own.
  await seedGrants(testDb.db, {
    userId: account.userId,
    workspaceId,
    grants: [],
    owner: false,
  });
  expect(
    (
      await send("PUT", `/workspaces/${workspaceId}/members/${account.userId}`, {
        role: "forms.owner",
      })
    ).status,
  ).toBe(200);
  return account.userId;
}

describe("the membership list and the capability endpoint (criterion 7, Q35)", () => {
  it("serves the membership list to an owner, with the groups each member holds", async () => {
    const res = await send("GET", `/workspaces/${SEED_WORKSPACE_ID}/members`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      members: { userId: string; role: string; groups: string[] }[];
    };
    const owner = body.members.find((member) => member.userId === ownerId);
    expect(owner?.role).toBe("forms.owner");
    expect(owner?.groups).toContain("Every environment: responses.viewer");
    const editor = body.members.find((member) => member.userId === editorId);
    expect(editor?.role).toBe("member");
    expect(editor?.groups).toEqual(["Every environment: forms.editor"]);
  });

  it("refuses the membership list to a grant holder who is not an owner", async () => {
    const res = await as(editorToken, "GET", `/workspaces/${SEED_WORKSPACE_ID}/members`);
    expect(res.status).toBe(403);
    expect((await res.json()) as ErrorBody).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("answers each caller their own grants and nobody else's", async () => {
    const res = await as(editorToken, "GET", "/me/access");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      userId: string;
      installationAdmin: boolean;
      workspaces: {
        workspaceId: string;
        memberRole: string | null;
        grants: { name: string; roles: string[]; environments: string[] }[];
        environments: string[];
      }[];
    };
    expect(body.userId).toBe(editorId);
    const workspace = body.workspaces.find((w) => w.workspaceId === SEED_WORKSPACE_ID);
    expect(workspace?.grants.flatMap((grant) => grant.roles)).toEqual(["forms.editor"]);
    // Edit forms applies in every environment, so its group names none.
    expect(workspace?.grants.map((grant) => grant.environments)).toEqual([[]]);
    expect(workspace?.memberRole).toBe("member");
    expect(workspace?.environments).toEqual(["test", "prod", "dev"]);
    expect(JSON.stringify(body)).not.toContain(ownerId);
  });

  it("needs no grant at all, because it is the answer to what the caller holds", async () => {
    const res = await as(nobodyToken, "GET", "/me/access");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaces: { grants: unknown[]; memberRole: string | null }[];
    };
    expect(body.workspaces[0]?.grants).toEqual([]);
    expect(body.workspaces[0]?.memberRole).toBe("member");
  });

  it("names the active Site administrators to a caller who holds nothing, and to nobody else", async () => {
    const unclaimedAdmin = await seedAdminSession(testDb.db, {
      label: "unclaimedadmin",
      claimed: false,
      siteAdministrator: true,
      grants: [],
    });
    const disabledAdmin = await seedAdminSession(testDb.db, {
      label: "disabledadmin",
      disabledAt: new Date(),
      siteAdministrator: true,
      grants: [],
    });
    const nothing = (await (await as(nobodyToken, "GET", "/me/access")).json()) as {
      siteAdministrators: { name: string; email: string }[];
    };
    const emails = nothing.siteAdministrators.map((admin) => admin.email);
    expect(emails).toContain(`owner.${ownerId}@admin.test`);
    expect(emails).not.toContain(`unclaimedadmin.${unclaimedAdmin.userId}@admin.test`);
    expect(emails).not.toContain(`disabledadmin.${disabledAdmin.userId}@admin.test`);
    expect(Object.keys(nothing.siteAdministrators[0] ?? {}).sort()).toEqual(["email", "name"]);

    for (const token of [editorToken, workspaceOwnerToken, ownerToken]) {
      const held = (await (await as(token, "GET", "/me/access")).json()) as {
        siteAdministrators: unknown[];
      };
      expect(held.siteAdministrators).toEqual([]);
    }
  });
});

describe("every grant holder carries a `member` row with the empty role (criterion 17)", () => {
  it("writes one when a grant is created for somebody with none", async () => {
    const teamId = await createGroup({
      name: "Response erasers",
      roles: ["responses.eraser"],
      environments: ["prod"],
    });
    const outsider = await seedAdminSession(testDb.db, {
      label: "outsider",
      membership: false,
    });
    expect(
      (await listWorkspaceMembers(testDb.db, SEED_WORKSPACE_ID)).some(
        (member) => member.userId === outsider.userId,
      ),
    ).toBe(false);

    const granted = await send(
      "POST",
      `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}/holders`,
      { userId: outsider.userId },
    );
    expect(granted.status, await granted.clone().text()).toBe(201);

    const members = await listWorkspaceMembers(testDb.db, SEED_WORKSPACE_ID);
    const row = members.find((member) => member.userId === outsider.userId);
    expect(
      row?.role,
      "a grant holder with no member row is a shape the library does not model",
    ).toBe("member");
  });

  it("grants nothing on its own: that account reaches what no grant reaches", async () => {
    const withRow = await as(nobodyToken, "GET", `/workspaces/${SEED_WORKSPACE_ID}/members`);
    const withoutRow = await (async () => {
      const stranger = await seedAdminSession(testDb.db, {
        label: "stranger",
        membership: false,
      });
      return as(stranger.token, "GET", `/workspaces/${SEED_WORKSPACE_ID}/members`);
    })();
    expect(withRow.status).toBe(403);
    expect(withoutRow.status).toBe(403);
  });
});

describe("access-group names and the role set (criteria 12 and 13)", () => {
  it("refuses a duplicate stored name in one workspace and accepts it in another", async () => {
    await createGroup({
      name: "Readers",
      roles: ["responses.viewer"],
      environments: ["test"],
    });
    const again = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "Readers",
      roles: ["responses.viewer"],
      environments: ["test"],
    });
    expect(again.status).toBe(409);
    expect((await again.json()) as ErrorBody).toMatchObject({
      error: { code: "ACCESS_GROUP_NAME_TAKEN" },
    });

    const other = await send("POST", "/workspaces", { name: "Other", slug: "other-names" });
    expect(other.status).toBe(201);
    const otherId = ((await other.json()) as { workspace: { workspaceId: string } }).workspace
      .workspaceId;
    const accepted = await send("POST", `/workspaces/${otherId}/access-groups`, {
      name: "Readers",
      roles: ["responses.viewer"],
      environments: ["test"],
    });
    expect(accepted.status, await accepted.clone().text()).toBe(201);
  });

  it("stores a combined set in the environments table's order, whatever order it was sent in", async () => {
    // The live order is `test`, `prod`, `dev`.
    const accepted = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "Out of order",
      roles: ["responses.viewer"],
      environments: ["dev", "test"],
    });
    expect(accepted.status, await accepted.clone().text()).toBe(201);
    expect(((await accepted.json()) as GroupBody).group.environments).toEqual(["test", "dev"]);
  });

  it("refuses an environment the live set does not hold", async () => {
    const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "Staging viewers",
      roles: ["responses.viewer"],
      environments: ["staging"],
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as ErrorBody).toMatchObject({
      error: { code: "ACCESS_GROUP_SCOPE_INVALID" },
    });
  });

  it("refuses a role no access group carries", async () => {
    for (const role of ["forms.approver", "forms.owner", "forms.superuser"]) {
      const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
        name: `Group for ${role}`,
        roles: [role],
        environments: ["prod"],
      });
      expect(res.status, role).toBe(400);
    }
  });

  it("refuses a group that names forms, because a group has no form scope", async () => {
    const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "Scoped to one form",
      roles: ["responses.viewer"],
      environments: ["prod"],
      forms: ["frm_claims"],
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("forms");
  });

  it("refuses an environment role with no environment, and a forms role with one", async () => {
    for (const role of ["forms.publisher", "responses.viewer", "responses.eraser"]) {
      const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
        name: `No environment for ${role}`,
        roles: [role],
        environments: [],
      });
      expect(res.status, role).toBe(400);
      expect((await res.json()) as ErrorBody).toMatchObject({
        error: { code: "ACCESS_GROUP_SCOPE_INVALID" },
      });
    }
    for (const role of ["forms.viewer", "forms.editor"]) {
      const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
        name: `An environment for ${role}`,
        roles: [role],
        environments: ["prod"],
      });
      expect(res.status, role).toBe(400);
      expect((await res.json()) as ErrorBody).toMatchObject({
        error: { code: "ACCESS_GROUP_SCOPE_INVALID" },
      });
    }
  });

  it("serves a group as its own name, roles and environments and nothing derived", async () => {
    const res = await send("GET", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspaceId: string;
      groups: Record<string, unknown>[];
    };
    expect(body.workspaceId).toBe(SEED_WORKSPACE_ID);
    expect(body).not.toHaveProperty("scopeNote");
    const group = body.groups.find((g) => g["name"] === "Readers");
    expect(group).toBeDefined();
    expect(Object.keys(group ?? {}).sort()).toEqual([
      "environments",
      "externalGroupId",
      "holders",
      "name",
      "roles",
      "teamId",
    ]);

    const stored = await testDb.db
      .select({ name: authTeam.name })
      .from(authTeam)
      .where(eq(authTeam.name, "Readers"));
    expect(stored[0]?.name).toBe("Readers");
  });

  it("keeps a member row's role to the administrator flag, whatever the row says", async () => {
    const subject = await seedAdminSession(testDb.db, {
      label: "memberrow",
      grants: [],
    });
    await setMemberRole(testDb.db, SEED_WORKSPACE_ID, subject.userId, "responses.viewer");

    const body = (await (await as(subject.token, "GET", "/me/access")).json()) as {
      capabilities: Record<string, boolean>;
      workspaces: { memberRole: string | null }[];
    };
    expect(body.workspaces[0]?.memberRole).toBe("member");
    expect(Object.values(body.capabilities).every((held) => held === false)).toBe(true);

    await setMemberRole(testDb.db, SEED_WORKSPACE_ID, subject.userId, "forms.owner");
  });

  it("fails closed on a role name that reaches the row but no declared role", async () => {
    const teamId = await createGroup({
      name: "Mislabelled",
      roles: ["responses.viewer"],
      environments: ["prod"],
    });
    const subject = await seedAdminSession(testDb.db, {
      label: "mislabelled",
      membership: false,
    });
    expect(
      (
        await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}/holders`, {
          userId: subject.userId,
        })
      ).status,
    ).toBe(201);

    const before = (await (await as(subject.token, "GET", "/me/access")).json()) as {
      capabilities: Record<string, boolean>;
    };
    expect(before.capabilities["operations"]).toBe(true);

    // A group row carries access roles only, so neither an undeclared name nor the
    // administrator flag survives the read, let alone grants anything.
    for (const roles of [["forms.superuser"], ["forms.owner"]]) {
      await testDb.db.update(authTeam).set({ roles }).where(eq(authTeam.id, teamId));

      const after = (await (await as(subject.token, "GET", "/me/access")).json()) as {
        capabilities: Record<string, boolean>;
        workspaces: { grants: { roles: string[] }[] }[];
      };
      expect(after.workspaces[0]?.grants.flatMap((grant) => grant.roles)).toEqual([]);
      expect(Object.values(after.capabilities).every((held) => held === false)).toBe(true);
    }

    await testDb.db
      .update(authTeam)
      .set({ roles: ["responses.viewer"] })
      .where(eq(authTeam.id, teamId));
  });
});

describe("the two Q39 fields behave as declared (criterion 15)", () => {
  it("accepts no `externalGroupId` on any request body", async () => {
    const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "prod.forms.viewer",
      role: "forms.viewer",
      environments: ["prod"],
      forms: ["all"],
      externalGroupId: "CN=qcms-home,OU=Groups",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("externalGroupId");
  });

  it("leaves `externalGroupId` null on every group this task writes", async () => {
    const res = await send("GET", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`);
    const body = (await res.json()) as { groups: { externalGroupId: string | null }[] };
    expect(body.groups.length).toBeGreaterThan(2);
    for (const group of body.groups) expect(group.externalGroupId).toBeNull();
  });

  it("is unique at the database, so task C3's mapping cannot double up", async () => {
    const groups = await listAccessGroups(testDb.db, SEED_WORKSPACE_ID);
    const [first, second] = groups;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    await testDb.db
      .update(authTeam)
      .set({ externalGroupId: "CN=one" })
      .where(eq(authTeam.id, (first as { teamId: string }).teamId));
    await expect(
      testDb.db
        .update(authTeam)
        .set({ externalGroupId: "CN=one" })
        .where(eq(authTeam.id, (second as { teamId: string }).teamId)),
    ).rejects.toThrow();
    await testDb.db
      .update(authTeam)
      .set({ externalGroupId: null })
      .where(eq(authTeam.id, (first as { teamId: string }).teamId));
  });
});

describe("the workspace settings body is the one switch (criterion 22)", () => {
  it("onboarding an editor creates nothing beside the editor grant", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Seed off", slug: "seed-off" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    const settings = await send("GET", `/workspaces/${workspaceId}/access-groups`);
    expect(settings.status).toBe(200);

    const editorGroup = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "Editors",
      roles: ["forms.editor"],
      environments: [],
    });
    const teamId = ((await editorGroup.json()) as GroupBody).group.teamId;
    const subject = await seedAdminSession(testDb.db, { label: "newedit", membership: false });
    expect(
      (
        await send("POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
          userId: subject.userId,
        })
      ).status,
    ).toBe(201);

    const groups = await listAccessGroups(testDb.db, workspaceId);
    expect(groups.map((group) => group.name).sort()).toEqual(
      [...STARTER_GROUP_NAMES, "Editors"].sort(),
    );
  });

  it("writes a `setting` row with the name and the new value, and no environment or form", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Seed on", slug: "seed-on" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;

    const turnedOn = await send("PUT", `/workspaces/${workspaceId}/settings`, {
      requireSecondApprover: true,
    });
    expect(turnedOn.status, await turnedOn.clone().text()).toBe(200);
    expect((await turnedOn.json()) as Record<string, unknown>).toEqual({
      workspaceId,
      requireSecondApprover: true,
    });

    const audit = await send("GET", `/workspaces/${workspaceId}/audit?kind=setting`);
    const rows = (
      (await audit.json()) as {
        rows: { kind: string; environment: string | null; formId: string | null; detail: string }[];
      }
    ).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0] as { environment: null; formId: null; detail: string };
    expect(row.environment).toBeNull();
    expect(row.formId).toBeNull();
    expect(row.detail).toContain("setting=requireSecondApprover");
    expect(row.detail).toContain("value=true");
  });

  it("refuses a body that omits the switch or names the removed seed setting", async () => {
    const workspace = await send("POST", "/workspaces", {
      name: "Strict",
      slug: "strict-settings",
    });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;

    for (const body of [{}, { seedNewEditorsWithTestData: true }]) {
      const res = await send("PUT", `/workspaces/${workspaceId}/settings`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("leaves the removed seed setting out of the workspace list", async () => {
    const res = await send("GET", "/workspaces");
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("seedNewEditorsWithTestData");
  });
});

describe("every grant and every revoke writes a SEC-15 row (criterion 19, Q56)", () => {
  it("counts one row per grant and one per revoke, and none without", async () => {
    const before = await auditCounts();
    const teamId = await createGroup({
      name: "Claims response viewers",
      roles: ["responses.viewer"],
      environments: ["prod"],
    });
    // A group with no holders grants nobody anything, so there is nothing to record yet.
    expect((await auditCounts()).grant ?? 0).toBe(before.grant ?? 0);

    const subject = await seedAdminSession(testDb.db, { label: "claims", membership: false });
    await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}/holders`, {
      userId: subject.userId,
    });
    expect((await auditCounts()).grant ?? 0).toBe((before.grant ?? 0) + 1);

    await send(
      "DELETE",
      `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}/holders/${subject.userId}`,
    );
    expect((await auditCounts()).revoke ?? 0).toBe((before.revoke ?? 0) + 1);
  });

  it("names the environment on a group naming one and leaves it empty otherwise (Q61)", async () => {
    const subject = await seedAdminSession(testDb.db, { label: "q61", membership: false });

    const scoped = await createGroup({
      name: "Erasers q61",
      roles: ["responses.eraser"],
      environments: ["prod"],
    });
    await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${scoped}/holders`, {
      userId: subject.userId,
    });

    const wide = await createGroup({
      name: "Viewers q61",
      roles: ["forms.viewer"],
      environments: [],
    });
    await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${wide}/holders`, {
      userId: subject.userId,
    });

    const audit = await send("GET", `/workspaces/${SEED_WORKSPACE_ID}/audit?kind=grant`);
    const rows = (
      (await audit.json()) as {
        rows: { environment: string | null; formId: string | null; detail: string }[];
      }
    ).rows;
    const narrow = rows.find((row) => row.detail.includes("group=Erasers q61"));
    expect(narrow?.environment).toBe("prod");
    expect(narrow?.detail).toContain("environments=prod");
    const everywhere = rows.find((row) => row.detail.includes("group=Viewers q61"));
    expect(everywhere?.environment).toBeNull();
    expect(everywhere?.detail).toContain("environments=");
  });

  it("writes one revoke row per holder when a whole group is removed", async () => {
    const teamId = await createGroup({
      name: "Cascade viewers",
      roles: ["forms.viewer"],
      environments: [],
    });
    const a = await seedAdminSession(testDb.db, { label: "casc1", membership: false });
    const b = await seedAdminSession(testDb.db, { label: "casc2", membership: false });
    for (const holder of [a, b]) {
      await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}/holders`, {
        userId: holder.userId,
      });
    }

    const before = (await auditCounts()).revoke ?? 0;
    const removed = await send(
      "DELETE",
      `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}`,
    );
    expect(removed.status).toBe(204);
    expect((await auditCounts()).revoke ?? 0).toBe(before + 2);
  });

  it("audits an administrator appointment and its removal, as `administrator` both ways", async () => {
    const before = await auditCounts();
    expect(
      (
        await send("PUT", `/workspaces/${SEED_WORKSPACE_ID}/members/${editorId}`, {
          role: "forms.owner",
        })
      ).status,
    ).toBe(200);
    expect((await auditCounts()).administrator ?? 0).toBe((before.administrator ?? 0) + 1);
    expect(
      (
        await send("PUT", `/workspaces/${SEED_WORKSPACE_ID}/members/${editorId}`, {
          role: "member",
        })
      ).status,
    ).toBe(200);
    expect((await auditCounts()).administrator ?? 0).toBe((before.administrator ?? 0) + 2);
    const rows = await administratorRows(SEED_WORKSPACE_ID);
    expect(rows.map((row) => row.detail)).toContain(`administrator=appointed subject=${editorId}`);
    expect(rows.map((row) => row.detail)).toContain(`administrator=removed subject=${editorId}`);
  });

  it("refuses to remove a workspace's last Workspace administrator (criterion 86)", async () => {
    const workspaceId = await createWorkspace("Last", "last-owner");
    const res = await send("PUT", `/workspaces/${workspaceId}/members/${ownerId}`, {
      role: "member",
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as ErrorBody).toMatchObject({
      error: { code: "LAST_ADMINISTRATOR" },
    });
  });
});

describe("the self-grant rule (criteria 20 and 21, Q56)", () => {
  it("allows and audits a self-grant with the switch off", async () => {
    const teamId = await createGroup({
      name: "Self viewers",
      roles: ["responses.viewer"],
      environments: ["test"],
    });
    const before = (await auditCounts()).grant ?? 0;
    const res = await send(
      "POST",
      `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}/holders`,
      { userId: ownerId },
    );
    expect(res.status, await res.clone().text()).toBe(201);
    expect((await auditCounts()).grant ?? 0).toBe(before + 1);
  });

  it("refuses a self-grant of a responses role while the switch is on, and takes a second owner", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Two person", slug: "two-person" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    expect(
      (await send("PUT", `/workspaces/${workspaceId}/settings`, { requireSecondApprover: true }))
        .status,
    ).toBe(200);

    const group = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "Readers",
      roles: ["responses.viewer"],
      environments: ["prod"],
    });
    const teamId = ((await group.json()) as GroupBody).group.teamId;

    const refused = await send(
      "POST",
      `/workspaces/${workspaceId}/access-groups/${teamId}/holders`,
      { userId: ownerId },
    );
    expect(refused.status).toBe(409);
    expect((await refused.json()) as ErrorBody).toMatchObject({
      error: { code: "SELF_GRANT_REFUSED" },
    });

    await seedGrants(testDb.db, { userId: secondOwnerId, workspaceId, grants: [] });
    const confirmed = await as(
      secondOwnerToken,
      "POST",
      `/workspaces/${workspaceId}/access-groups/${teamId}/holders`,
      { userId: ownerId },
    );
    expect(confirmed.status, await confirmed.clone().text()).toBe(201);
  });

  it("refuses an authoring self-grant never, because the rule is about response data", async () => {
    const workspace = await send("POST", "/workspaces", {
      name: "Authoring",
      slug: "authoring-self",
    });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    await setRequireSecondApprover(testDb.db, workspaceId, true);
    const group = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "Builders",
      roles: ["forms.editor"],
      environments: [],
    });
    const teamId = ((await group.json()) as GroupBody).group.teamId;
    const res = await send("POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
      userId: ownerId,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("refuses the group edit that adds a response role to a group the actor is in", async () => {
    const workspace = await send("POST", "/workspaces", {
      name: "Self edit role",
      slug: "self-edit-role",
    });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    const group = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "Builders",
      roles: ["forms.editor"],
      environments: [],
    });
    const teamId = ((await group.json()) as GroupBody).group.teamId;
    expect(
      (
        await send("POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
          userId: ownerId,
        })
      ).status,
    ).toBe(201);
    await setRequireSecondApprover(testDb.db, workspaceId, true);

    const refused = await send("PUT", `/workspaces/${workspaceId}/access-groups/${teamId}`, {
      name: "Builders",
      roles: ["forms.editor", "responses.viewer"],
      environments: ["prod"],
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()) as ErrorBody).toMatchObject({
      error: { code: "SELF_GRANT_REFUSED" },
    });

    // The same edit by an administrator who does not hold the group applies at once.
    await seedGrants(testDb.db, { userId: secondOwnerId, workspaceId, grants: [] });
    const applied = await as(
      secondOwnerToken,
      "PUT",
      `/workspaces/${workspaceId}/access-groups/${teamId}`,
      { name: "Builders", roles: ["forms.editor", "responses.viewer"], environments: ["prod"] },
    );
    expect(applied.status, await applied.clone().text()).toBe(200);
  });

  it("refuses the group edit that adds `prod` to a response group the actor is in", async () => {
    const workspace = await send("POST", "/workspaces", {
      name: "Self edit environment",
      slug: "self-edit-environment",
    });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    const group = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "Readers",
      roles: ["responses.viewer"],
      environments: ["test"],
    });
    const teamId = ((await group.json()) as GroupBody).group.teamId;
    expect(
      (
        await send("POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
          userId: ownerId,
        })
      ).status,
    ).toBe(201);
    await setRequireSecondApprover(testDb.db, workspaceId, true);

    const refused = await send("PUT", `/workspaces/${workspaceId}/access-groups/${teamId}`, {
      name: "Readers",
      roles: ["responses.viewer"],
      environments: ["test", "prod"],
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()) as ErrorBody).toMatchObject({
      error: { code: "SELF_GRANT_REFUSED" },
    });

    // A rename that widens nothing is not a self-grant.
    const renamed = await send("PUT", `/workspaces/${workspaceId}/access-groups/${teamId}`, {
      name: "Response readers",
      roles: ["responses.viewer"],
      environments: ["test"],
    });
    expect(renamed.status, await renamed.clone().text()).toBe(200);
  });

  it("refuses one of a concurrent join and a response-role edit of the same group", async () => {
    const workspaceId = await createWorkspace("Self race", "self-race");
    await setRequireSecondApprover(testDb.db, workspaceId, true);

    // Joining a group that carries no response role is allowed, and so is widening a
    // group the actor does not hold. Together they would hand the actor the response
    // role either refuses on its own, so one of the two has to lose.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const name = `Builders ${attempt}`;
      const created = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
        name,
        roles: ["forms.editor"],
        environments: [],
      });
      expect(created.status, await created.clone().text()).toBe(201);
      const teamId = ((await created.json()) as GroupBody).group.teamId;

      const [joined, widened] = await Promise.all([
        send("POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
          userId: ownerId,
        }),
        send("PUT", `/workspaces/${workspaceId}/access-groups/${teamId}`, {
          name,
          roles: ["forms.editor", "responses.viewer"],
          environments: ["prod"],
        }),
      ]);

      const refusedCount = [joined, widened].filter((res) => res.status === 409).length;
      expect(
        [joined.status, widened.status],
        `attempt ${attempt}, refused ${refusedCount}`,
      ).toContain(409);
      expect(refusedCount, `attempt ${attempt}`).toBe(1);
      const refused = joined.status === 409 ? joined : widened;
      expect((await refused.json()) as ErrorBody).toMatchObject({
        error: { code: "SELF_GRANT_REFUSED" },
      });

      // Whichever won, the actor never ends up holding a group that carries the role.
      const stored = (await listAccessGroups(testDb.db, workspaceId)).find(
        (row) => row.teamId === teamId,
      );
      const holders = (await listAccessGroupHolders(testDb.db, teamId)).map(
        (holder) => holder.userId,
      );
      if (holders.includes(ownerId)) {
        expect(stored?.roles, `attempt ${attempt}`).toEqual(["forms.editor"]);
      } else {
        expect(stored?.roles, `attempt ${attempt}`).toEqual(["forms.editor", "responses.viewer"]);
      }

      // The `grant` row names the roles the group carried as the hold was written, not a
      // set read before the lock.
      const grants = (await auditRowsOfKind(workspaceId, "grant"))
        .map((row) => row.detail)
        .filter((detail) => detail?.endsWith(`group=${name}`) === true);
      expect(grants, `attempt ${attempt}`).toHaveLength(joined.status === 201 ? 1 : 0);
      if (joined.status === 201) {
        expect(grants[0], `attempt ${attempt}`).toContain(
          `roles=${(stored?.roles ?? []).join(",")}`,
        );
      }
    }
  });

  it("applies the same rule to the installation administrator", async () => {
    const claimHolder = await as(ownerToken, "GET", "/me/access");
    expect(((await claimHolder.json()) as { installationAdmin: boolean }).installationAdmin).toBe(
      true,
    );
  });
});

describe("the plugin's own team and member write endpoints are refused for everyone (criterion 16)", () => {
  it.each([
    ["POST", "/api/auth/organization/create-team"],
    ["POST", "/api/auth/organization/update-team"],
    ["POST", "/api/auth/organization/remove-team"],
    ["POST", "/api/auth/organization/add-team-member"],
    ["POST", "/api/auth/organization/remove-team-member"],
    ["POST", "/api/auth/organization/add-member"],
    ["POST", "/api/auth/organization/update-member-role"],
    ["POST", "/api/auth/organization/remove-member"],
  ])("%s %s answers 404, not 403, for a `forms.owner`", async (method, path) => {
    // 404 rather than 403: the auth mount's allowlist names none of these paths, so the
    // endpoint is not published at all.
    const res = await app.request(path, {
      method,
      headers: headersFor(ownerToken),
      body: JSON.stringify({ name: "sneaky", organizationId: SEED_WORKSPACE_ID }),
    });
    expect(res.status).toBe(404);
  });
});

describe("the plugin's before-hooks refuse one rule at a time (criterion 14)", () => {
  const auth = (): ReturnType<typeof createAdminAuth> =>
    createAdminAuth({ db: testDb.db, adminAuth: deps.config.adminAuth });

  async function createTeamThroughPlugin(body: Record<string, unknown>): Promise<unknown> {
    type TeamBody = Parameters<ReturnType<typeof auth>["api"]["createTeam"]>[0];
    // Cast past the plugin's body type on purpose: a call naming a role or a scope does
    // not typecheck as a `createTeam` body, and the hook is what has to refuse it.
    return auth().api.createTeam({ body } as unknown as TeamBody);
  }

  it("refuses a name with a leading or trailing space", async () => {
    await expect(
      createTeamThroughPlugin({
        name: " Response viewers",
        organizationId: SEED_WORKSPACE_ID,
        roles: ["responses.viewer"],
        environments: ["prod"],
      }),
    ).rejects.toThrow(/space|GRANT_WRITE_REFUSED/i);
  });

  it("refuses an environment in the set that does not exist", async () => {
    await expect(
      createTeamThroughPlugin({
        name: "Staging viewers",
        organizationId: SEED_WORKSPACE_ID,
        roles: ["responses.viewer"],
        environments: ["staging"],
      }),
    ).rejects.toThrow(/no such environment|GRANT_WRITE_REFUSED/i);
  });

  it("refuses a role outside the five", async () => {
    await expect(
      createTeamThroughPlugin({
        name: "Superusers",
        organizationId: SEED_WORKSPACE_ID,
        roles: ["forms.superuser"],
        environments: ["prod"],
      }),
    ).rejects.toThrow(/no such role|GRANT_WRITE_REFUSED/i);
  });

  it("refuses `forms.owner` written as a team, which is a non-team target", async () => {
    await expect(
      createTeamThroughPlugin({
        name: "Owners",
        organizationId: SEED_WORKSPACE_ID,
        roles: ["forms.owner"],
        environments: [],
      }),
    ).rejects.toThrow(/no such role|GRANT_WRITE_REFUSED/i);
  });

  it("refuses an environment role with no environment", async () => {
    await expect(
      createTeamThroughPlugin({
        name: "Publishers with no environment",
        organizationId: SEED_WORKSPACE_ID,
        roles: ["forms.publisher"],
        environments: [],
      }),
    ).rejects.toThrow(/at least one environment|GRANT_WRITE_REFUSED/i);
  });

  it("refuses an `externalGroupId` at the hook, for a value that reaches one (Q39)", async () => {
    // `input: false` drops the field before any hook sees it, so the backstop branch can
    // only be reached by calling the hook directly.
    const hooks = pluginWriteBackstop(testDb.db);
    await expect(
      hooks.beforeCreateTeam({
        team: {
          name: "External viewers",
          roles: ["forms.viewer"],
          environments: [],
          externalGroupId: "CN=qcms-home",
        },
        organization: { id: SEED_WORKSPACE_ID },
      }),
    ).rejects.toThrow(/externalGroupId|GRANT_WRITE_REFUSED/i);

    await expect(
      hooks.beforeUpdateTeam({
        team: {
          name: "External viewers",
          roles: ["forms.viewer"],
          environments: [],
        },
        updates: { externalGroupId: "CN=qcms-home" },
        organization: { id: SEED_WORKSPACE_ID },
      }),
    ).rejects.toThrow(/externalGroupId|GRANT_WRITE_REFUSED/i);
  });

  it("drops an `externalGroupId` sent to a plugin endpoint before any hook sees it (Q39)", async () => {
    await createTeamThroughPlugin({
      name: "Hooked viewers",
      organizationId: SEED_WORKSPACE_ID,
      roles: ["forms.viewer"],
      environments: [],
      externalGroupId: "CN=qcms-home",
    });
    const written = (await listAccessGroups(testDb.db, SEED_WORKSPACE_ID)).find(
      (group) => group.name === "Hooked viewers",
    );
    expect(written).toBeDefined();
    expect(written?.externalGroupId).toBeNull();
  });

  it("refuses a role set that is missing altogether, which is a team that is not a grant", async () => {
    await expect(
      createTeamThroughPlugin({ name: "Nameless", organizationId: SEED_WORKSPACE_ID }),
    ).rejects.toThrow(/role|GRANT_WRITE_REFUSED/i);
  });

  it("refuses a write into an archived workspace", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Shut", slug: "shut-hooks" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);
    await expect(
      createTeamThroughPlugin({
        name: "Viewers",
        organizationId: workspaceId,
        roles: ["forms.viewer"],
        environments: [],
      }),
    ).rejects.toThrow(/archived|GRANT_WRITE_REFUSED/i);
  });
});

describe("the configuration guards hold against the running instance (criterion 9)", () => {
  it("reports them off the resolved context rather than off the options passed in", async () => {
    const auth = createAdminAuth({ db: testDb.db, adminAuth: deps.config.adminAuth });
    const context = await auth.$context;
    const organization = context.options.plugins?.find((plugin) => plugin.id === "organization");
    expect(organization).toBeDefined();
    const options = (organization as { options?: Record<string, unknown> }).options ?? {};
    expect(options["allowUserToCreateOrganization"]).toBe(false);
    expect(options["disableOrganizationDeletion"]).toBe(true);
    expect(options["membershipLimit"]).toBe(MEMBERSHIP_LIMIT);
    expect(options["membershipLimit"]).toBeGreaterThan(100);
    expect(options["creatorRole"]).toBe("forms.owner");
    expect(options["dynamicAccessControl"]).toMatchObject({ enabled: false });
    expect(options["teams"]).toMatchObject({
      enabled: true,
      defaultTeam: { enabled: false },
      allowRemovingAllTeams: true,
    });
  });

  it("creates no default team beside the four starter groups, and puts nobody in them", async () => {
    const workspace = await send("POST", "/workspaces", { name: "No team", slug: "no-default" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    const groups = await listAccessGroups(testDb.db, workspaceId);
    expect(groups.map((group) => group.name).sort()).toEqual([...STARTER_GROUP_NAMES].sort());
    for (const group of groups) {
      expect(await listAccessGroupHolders(testDb.db, group.teamId)).toEqual([]);
    }
  });

  it("never sets `activeOrganizationId` on a session", async () => {
    // Membership is resolved per request, so an "active organisation" on the session
    // would be a second, stale answer to the same question.
    const rows = await testDb.db.execute<{ count: number }>(
      sql`select count(*)::int as count from control."session"
            where "activeOrganizationId" is not null or "activeTeamId" is not null`,
    );
    expect(rows.rows[0]?.count).toBe(0);
  });
});

describe("an admin route with no row in the matrix is refused at runtime", () => {
  it("refuses a mounted admin route the table has never heard of", async () => {
    const res = await undecidedApp.request("/admin/not-in-the-matrix", {
      headers: { "x-qcms-internal-token": internalToken, [ADMIN_SESSION_HEADER]: ownerToken },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("ROUTE_NOT_AUTHORIZED");
  });

  it("still lets the router answer 404 for a path nothing serves", async () => {
    const res = await undecidedApp.request("/admin/no-such-thing-at-all", {
      headers: { "x-qcms-internal-token": internalToken, [ADMIN_SESSION_HEADER]: ownerToken },
    });
    expect(res.status).toBe(404);
  });
});

interface AgentAuditBody {
  rows: {
    proposalId: string;
    stepIndex: number;
    stepCount: number;
    actor: string;
    actorEmail: string | null;
    environment: string | null;
    formId: string | null;
    kind: string;
    screen: string;
    confirmedAt: string;
    detail: string | null;
  }[];
  total: number;
}

describe("the agent audit is read exactly as the access audit is (SEC-17)", () => {
  beforeAll(async () => {
    const at = new Date("2026-07-20T00:00:00.000Z");
    await writeAgentActionRow(testDb.db, {
      proposalId: "prp_audit_one",
      stepIndex: 0,
      stepCount: 2,
      actor: ownerId,
      workspaceId: SEED_WORKSPACE_ID,
      environment: "test",
      kind: "form.publish",
      screen: "/forms/[formId]",
      proposedAt: at,
      confirmedAt: at,
      detail: "version=3",
    });
    await writeAgentActionRow(testDb.db, {
      proposalId: "prp_audit_one",
      stepIndex: 1,
      stepCount: 2,
      actor: ownerId,
      workspaceId: SEED_WORKSPACE_ID,
      environment: "test",
      kind: "form.release",
      screen: "/forms/[formId]/publish",
      proposedAt: at,
      confirmedAt: new Date(at.getTime() + 1_000),
      detail: "environment=test",
    });
  });

  it("serves the workspace's confirmed steps to an owner, newest first", async () => {
    const res = await send("GET", `/workspaces/${SEED_WORKSPACE_ID}/agent-actions`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as AgentAuditBody;
    const mine = body.rows.filter((row) => row.proposalId === "prp_audit_one");
    expect(mine.map((row) => row.stepIndex)).toEqual([1, 0]);
    expect(mine[0]).toMatchObject({
      kind: "form.release",
      screen: "/forms/[formId]/publish",
      stepCount: 2,
      environment: "test",
      detail: "environment=test",
    });

    expect(mine[0]?.actorEmail).not.toBeNull();
  });

  it("filters on the action kind, as the access audit filters on its own kind", async () => {
    const res = await send(
      "GET",
      `/workspaces/${SEED_WORKSPACE_ID}/agent-actions?kind=form.release`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AgentAuditBody;
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((row) => row.kind === "form.release")).toBe(true);
  });

  it("refuses a caller who may not read the access audit", async () => {
    const res = await as(editorToken, "GET", `/workspaces/${SEED_WORKSPACE_ID}/agent-actions`);
    expect(res.status).toBe(403);
    expect((await res.json()) as ErrorBody).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("refuses a caller with no grant in the workspace at all", async () => {
    const res = await as(nobodyToken, "GET", `/workspaces/${SEED_WORKSPACE_ID}/agent-actions`);
    expect(res.status).toBe(403);
  });

  it("refuses a page that is not a positive integer", async () => {
    const res = await send("GET", `/workspaces/${SEED_WORKSPACE_ID}/agent-actions?page=0`);
    expect(res.status).toBe(400);
    expect((await res.json()) as ErrorBody).toMatchObject({ error: { code: "INVALID_QUERY" } });
  });
});

describe("adding an account the caller cannot add gets one answer (section 7, directory visibility)", () => {
  async function answer(
    token: string,
    teamId: string,
    body: { email: string } | { userId: string },
  ): Promise<{ status: number; text: string }> {
    const res = await as(
      token,
      "POST",
      `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}/holders`,
      body,
    );
    return { status: res.status, text: await res.text() };
  }

  it("is identical in status and body for an unknown and an existing account, on both paths", async () => {
    const teamId = await createGroup({
      name: "Generic viewers",
      roles: ["forms.viewer"],
      environments: [],
    });
    const workspaceOwner = await seedAdminSession(testDb.db, {
      label: "generic-owner",
      grants: [],
    });
    const elsewhere = await seedAdminSession(testDb.db, {
      label: "generic-elsewhere",
      membership: false,
    });

    const unknownEmail = await answer(workspaceOwner.token, teamId, {
      email: "nobody.at.all@qcms.invalid",
    });
    const unknownId = await answer(workspaceOwner.token, teamId, { userId: "au_never_existed" });
    const existingOther = await answer(workspaceOwner.token, teamId, {
      userId: elsewhere.userId,
    });

    expect(unknownEmail.status).toBe(404);
    expect(JSON.parse(unknownEmail.text)).toMatchObject({
      error: { code: "ACCOUNT_NOT_ADDABLE" },
    });
    expect(unknownId).toEqual(unknownEmail);
    expect(existingOther).toEqual(unknownEmail);
    expect(unknownEmail.text).not.toContain("nobody.at.all");
    expect(existingOther.text).not.toContain(elsewhere.userId);

    const claimUnknownEmail = await answer(ownerToken, teamId, {
      email: "nobody.at.all@qcms.invalid",
    });
    const claimUnknownId = await answer(ownerToken, teamId, { userId: "au_never_existed" });
    expect(claimUnknownEmail).toEqual(unknownEmail);
    expect(claimUnknownId).toEqual(unknownEmail);
    expect(
      (await listWorkspaceMembers(testDb.db, SEED_WORKSPACE_ID)).some(
        (member) => member.userId === elsewhere.userId,
      ),
    ).toBe(false);
  });

  it("still adds an existing account by its exact address", async () => {
    const teamId = await createGroup({
      name: "Exact viewers",
      roles: ["forms.viewer"],
      environments: [],
    });
    const workspaceOwner = await seedAdminSession(testDb.db, {
      label: "exact-owner",
      grants: [],
    });
    const newcomer = await seedAdminSession(testDb.db, {
      label: "exact-newcomer",
      membership: false,
    });
    const res = await answer(workspaceOwner.token, teamId, {
      email: `exact-newcomer.${newcomer.userId}@admin.test`,
    });
    expect(res.status, res.text).toBe(201);
  });
});

describe("writes on an archived workspace", () => {
  it("refuses a grant, a new group and a settings change, and allows a revoke", async () => {
    const created = await send("POST", "/workspaces", { name: "Ending", slug: "ending-grants" });
    const workspaceId = ((await created.json()) as { workspace: { workspaceId: string } }).workspace
      .workspaceId;
    const groupsPath = `/workspaces/${workspaceId}/access-groups`;
    const group = await send("POST", groupsPath, {
      name: "Viewers",
      roles: ["forms.viewer"],
      environments: [],
    });
    const teamId = ((await group.json()) as GroupBody).group.teamId;
    const spare = await send("POST", groupsPath, {
      name: "Spare editors",
      roles: ["forms.editor"],
      environments: [],
    });
    const spareId = ((await spare.json()) as GroupBody).group.teamId;
    const holder = await seedAdminSession(testDb.db, {
      label: "ending-holder",
      membership: false,
    });
    const granted = await send("POST", `${groupsPath}/${teamId}/holders`, {
      userId: holder.userId,
    });
    expect(granted.status, await granted.clone().text()).toBe(201);
    const latecomer = await seedAdminSession(testDb.db, {
      label: "ending-latecomer",
      membership: false,
    });

    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);

    const refusals = [
      await send("POST", `${groupsPath}/${spareId}/holders`, { userId: latecomer.userId }),
      await send("POST", groupsPath, {
        name: "Publishers",
        roles: ["forms.publisher"],
        environments: ["prod"],
      }),
      await send("PUT", `${groupsPath}/${teamId}`, {
        name: "Viewers",
        roles: ["forms.viewer"],
        environments: [],
      }),
      await send("PUT", `/workspaces/${workspaceId}/settings`, { requireSecondApprover: true }),
    ];
    for (const refused of refusals) {
      expect(refused.status).toBe(409);
      expect((await refused.json()) as ErrorBody).toMatchObject({
        error: { code: "WORKSPACE_ARCHIVED" },
      });
    }

    const revoked = await send("DELETE", `${groupsPath}/${teamId}/holders/${holder.userId}`);
    expect(revoked.status, await revoked.clone().text()).toBe(204);
    const removed = await send("DELETE", `${groupsPath}/${spareId}`);
    expect(removed.status, await removed.clone().text()).toBe(204);
  });
});

// Last in the file: it adds an environment to the live set, which every case above reads.
describe("an environment added after the groups were written (criterion 14)", () => {
  it("is covered by no group that names its own environments", async () => {
    const created = await send("POST", "/workspaces", { name: "Later", slug: "later-environment" });
    const workspaceId = ((await created.json()) as { workspace: { workspaceId: string } }).workspace
      .workspaceId;
    const groupsPath = `/workspaces/${workspaceId}/access-groups`;

    const responses = await send("POST", groupsPath, {
      name: "Readers",
      roles: ["responses.viewer"],
      environments: ["test", "prod", "dev"],
    });
    const responsesTeamId = ((await responses.json()) as GroupBody).group.teamId;
    const authors = await send("POST", groupsPath, {
      name: "Builders",
      roles: ["forms.editor"],
      environments: [],
    });
    const authorsTeamId = ((await authors.json()) as GroupBody).group.teamId;

    const holder = await seedAdminSession(testDb.db, {
      label: "later-holder",
      membership: false,
    });
    for (const teamId of [responsesTeamId, authorsTeamId]) {
      expect(
        (await send("POST", `${groupsPath}/${teamId}/holders`, { userId: holder.userId })).status,
      ).toBe(201);
    }

    await createEnvironment(testDb.db, { name: "sandbox" });

    const body = (await (await as(holder.token, "GET", "/me/access")).json()) as {
      workspaces: {
        workspaceId: string;
        grants: { name: string; environments: string[] }[];
      }[];
    };
    const workspace = body.workspaces.find((row) => row.workspaceId === workspaceId);
    const named = workspace?.grants.find((grant) => grant.name === "Readers");
    expect(named?.environments).toEqual(["test", "prod", "dev"]);

    // Edit forms ignores the set, so the group that names none does cover the newcomer.
    const everywhere = workspace?.grants.find((grant) => grant.name === "Builders");
    expect(everywhere?.environments).toEqual([]);

    const stored = await listAccessGroups(testDb.db, workspaceId);
    expect(stored.find((group) => group.name === "Readers")?.environments).not.toContain("sandbox");
  });
});

interface MyAccessBody {
  workspaces: {
    workspaceId: string;
    memberRole: string | null;
    grants: { name: string; roles: string[] }[];
  }[];
}

describe("a suspended membership grants nothing (sections 7 and 10)", () => {
  let holderToken: string;
  let holderId: string;
  let teamId: string;

  beforeAll(async () => {
    const holder = await seedAdminSession(testDb.db, {
      label: "suspendable",
      owner: false,
      grants: ["forms.editor"],
    });
    holderToken = holder.token;
    holderId = holder.userId;
    const groups = await listAccessGroups(testDb.db, SEED_WORKSPACE_ID);
    teamId = groups.find((group) => group.name === "Every environment: forms.editor")!.teamId;
  });

  it("holds the grant while the membership is live", async () => {
    const before = (await (await as(holderToken, "GET", "/me/access")).json()) as MyAccessBody;
    const workspace = before.workspaces.find((row) => row.workspaceId === SEED_WORKSPACE_ID);
    expect(workspace?.grants.flatMap((grant) => grant.roles)).toEqual(["forms.editor"]);
    expect((await as(holderToken, "GET", "/workspaces")).status).toBe(200);
  });

  it("holds nothing once the membership is suspended, with the member row untouched", async () => {
    await suspendSeededGrant(testDb.db, {
      teamId,
      userId: holderId,
      by: ownerId,
      at: new Date("2026-07-20T00:00:00.000Z"),
    });

    const after = (await (await as(holderToken, "GET", "/me/access")).json()) as MyAccessBody;
    const workspace = after.workspaces.find((row) => row.workspaceId === SEED_WORKSPACE_ID);
    expect(workspace?.grants).toEqual([]);
    expect(workspace?.memberRole).toBe("member");

    const refused = await as(holderToken, "GET", "/workspaces");
    expect(refused.status).toBe(403);
  });

  it("still lists the suspended holder to an administrator, so the state can be seen", async () => {
    const holders = await listAccessGroupHolders(testDb.db, teamId);
    expect(holders.map((row) => row.userId)).toContain(holderId);
  });
});

interface SiteAuditBody {
  rows: {
    id: string;
    actor: string;
    actorEmail: string | null;
    subject: string | null;
    workspaceId: string | null;
    kind: string;
    detail: string | null;
  }[];
  total: number;
}

describe("the site audit (criteria 111 and 113)", () => {
  beforeAll(async () => {
    const at = new Date("2026-07-20T00:00:00.000Z");
    await writeSiteAuditRow(testDb.db, {
      actor: ownerId,
      subject: secondOwnerId,
      kind: "administrator",
      detail: "act=promote",
      occurredAt: at,
    });
    await writeSiteAuditWithMirror(
      testDb.db,
      {
        actor: ownerId,
        subject: secondOwnerId,
        workspaceId: SEED_WORKSPACE_ID,
        kind: "account",
        detail: "act=reset scope=password",
        occurredAt: new Date(at.getTime() + 1_000),
      },
      [SEED_WORKSPACE_ID],
    );
  });

  it("serves the site audit to a Site administrator, newest first", async () => {
    const res = await send("GET", "/site-audit");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as SiteAuditBody;
    expect(body.rows[0]).toMatchObject({
      kind: "account",
      subject: secondOwnerId,
      workspaceId: SEED_WORKSPACE_ID,
      detail: "act=reset scope=password",
    });
    expect(body.rows[1]).toMatchObject({ kind: "administrator", workspaceId: null });
    expect(body.rows[0]?.actorEmail).not.toBeNull();
  });

  it("filters on the kind", async () => {
    const res = await send("GET", "/site-audit?kind=administrator");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SiteAuditBody;
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((row) => row.kind === "administrator")).toBe(true);
  });

  it("refuses a kind the log does not hold", async () => {
    expect((await send("GET", "/site-audit?kind=read")).status).toBe(400);
  });

  it("refuses a Workspace administrator and a caller with no grant at all", async () => {
    for (const token of [workspaceOwnerToken, editorToken, nobodyToken]) {
      const res = await as(token, "GET", "/site-audit");
      expect(res.status).toBe(403);
      expect((await res.json()) as ErrorBody).toMatchObject({ error: { code: "FORBIDDEN" } });
    }
  });

  it("mirrors a site act that affects a workspace into that workspace's audit", async () => {
    const res = await send("GET", `/workspaces/${SEED_WORKSPACE_ID}/audit?kind=account`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { kind: string; detail: string | null }[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.detail).toBe(`subject=${secondOwnerId} act=reset scope=password`);
  });
});

describe("the per-workspace membership lock and the last-administrator guard (089)", () => {
  it("leaves one administrator when two concurrent removals race (criterion 88)", async () => {
    const workspaceId = await createWorkspace("Race", "race-admins");
    const second = await appointAdministrator(workspaceId, "race2");

    // Raced ten times, not once: the first race in a process does not interleave, so a
    // single attempt passes with the lock taken out again.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      // Each removal takes the other's subject, so without the lock both would read two
      // administrators and the workspace would be left with none.
      const [first, other] = await Promise.all([
        send("PUT", `/workspaces/${workspaceId}/members/${second}`, { role: "member" }),
        send("PUT", `/workspaces/${workspaceId}/members/${ownerId}`, { role: "member" }),
      ]);

      const codes = [first.status, other.status].sort((a, b) => a - b);
      expect(codes, `attempt ${attempt}`).toEqual([200, 409]);
      const refused = first.status === 409 ? first : other;
      expect((await refused.json()) as ErrorBody).toMatchObject({
        error: { code: "LAST_ADMINISTRATOR" },
      });

      const members = await listWorkspaceMembers(testDb.db, workspaceId);
      const administrators = members.filter((member) => member.role === "forms.owner");
      expect(administrators, `attempt ${attempt}`).toHaveLength(1);

      const survivor = administrators[0]?.userId;
      await setMemberRole(
        testDb.db,
        workspaceId,
        survivor === ownerId ? second : ownerId,
        "forms.owner",
      );
    }
  });

  it("writes no `administrator` row for a write that leaves the flag where it was", async () => {
    const workspaceId = await createWorkspace("No move", "no-move-admins");
    const second = await appointAdministrator(workspaceId, "nomove");

    // Already an administrator, so appointing again appoints nobody.
    const before = (await administratorRows(workspaceId)).length;
    expect(
      (await send("PUT", `/workspaces/${workspaceId}/members/${second}`, { role: "forms.owner" }))
        .status,
    ).toBe(200);
    expect((await administratorRows(workspaceId)).length).toBe(before);

    // And a plain member stays one, so removing the flag removes nobody.
    const plain = await seedAdminSession(testDb.db, {
      label: "nomoveplain",
      membership: false,
    });
    await seedGrants(testDb.db, {
      userId: plain.userId,
      workspaceId,
      grants: [],
      owner: false,
    });
    expect(
      (await send("PUT", `/workspaces/${workspaceId}/members/${plain.userId}`, { role: "member" }))
        .status,
    ).toBe(200);
    expect((await administratorRows(workspaceId)).length).toBe(before);

    // The two directions that do move it still write their row.
    expect(
      (
        await send("PUT", `/workspaces/${workspaceId}/members/${plain.userId}`, {
          role: "forms.owner",
        })
      ).status,
    ).toBe(200);
    expect(
      (await send("PUT", `/workspaces/${workspaceId}/members/${plain.userId}`, { role: "member" }))
        .status,
    ).toBe(200);
    const details = (await administratorRows(workspaceId)).map((row) => row.detail);
    expect(details).toContain(`administrator=appointed subject=${plain.userId}`);
    expect(details).toContain(`administrator=removed subject=${plain.userId}`);
    expect(details).toHaveLength(before + 2);
  });

  it("does not count a disabled or an unclaimed administrator (criterion 87)", async () => {
    const workspaceId = await createWorkspace("Standing", "standing-admins");
    const disabled = await appointAdministrator(workspaceId, "standdis");
    await disableSeededAccount(testDb.db, disabled, deps.clock.now());
    const unclaimed = await seedAdminSession(testDb.db, {
      label: "standunc",
      claimed: false,
      membership: false,
    });
    await seedGrants(testDb.db, { userId: unclaimed.userId, workspaceId, grants: [] });
    await setMemberRole(testDb.db, workspaceId, unclaimed.userId, "forms.owner");

    // Three administrator rows, one of them active and claimed, so the guard still bites.
    const refused = await send("PUT", `/workspaces/${workspaceId}/members/${ownerId}`, {
      role: "member",
    });
    expect(refused.status).toBe(409);
    expect((await refused.json()) as ErrorBody).toMatchObject({
      error: { code: "LAST_ADMINISTRATOR" },
    });

    // Neither of the two satisfies the guard, so neither is held by it either.
    for (const subject of [disabled, unclaimed.userId]) {
      const res = await send("PUT", `/workspaces/${workspaceId}/members/${subject}`, {
        role: "member",
      });
      expect(res.status, await res.clone().text()).toBe(200);
    }
  });

  it("refuses a Site administrator removing the last administrator, by either route", async () => {
    const workspaceId = await createWorkspace("Site refused", "site-refused");
    const only = await appointAdministrator(workspaceId, "onlyadmin");
    expect(
      (await send("PUT", `/workspaces/${workspaceId}/members/${ownerId}`, { role: "member" }))
        .status,
    ).toBe(200);

    // `ownerToken` is a Site administrator and not an administrator of this workspace now.
    const demoted = await send("PUT", `/workspaces/${workspaceId}/members/${only}`, {
      role: "member",
    });
    expect(demoted.status).toBe(409);
    const removed = await send("DELETE", `/workspaces/${workspaceId}/members/${only}`);
    expect(removed.status).toBe(409);
    expect((await removed.json()) as ErrorBody).toMatchObject({
      error: { code: "LAST_ADMINISTRATOR" },
    });
  });
});

describe("taking somebody out of a workspace (089)", () => {
  it("removes every group hold and the member row, one revoke row each", async () => {
    const workspaceId = await createWorkspace("Exit", "exit-workspace");
    const subject = await seedAdminSession(testDb.db, {
      label: "exit",
      membership: false,
    });
    const group = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "Exit viewers",
      roles: ["forms.viewer"],
      environments: [],
    });
    const teamId = ((await group.json()) as GroupBody).group.teamId;
    expect(
      (
        await send("POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
          userId: subject.userId,
        })
      ).status,
    ).toBe(201);

    const res = await send("DELETE", `/workspaces/${workspaceId}/members/${subject.userId}`);
    expect(res.status, await res.clone().text()).toBe(204);

    expect(
      (await listWorkspaceMembers(testDb.db, workspaceId)).some(
        (member) => member.userId === subject.userId,
      ),
    ).toBe(false);
    expect(
      (await listAccessGroupHolders(testDb.db, teamId)).some(
        (holder) => holder.userId === subject.userId,
      ),
    ).toBe(false);

    const details = (await auditRowsOfKind(workspaceId, "revoke")).map((row) => row.detail);
    expect(details).toContain(`member=removed subject=${subject.userId}`);
    expect(
      details.some(
        (detail) =>
          detail?.includes(`subject=${subject.userId}`) === true &&
          detail.includes("group=Exit viewers"),
      ),
    ).toBe(true);
  });

  it("writes the administrator row when the person held the flag", async () => {
    const workspaceId = await createWorkspace("Exit admin", "exit-admin");
    const second = await appointAdministrator(workspaceId, "exitadmin");
    expect((await send("DELETE", `/workspaces/${workspaceId}/members/${second}`)).status).toBe(204);
    expect((await administratorRows(workspaceId)).map((row) => row.detail)).toContain(
      `administrator=removed subject=${second}`,
    );
  });

  it("answers 404 for an account with nothing in this workspace", async () => {
    const workspaceId = await createWorkspace("Exit none", "exit-none");
    const stranger = await seedAdminSession(testDb.db, {
      label: "exitnone",
      membership: false,
    });
    const res = await send("DELETE", `/workspaces/${workspaceId}/members/${stranger.userId}`);
    expect(res.status).toBe(404);
    expect((await res.json()) as ErrorBody).toMatchObject({ error: { code: "NOT_A_MEMBER" } });
  });
});

describe("a group stays inside its workspace (criteria 23 and 25)", () => {
  it("refuses a group id from another workspace in every act that names one", async () => {
    const other = await createWorkspace("Elsewhere", "elsewhere-groups");
    const group = await send("POST", `/workspaces/${other}/access-groups`, {
      name: "Elsewhere viewers",
      roles: ["forms.viewer"],
      environments: [],
    });
    const foreign = ((await group.json()) as GroupBody).group.teamId;

    const grant = await send(
      "POST",
      `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${foreign}/holders`,
      { userId: editorId },
    );
    expect(grant.status).toBe(404);
    expect((await grant.json()) as ErrorBody).toMatchObject({
      error: { code: "ACCESS_GROUP_NOT_FOUND" },
    });

    for (const [method, path] of [
      ["PUT", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${foreign}`],
      ["DELETE", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${foreign}`],
      ["DELETE", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${foreign}/holders/${editorId}`],
    ] as const) {
      const res = await send(
        method,
        path,
        method === "PUT"
          ? { name: "Renamed elsewhere", roles: ["forms.viewer"], environments: [] }
          : undefined,
      );
      expect(res.status, `${method} ${path}`).toBe(404);
    }

    // The group itself is untouched, and so is its workspace.
    expect((await listAccessGroups(testDb.db, other)).map((row) => row.name)).toContain(
      "Elsewhere viewers",
    );
  });

  it("refuses a Workspace administrator of one workspace every act on another", async () => {
    const theirs = await createWorkspace("Theirs", "theirs-workspace");
    const administrator = await seedAdminSession(testDb.db, {
      label: "theirsadmin",
      membership: false,
    });
    await seedGrants(testDb.db, { userId: administrator.userId, workspaceId: theirs, grants: [] });
    await setMemberRole(testDb.db, theirs, administrator.userId, "forms.owner");
    const crossed = await createGroup({
      name: "Crossed",
      roles: ["forms.viewer"],
      environments: [],
    });

    // Every act the seeded workspace has, read and write, the member row's own two
    // included: the refusal is the workspace, not the shape of the request.
    for (const [method, path, body] of [
      ["GET", `/workspaces/${SEED_WORKSPACE_ID}/members`, undefined],
      ["GET", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, undefined],
      ["GET", `/workspaces/${SEED_WORKSPACE_ID}/audit`, undefined],
      [
        "POST",
        `/workspaces/${SEED_WORKSPACE_ID}/access-groups`,
        { name: "Crossing", roles: ["forms.viewer"], environments: [] },
      ],
      [
        "PUT",
        `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${crossed}`,
        { name: "Crossed over", roles: ["forms.editor"], environments: [] },
      ],
      ["DELETE", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${crossed}`, undefined],
      [
        "POST",
        `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${crossed}/holders`,
        { userId: editorId },
      ],
      [
        "DELETE",
        `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${crossed}/holders/${editorId}`,
        undefined,
      ],
      ["PUT", `/workspaces/${SEED_WORKSPACE_ID}/members/${editorId}`, { role: "forms.owner" }],
      ["DELETE", `/workspaces/${SEED_WORKSPACE_ID}/members/${editorId}`, undefined],
      ["PUT", `/workspaces/${SEED_WORKSPACE_ID}/settings`, { requireSecondApprover: true }],
    ] as const) {
      const res = await as(administrator.token, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
    }

    // Nothing the refusals named moved.
    expect((await listAccessGroups(testDb.db, SEED_WORKSPACE_ID)).map((row) => row.name)).toContain(
      "Crossed",
    );
  });
});

describe("a revoke takes effect on the next request (criterion 89)", () => {
  it("adds and drops the workspace from the caller's own list with no restart between", async () => {
    const elsewhere = await createWorkspace("No cache", "no-cache-revoke");
    const subject = await seedAdminSession(testDb.db, {
      label: "nocache",
      owner: false,
      grants: ["forms.viewer"],
    });
    const group = await send("POST", `/workspaces/${elsewhere}/access-groups`, {
      name: "Readers",
      roles: ["forms.viewer"],
      environments: [],
    });
    const teamId = ((await group.json()) as GroupBody).group.teamId;

    const held = async (): Promise<readonly string[]> => {
      const res = await as(subject.token, "GET", "/workspaces");
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { workspaces: { workspaceId: string }[] }).workspaces.map(
        (workspace) => workspace.workspaceId,
      );
    };

    expect(await held()).not.toContain(elsewhere);
    expect(
      (
        await send("POST", `/workspaces/${elsewhere}/access-groups/${teamId}/holders`, {
          userId: subject.userId,
        })
      ).status,
    ).toBe(201);
    expect(await held()).toContain(elsewhere);

    expect(
      (
        await send(
          "DELETE",
          `/workspaces/${elsewhere}/access-groups/${teamId}/holders/${subject.userId}`,
        )
      ).status,
    ).toBe(204);
    expect(await held()).not.toContain(elsewhere);
  });
});

describe("every group act writes one `group` row (section 11)", () => {
  it("records a create, a rename, a change of roles and environments, and a delete", async () => {
    const workspaceId = await createWorkspace("Group audit", "group-audit");
    const created = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "Readers",
      roles: ["forms.viewer"],
      environments: [],
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const teamId = ((await created.json()) as GroupBody).group.teamId;

    expect(
      (
        await send("PUT", `/workspaces/${workspaceId}/access-groups/${teamId}`, {
          name: "Response readers",
          roles: ["responses.viewer"],
          environments: ["prod"],
        })
      ).status,
    ).toBe(200);
    expect(
      (await send("DELETE", `/workspaces/${workspaceId}/access-groups/${teamId}`)).status,
    ).toBe(204);

    const details = (await auditRowsOfKind(workspaceId, "group")).map((row) => row.detail);
    // One row each, counted: the four starter groups this workspace was created with
    // write none, and a re-scope writes one row for the group, not one per holder.
    expect(details.filter((detail) => detail?.startsWith("group=created") === true)).toEqual([
      "group=created name=Readers roles=forms.viewer environments=",
    ]);
    const changed = details.filter((detail) => detail?.startsWith("group=changed") === true);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("name=Response readers");
    expect(changed[0]).toContain("roles=responses.viewer");
    expect(changed[0]).toContain("environments=prod");
    expect(changed[0]).toContain("previousName=Readers");
    expect(changed[0]).toContain("previousRoles=forms.viewer");
    expect(details.filter((detail) => detail?.startsWith("group=deleted") === true)).toHaveLength(
      1,
    );
    expect(details).toHaveLength(3);
  });
});
