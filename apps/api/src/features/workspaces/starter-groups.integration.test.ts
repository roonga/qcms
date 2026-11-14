import {
  authUser,
  createEnvironment,
  dropEnvironment,
  getWorkspaceBySlug,
  listAccessAudit,
  listAccessGroupHolders,
  listAccessGroups,
  listEnvironmentNames,
  resolveMembership,
} from "@roonga/qcms-db";
import type { AccessGroupRow } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../../test-support.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { decideInWorkspace } from "../membership/resolver.js";
import { registerWorkspaces } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;

let testDb: TestDb;
let app: ReturnType<typeof createApp>;
let internalToken: string;
let siteAdmin: { token: string; userId: string };

beforeAll(async () => {
  testDb = await startTestDb();
  const deps: Deps = makeDeps({ db: testDb.db, env: validEnv() });
  app = createApp(deps, ADMIN_ONLY, {
    groups: {
      admin: [
        registerAdminAuth,
        registerRequestEnvironment,
        registerGrantCheck,
        registerWorkspaces,
      ],
    },
  });
  internalToken = internalTokenFor(deps.config);
  siteAdmin = await seedAdminSession(testDb.db, { label: "site-admin", membership: false });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

interface ErrorBody {
  error: { code: string };
}

async function createWorkspace(token: string, body: Record<string, unknown>): Promise<Response> {
  return app.request("/admin/workspaces", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": internalToken,
      [ADMIN_SESSION_HEADER]: token,
    },
    body: JSON.stringify(body),
  });
}

async function created(slug: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await createWorkspace(siteAdmin.token, { name: slug, slug, ...extra });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { workspace: { workspaceId: string } }).workspace.workspaceId;
}

async function groupsByName(workspaceId: string): Promise<Record<string, AccessGroupRow>> {
  const groups = await listAccessGroups(testDb.db, workspaceId);
  return Object.fromEntries(groups.map((group) => [group.name, group]));
}

async function emailOf(userId: string): Promise<string> {
  const rows = await testDb.db.select({ id: authUser.id, email: authUser.email }).from(authUser);
  return rows.find((row) => row.id === userId)?.email ?? "";
}

const PROD_GROUPS = [
  ["Publishers", ["forms.publisher"]],
  ["Response viewers", ["responses.viewer"]],
  ["Response erasers", ["responses.eraser"]],
] as const;

// First: dropping `test` is refused once any group names it.
describe("starter-group environments follow the site (criteria 94 and 95)", () => {
  it("on a site whose only environment is prod, Authors carries Edit forms only, with no environment", async () => {
    expect(await dropEnvironment(testDb.db, "test")).toBeUndefined();
    expect(await listEnvironmentNames(testDb.db)).toEqual(["prod"]);

    const groups = await groupsByName(await created("prod-only"));
    expect(groups.Authors?.roles).toEqual(["forms.editor"]);
    expect(groups.Authors?.environments).toEqual([]);
    for (const [name, roles] of PROD_GROUPS) {
      expect(groups[name]?.roles).toEqual(roles);
      expect(groups[name]?.environments).toEqual(["prod"]);
    }
    for (const group of Object.values(groups)) {
      if (group.roles.some((role) => role !== "forms.editor" && role !== "forms.viewer")) {
        expect(group.environments.length, group.name).toBeGreaterThan(0);
      }
    }
  });

  it("with dev, test and prod, Authors covers dev and test and the other three cover prod", async () => {
    await createEnvironment(testDb.db, { name: "dev" });
    await createEnvironment(testDb.db, { name: "test" });

    const groups = await groupsByName(await created("three-envs"));
    expect(groups.Authors?.roles).toEqual(["forms.editor", "forms.publisher", "responses.viewer"]);
    expect([...(groups.Authors?.environments ?? [])].sort()).toEqual(["dev", "test"]);
    for (const [name, roles] of PROD_GROUPS) {
      expect(groups[name]?.roles).toEqual(roles);
      expect(groups[name]?.environments).toEqual(["prod"]);
    }
  });
});

describe("who creates a workspace (criterion 92)", () => {
  it("refuses an account that is not a Site administrator, even its Workspace administrators", async () => {
    const other = await seedAdminSession(testDb.db, {
      label: "not-site-admin",
      claim: false,
      owner: true,
    });
    const res = await createWorkspace(other.token, { name: "Refused", slug: "refused" });
    expect(res.status).toBe(403);
    expect(await getWorkspaceBySlug(testDb.db, "refused")).toBeUndefined();
  });

  it("makes the caller the first Workspace administrator by default, and audits it", async () => {
    const workspaceId = await created("by-default");
    const membership = await resolveMembership(testDb.db, siteAdmin.userId, workspaceId);
    expect(membership.memberRole).toBe("forms.owner");
    expect(membership.grants).toEqual([]);

    const { rows } = await listAccessAudit(testDb.db, workspaceId, { kind: "grant" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe(siteAdmin.userId);
    expect(rows[0]?.detail).toContain(`memberRole=forms.owner subject=${siteAdmin.userId}`);
  });

  it("makes the named account the first Workspace administrator, not the caller", async () => {
    const named = await seedAdminSession(testDb.db, {
      label: "named-first",
      claim: false,
      membership: false,
    });
    const workspaceId = await created("named", {
      firstAdministratorEmail: await emailOf(named.userId),
    });
    expect((await resolveMembership(testDb.db, named.userId, workspaceId)).memberRole).toBe(
      "forms.owner",
    );
    expect(
      (await resolveMembership(testDb.db, siteAdmin.userId, workspaceId)).memberRole,
    ).toBeUndefined();
  });

  it("refuses a first administrator who is not an existing account, and creates nothing", async () => {
    const res = await createWorkspace(siteAdmin.token, {
      name: "Nobody",
      slug: "nobody",
      firstAdministratorEmail: "nobody@example.test",
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe("FIRST_ADMINISTRATOR_NOT_FOUND");
    const again = await createWorkspace(siteAdmin.token, { name: "Nobody", slug: "nobody" });
    expect(again.status).toBe(201);
  });

  it("creates the four starter groups with nobody in them", async () => {
    const workspaceId = await created("four-groups");
    const groups = await listAccessGroups(testDb.db, workspaceId);
    expect(groups.map((group) => group.name).sort()).toEqual([
      "Authors",
      "Publishers",
      "Response erasers",
      "Response viewers",
    ]);
    for (const group of groups) {
      expect(await listAccessGroupHolders(testDb.db, group.teamId)).toEqual([]);
    }
  });
});

describe("a Site administrator with no group membership reads no response (criterion 20)", () => {
  it("is refused every response read, export and erasure in every workspace", async () => {
    const workspaces = [await created("no-read-a"), await created("no-read-b")];
    for (const workspaceId of workspaces) {
      for (const environment of await listEnvironmentNames(testDb.db)) {
        for (const action of ["read", "export", "erase", "dispose"]) {
          const decision = await decideInWorkspace(testDb.db, {
            userId: siteAdmin.userId,
            workspaceId,
            claim: true,
            request: { resource: "response", action, environment },
          });
          expect(decision.allowed, `${workspaceId} ${environment} ${action}`).toBe(false);
        }
      }
    }
  });
});

describe("workspace creation is one transaction", () => {
  async function counts(): Promise<Record<string, number>> {
    const totals: Record<string, number> = {};
    for (const table of ["organization", "member", "team", "access_audit"]) {
      const result = await testDb.db.execute(
        sql.raw(`select count(*)::int as total from control."${table}"`),
      );
      totals[table] = Number((result.rows[0] as { total: number }).total);
    }
    return totals;
  }

  it("leaves no workspace, member, group or audit row when its last step fails", async () => {
    // The audit row is the last write, so failing it proves every earlier one rolls back.
    await testDb.db.execute(
      sql.raw(`
        create function control.fail_atomic_audit() returns trigger language plpgsql as $$
        begin
          if exists (select 1 from control.organization where id = new.workspace_id and slug = 'atomic-fail') then
            raise exception 'forced failure inside the workspace-create transaction';
          end if;
          return new;
        end $$;
        create trigger fail_atomic_audit before insert on control.access_audit
          for each row execute function control.fail_atomic_audit();
      `),
    );
    try {
      const before = await counts();
      const res = await createWorkspace(siteAdmin.token, { name: "Atomic", slug: "atomic-fail" });
      expect(res.status).toBe(500);
      expect(await getWorkspaceBySlug(testDb.db, "atomic-fail")).toBeUndefined();
      expect(await counts()).toEqual(before);
    } finally {
      await testDb.db.execute(
        sql.raw(`
          drop trigger fail_atomic_audit on control.access_audit;
          drop function control.fail_atomic_audit();
        `),
      );
    }
  });
});
