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
  setRequireSecondApprover,
  writeAgentActionRow,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";

import { createApp, type SliceRegistrar } from "../../app.js";
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

  const owner = await seedAdminSession(testDb.db, { label: "owner" });
  ownerToken = owner.token;
  ownerId = owner.userId;

  const second = await seedAdminSession(testDb.db, { label: "second", grants: [] });
  secondOwnerToken = second.token;
  secondOwnerId = second.userId;

  // No installation claim: the claim administers memberships across every workspace, so
  // leaving it on would make this account's refusals about the claim and not its grants.
  const editor = await seedAdminSession(testDb.db, {
    label: "editor",
    owner: false,
    claim: false,
    grants: ["forms.editor"],
  });
  editorToken = editor.token;
  editorId = editor.userId;

  const nobody = await seedAdminSession(testDb.db, {
    label: "nobody",
    owner: false,
    claim: false,
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
        claim: false,
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
    const group = body.groups.find((g) => g["name"] === "Response viewers");
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
      .where(eq(authTeam.name, "Response viewers"));
    expect(stored[0]?.name).toBe("Response viewers");
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
      claim: false,
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

    await testDb.db
      .update(authTeam)
      .set({ roles: ["forms.superuser"] })
      .where(eq(authTeam.id, teamId));

    const after = (await (await as(subject.token, "GET", "/me/access")).json()) as {
      capabilities: Record<string, boolean>;
      workspaces: { grants: { roles: string[] }[] }[];
    };
    expect(after.workspaces[0]?.grants.flatMap((grant) => grant.roles)).toEqual([
      "forms.superuser",
    ]);
    expect(Object.values(after.capabilities).every((held) => held === false)).toBe(true);

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

  it("audits the member row's role in both directions", async () => {
    const before = await auditCounts();
    expect(
      (
        await send("PUT", `/workspaces/${SEED_WORKSPACE_ID}/members/${editorId}`, {
          role: "forms.owner",
        })
      ).status,
    ).toBe(200);
    expect((await auditCounts()).grant ?? 0).toBe((before.grant ?? 0) + 1);
    expect(
      (
        await send("PUT", `/workspaces/${SEED_WORKSPACE_ID}/members/${editorId}`, {
          role: "member",
        })
      ).status,
    ).toBe(200);
    expect((await auditCounts()).revoke ?? 0).toBe((before.revoke ?? 0) + 1);
  });

  it("refuses to demote a workspace's last owner", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Last", slug: "last-owner" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    const res = await send("PUT", `/workspaces/${workspaceId}/members/${ownerId}`, {
      role: "member",
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as ErrorBody).toMatchObject({ error: { code: "LAST_OWNER" } });
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
      claim: false,
      grants: [],
    });
    const elsewhere = await seedAdminSession(testDb.db, {
      label: "generic-elsewhere",
      claim: false,
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
      claim: false,
      grants: [],
    });
    const newcomer = await seedAdminSession(testDb.db, {
      label: "exact-newcomer",
      claim: false,
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
      claim: false,
      membership: false,
    });
    const granted = await send("POST", `${groupsPath}/${teamId}/holders`, {
      userId: holder.userId,
    });
    expect(granted.status, await granted.clone().text()).toBe(201);
    const latecomer = await seedAdminSession(testDb.db, {
      label: "ending-latecomer",
      claim: false,
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
      claim: false,
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
