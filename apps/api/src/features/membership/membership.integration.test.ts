import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SEED_WORKSPACE_ID,
  authTeam,
  countAccessAuditByKind,
  createEnvironment,
  listAccessGroups,
  listWorkspaceMembers,
  setRequireSecondApprover,
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
    fullName: string;
    directoryName: string;
    role: string;
    environments: string[];
    forms: string[];
    externalGroupId: string | null;
    holders: { userId: string; email: string }[];
  };
}

async function createGroup(body: {
  name: string;
  role: string;
  environments: string[];
  forms: string[];
  label?: string;
}): Promise<string> {
  const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, body);
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as GroupBody).group.teamId;
}

async function auditCounts(): Promise<Readonly<Record<string, number>>> {
  return countAccessAuditByKind(testDb.db, SEED_WORKSPACE_ID);
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
    expect(owner?.groups).toContain("all.responses.viewer");
    const editor = body.members.find((member) => member.userId === editorId);
    expect(editor?.role).toBe("member");
    expect(editor?.groups).toEqual(["all.forms.editor"]);
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
        grants: { name: string; role: string }[];
        environments: string[];
      }[];
    };
    expect(body.userId).toBe(editorId);
    const workspace = body.workspaces.find((w) => w.workspaceId === SEED_WORKSPACE_ID);
    expect(workspace?.grants.map((grant) => grant.role)).toEqual(["forms.editor"]);
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
      name: "prod.responses.eraser",
      role: "responses.eraser",
      environments: ["prod"],
      forms: ["all"],
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

describe("access-group names (criteria 12 and 13, Q37 and Q42)", () => {
  it("refuses a duplicate stored name in one workspace and accepts it in another", async () => {
    await createGroup({
      name: "test.responses.viewer",
      role: "responses.viewer",
      environments: ["test"],
      forms: ["all"],
    });
    const again = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "test.responses.viewer",
      role: "responses.viewer",
      environments: ["test"],
      forms: ["all"],
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
      name: "test.responses.viewer",
      role: "responses.viewer",
      environments: ["test"],
      forms: ["all"],
    });
    expect(accepted.status, await accepted.clone().text()).toBe(201);
  });

  it("refuses a combined set out of the environments table's order, naming the one spelling", async () => {
    // The live order is `test`, `prod`, `dev`, so `test-dev` is the one spelling.
    const refused = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "dev-test.responses.viewer",
      role: "responses.viewer",
      environments: ["dev", "test"],
      forms: ["all"],
    });
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as ErrorBody;
    expect(body.error.code).toBe("ACCESS_GROUP_SCOPE_INVALID");
    expect(body.error.message).toContain("test-dev");

    const accepted = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "test-dev.responses.viewer",
      role: "responses.viewer",
      environments: ["test", "dev"],
      forms: ["all"],
    });
    expect(accepted.status, await accepted.clone().text()).toBe(201);
    expect(((await accepted.json()) as GroupBody).group.environments).toEqual(["test", "dev"]);
  });

  it("refuses an environment the live set does not hold", async () => {
    const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "staging.responses.viewer",
      role: "responses.viewer",
      environments: ["staging"],
      forms: ["all"],
    });
    expect(res.status).toBe(400);
    expect((await res.json()) as ErrorBody).toMatchObject({
      error: { code: "ACCESS_GROUP_SCOPE_INVALID" },
    });
  });

  it("refuses a name out of step with the team's role or scope (criterion 13)", async () => {
    const res = await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`, {
      name: "prod.forms.editor",
      role: "responses.viewer",
      environments: ["prod"],
      forms: ["all"],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("ACCESS_GROUP_NAME_INVALID");
    expect(body.error.message).toContain("prod.responses.viewer");
  });

  it("derives the full name and the directory name and stores neither", async () => {
    const res = await send("GET", `/workspaces/${SEED_WORKSPACE_ID}/access-groups`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      groups: { name: string; fullName: string; directoryName: string }[];
      scopeNote: string;
    };
    const group = body.groups.find((g) => g.name === "test.responses.viewer");
    expect(group?.fullName).toBe("default.test.responses.viewer");
    expect(group?.directoryName).toBe("qcms.default.test.responses.viewer");
    const stored = await testDb.db
      .select({ name: authTeam.name })
      .from(authTeam)
      .where(eq(authTeam.name, "test.responses.viewer"));
    expect(stored[0]?.name).toBe("test.responses.viewer");
    expect(body.scopeNote).toContain("dev and test in effect");
  });

  it("leaves the permission unchanged when a name is made wrong through the database (criterion 13)", async () => {
    const teamId = await createGroup({
      name: "prod.forms.approver",
      role: "forms.approver",
      environments: ["prod"],
      forms: ["all"],
    });
    const subject = await seedAdminSession(testDb.db, { label: "mislabelled", membership: false });
    expect(
      (
        await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${teamId}/holders`, {
          userId: subject.userId,
        })
      ).status,
    ).toBe(201);

    const before = await as(subject.token, "GET", "/me/access");
    const beforeBody = (await before.json()) as {
      workspaces: { grants: { role: string; environments: string[] }[] }[];
    };
    const held = beforeBody.workspaces[0]?.grants.find((g) => g.role === "forms.approver");
    expect(held?.environments).toEqual(["prod"]);

    await testDb.db
      .update(authTeam)
      .set({ name: "all.responses.eraser.wrong" })
      .where(eq(authTeam.id, teamId));

    const after = await as(subject.token, "GET", "/me/access");
    const afterBody = (await after.json()) as {
      workspaces: { grants: { name: string; role: string; environments: string[] }[] }[];
    };
    const stillHeld = afterBody.workspaces[0]?.grants.find((g) => g.role === "forms.approver");
    expect(stillHeld?.role).toBe("forms.approver");
    expect(stillHeld?.environments).toEqual(["prod"]);
    expect(stillHeld?.name).toBe("all.responses.eraser.wrong");

    // Put back, so the suite's other cases read a workspace whose names are in step.
    await testDb.db
      .update(authTeam)
      .set({ name: "prod.forms.approver" })
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

describe("the seed setting, its audit row and what it grants (criterion 22, Q57)", () => {
  it("defaults off, so onboarding an editor creates nothing beside the editor grant", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Seed off", slug: "seed-off" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    const settings = await send("GET", `/workspaces/${workspaceId}/access-groups`);
    expect(settings.status).toBe(200);

    const editorGroup = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "all.forms.editor",
      role: "forms.editor",
      environments: ["all"],
      forms: ["all"],
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
    expect(groups.map((group) => group.name)).toEqual(["all.forms.editor"]);
  });

  it("writes a `setting` row with the name and the new value, and no environment or form", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Seed on", slug: "seed-on" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;

    const turnedOn = await send("PUT", `/workspaces/${workspaceId}/settings`, {
      seedNewEditorsWithTestData: true,
    });
    expect(turnedOn.status, await turnedOn.clone().text()).toBe(200);
    expect((await turnedOn.json()) as { seedNewEditorsWithTestData: boolean }).toMatchObject({
      seedNewEditorsWithTestData: true,
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
    expect(row.detail).toContain("setting=seedNewEditorsWithTestData");
    expect(row.detail).toContain("value=true");
  });

  it("then grants a new editor a `responses.viewer` on the non-prod environments it has", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Seeded", slug: "seeded-grant" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    expect(
      (
        await send("PUT", `/workspaces/${workspaceId}/settings`, {
          seedNewEditorsWithTestData: true,
        })
      ).status,
    ).toBe(200);

    const editorGroup = await send("POST", `/workspaces/${workspaceId}/access-groups`, {
      name: "all.forms.editor",
      role: "forms.editor",
      environments: ["all"],
      forms: ["all"],
    });
    const teamId = ((await editorGroup.json()) as GroupBody).group.teamId;
    const subject = await seedAdminSession(testDb.db, { label: "seeded", membership: false });
    expect(
      (
        await send("POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
          userId: subject.userId,
        })
      ).status,
    ).toBe(201);

    const groups = await listAccessGroups(testDb.db, workspaceId);
    const seeded = groups.find((group) => group.role === "responses.viewer");
    expect(seeded?.name).toBe("test-dev.responses.viewer");
    expect([...(seeded?.environments ?? [])]).toEqual(["test", "dev"]);

    const audit = await send("GET", `/workspaces/${workspaceId}/audit?kind=grant`);
    const rows = ((await audit.json()) as { rows: { detail: string }[] }).rows;
    expect(rows.some((row) => row.detail.includes("seeded=seedNewEditorsWithTestData"))).toBe(true);
  });
});

describe("every grant and every revoke writes a SEC-15 row (criterion 19, Q56)", () => {
  it("counts one row per grant and one per revoke, and none without", async () => {
    const before = await auditCounts();
    const teamId = await createGroup({
      name: "prod.responses.viewer.claims",
      role: "responses.viewer",
      environments: ["prod"],
      forms: ["frm_claims"],
      label: "claims",
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

  it("names the environment on a grant scoped to one and leaves it empty on `all` (Q61)", async () => {
    const subject = await seedAdminSession(testDb.db, { label: "q61", membership: false });

    const scoped = await createGroup({
      name: "prod.responses.eraser.q61",
      role: "responses.eraser",
      environments: ["prod"],
      forms: ["all"],
      label: "q61",
    });
    await send("POST", `/workspaces/${SEED_WORKSPACE_ID}/access-groups/${scoped}/holders`, {
      userId: subject.userId,
    });

    const wide = await createGroup({
      name: "all.forms.viewer.q61",
      role: "forms.viewer",
      environments: ["all"],
      forms: ["all"],
      label: "q61",
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
    const narrow = rows.find((row) => row.detail.includes("prod.responses.eraser.q61"));
    expect(narrow?.environment).toBe("prod");
    expect(narrow?.detail).toContain("environments=prod");
    const all = rows.find((row) => row.detail.includes("all.forms.viewer.q61"));
    expect(all?.environment).toBeNull();
    expect(all?.detail).toContain("environments=all");
  });

  it("writes one revoke row per holder when a whole group is removed", async () => {
    const teamId = await createGroup({
      name: "test.forms.viewer.cascade",
      role: "forms.viewer",
      environments: ["test"],
      forms: ["all"],
      label: "cascade",
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
      name: "test.responses.viewer.self",
      role: "responses.viewer",
      environments: ["test"],
      forms: ["all"],
      label: "self",
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
      name: "prod.responses.viewer",
      role: "responses.viewer",
      environments: ["prod"],
      forms: ["all"],
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
      name: "all.forms.editor",
      role: "forms.editor",
      environments: ["all"],
      forms: ["all"],
    });
    const teamId = ((await group.json()) as GroupBody).group.teamId;
    const res = await send("POST", `/workspaces/${workspaceId}/access-groups/${teamId}/holders`, {
      userId: ownerId,
    });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("applies the same rule to the installation administrator", async () => {
    // The refusal above was this account's, and this is what says it holds the claim.
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

  it("refuses a name out of step with the fields", async () => {
    await expect(
      createTeamThroughPlugin({
        name: "prod.forms.editor",
        organizationId: SEED_WORKSPACE_ID,
        role: "responses.viewer",
        environments: ["prod"],
        forms: ["all"],
      }),
    ).rejects.toThrow(/out of step|GRANT_WRITE_REFUSED|name/i);
  });

  it("refuses an environment in the scope that does not exist", async () => {
    await expect(
      createTeamThroughPlugin({
        name: "staging.responses.viewer",
        organizationId: SEED_WORKSPACE_ID,
        role: "responses.viewer",
        environments: ["staging"],
        forms: ["all"],
      }),
    ).rejects.toThrow(/no such environment|GRANT_WRITE_REFUSED/i);
  });

  it("refuses a role outside the six", async () => {
    await expect(
      createTeamThroughPlugin({
        name: "prod.forms.superuser",
        organizationId: SEED_WORKSPACE_ID,
        role: "forms.superuser",
        environments: ["prod"],
        forms: ["all"],
      }),
    ).rejects.toThrow(/six roles|GRANT_WRITE_REFUSED/i);
  });

  it("refuses `forms.owner` written as a team, which is a non-team target", async () => {
    await expect(
      createTeamThroughPlugin({
        name: "all.forms.owner",
        organizationId: SEED_WORKSPACE_ID,
        role: "forms.owner",
        environments: ["all"],
        forms: ["all"],
      }),
    ).rejects.toThrow(/member row|GRANT_WRITE_REFUSED/i);
  });

  it("refuses an `externalGroupId` at the hook, for a value that reaches one (Q39)", async () => {
    // `input: false` drops the field before any hook sees it, so the backstop branch can
    // only be reached by calling the hook directly.
    const hooks = pluginWriteBackstop(testDb.db);
    await expect(
      hooks.beforeCreateTeam({
        team: {
          name: "test.forms.viewer.external",
          role: "forms.viewer",
          environments: ["test"],
          forms: ["all"],
          externalGroupId: "CN=qcms-home",
        },
        organization: { id: SEED_WORKSPACE_ID },
      }),
    ).rejects.toThrow(/externalGroupId|GRANT_WRITE_REFUSED/i);

    await expect(
      hooks.beforeUpdateTeam({
        team: {
          name: "test.forms.viewer",
          role: "forms.viewer",
          environments: ["test"],
          forms: ["all"],
        },
        updates: { externalGroupId: "CN=qcms-home" },
        organization: { id: SEED_WORKSPACE_ID },
      }),
    ).rejects.toThrow(/externalGroupId|GRANT_WRITE_REFUSED/i);
  });

  it("drops an `externalGroupId` sent to a plugin endpoint before any hook sees it (Q39)", async () => {
    await createTeamThroughPlugin({
      name: "test.forms.viewer.hooked",
      organizationId: SEED_WORKSPACE_ID,
      role: "forms.viewer",
      environments: ["test"],
      forms: ["all"],
      label: "hooked",
      externalGroupId: "CN=qcms-home",
    });
    const written = (await listAccessGroups(testDb.db, SEED_WORKSPACE_ID)).find(
      (group) => group.name === "test.forms.viewer.hooked",
    );
    expect(written).toBeDefined();
    expect(written?.externalGroupId).toBeNull();
  });

  it("refuses a scope that is missing altogether, which is a team that is not a grant", async () => {
    await expect(
      createTeamThroughPlugin({ name: "all.forms.viewer", organizationId: SEED_WORKSPACE_ID }),
    ).rejects.toThrow(/role|GRANT_WRITE_REFUSED/i);
  });

  it("refuses a write into an archived workspace", async () => {
    const workspace = await send("POST", "/workspaces", { name: "Shut", slug: "shut-hooks" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    expect((await send("POST", `/workspaces/${workspaceId}/archive`)).status).toBe(200);
    await expect(
      createTeamThroughPlugin({
        name: "prod.forms.viewer",
        organizationId: workspaceId,
        role: "forms.viewer",
        environments: ["prod"],
        forms: ["all"],
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

  it("creates no default team when a workspace is created", async () => {
    const workspace = await send("POST", "/workspaces", { name: "No team", slug: "no-default" });
    const workspaceId = ((await workspace.json()) as { workspace: { workspaceId: string } })
      .workspace.workspaceId;
    // A team is a grant, so a default team would be a grant nobody wrote.
    expect(await listAccessGroups(testDb.db, workspaceId)).toEqual([]);
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
