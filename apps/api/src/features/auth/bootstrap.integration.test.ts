import {
  authUser,
  countAdminUsers,
  listAccessAudit,
  listAccessGroupHolders,
  listAccessGroups,
  listWorkspaces,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validEnv } from "../../test-support.js";
import { loadAdminAuthConfig } from "../../config.js";
import {
  SEEDED_FIRST_ADMIN_ROLES,
  SEED_AUDIT_DETAIL_PREFIX,
  createInitialAdmin,
  describeRefusal,
} from "./bootstrap.js";
import { createAdminAuth, type AdminAuth } from "./instance.js";

/** Generated rather than literal so no credential-shaped string is ever committed here. */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "first.admin@example.test";

let testDb: TestDb;
let auth: AdminAuth;

beforeAll(async () => {
  // A pre-seeded workspace row sends `seedFirstWorkspace` down its adopt branch, and the
  // first administrator's grants are then never seeded at all.
  testDb = await startTestDb({ seedWorkspace: false });
  const config = loadAdminAuthConfig(
    validEnv({ DATABASE_URL: testDb.connectionUri, QCMS_ADMIN_BASE_URL: "http://localhost:7040" }),
  );
  expect(config.databaseUrl).toBe(testDb.connectionUri);
  auth = createAdminAuth({ db: testDb.db, adminAuth: config.adminAuth });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("createInitialAdmin against an empty database", () => {
  it("refuses a weak password and an invalid email before touching the database", async () => {
    expect(await countAdminUsers(testDb.db)).toBe(0);

    const short = await createInitialAdmin(auth, testDb.db, { email: EMAIL, password: "short" });
    expect(short.ok).toBe(false);
    expect(short.ok === false && short.refusal.kind).toBe("weak-password");

    const malformed = await createInitialAdmin(auth, testDb.db, {
      email: "not-an-email",
      password: PASSWORD,
    });
    expect(malformed.ok).toBe(false);
    expect(malformed.ok === false && malformed.refusal.kind).toBe("invalid-email");

    expect(await countAdminUsers(testDb.db)).toBe(0);
  });

  it("creates the first admin, leaves no session behind, and that admin can sign in", async () => {
    const created = await createInitialAdmin(auth, testDb.db, {
      email: EMAIL,
      password: PASSWORD,
      name: "First Admin",
    });
    expect(created.ok).toBe(true);
    expect(created.ok === true && created.email).toBe(EMAIL);
    expect(await countAdminUsers(testDb.db)).toBe(1);

    const [row] = await testDb.db.select().from(authUser);
    expect(row?.email).toBe(EMAIL);
    expect(row?.role).toBe("admin");
    expect(row?.twoFactorEnabled ?? false).toBe(false);

    // `signUpEmail` issues a session, which the CLI revokes: a command line has no browser.
    const sessions = await auth.api.listSessions({ headers: new Headers() }).catch(() => []);
    expect(Array.isArray(sessions) ? sessions.length : 0).toBe(0);

    const signIn = await auth.api.signInEmail({
      body: { email: EMAIL, password: PASSWORD },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
    expect(signIn.headers.getSetCookie().join(";")).toContain("qcms_admin.session_token=");
  });

  it("refuses once any admin exists, which is what makes the command re-runnable", async () => {
    const again = await createInitialAdmin(auth, testDb.db, {
      email: "second.admin@example.test",
      password: PASSWORD,
    });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.refusal.kind).toBe("already-bootstrapped");
    expect(await countAdminUsers(testDb.db)).toBe(1);
  });

  it("seeds exactly the authoring family, with no responses grant (task 069)", async () => {
    const [workspace] = await listWorkspaces(testDb.db);
    expect(workspace).toBeDefined();
    const groups = await listAccessGroups(testDb.db, workspace?.id ?? "");

    expect([...groups.map((group) => group.name)].sort()).toEqual(
      [...SEEDED_FIRST_ADMIN_ROLES.map((role) => `all.${role}`)].sort(),
    );
    expect([...groups.map((group) => group.role)].sort()).toEqual([
      "forms.approver",
      "forms.editor",
    ]);
    expect(groups.filter((group) => group.role.startsWith("responses."))).toEqual([]);

    for (const group of groups) {
      expect(group.environments).toEqual(["all"]);
      expect(group.forms).toEqual(["all"]);
      const holders = await listAccessGroupHolders(testDb.db, group.teamId);
      expect(holders.map((holder) => holder.email)).toEqual([EMAIL]);
    }
  });

  it("audits each seeded grant as the created account, naming the command (Q56)", async () => {
    const [workspace] = await listWorkspaces(testDb.db);
    const { rows } = await listAccessAudit(testDb.db, workspace?.id ?? "", { kind: "grant" });
    const [account] = await testDb.db.select().from(authUser);

    expect(rows).toHaveLength(SEEDED_FIRST_ADMIN_ROLES.length);
    for (const role of SEEDED_FIRST_ADMIN_ROLES) {
      const row = rows.find((candidate) => candidate.detail?.includes(`group=all.${role}`));
      expect(row, `no seeded grant row for all.${role}`).toBeDefined();
      expect(row?.actor).toBe(account?.id);
      expect(row?.detail).toContain(SEED_AUDIT_DETAIL_PREFIX);
      expect(row?.environment ?? null).toBeNull();
      expect(row?.formId ?? null).toBeNull();
      expect(row?.detail).toContain("environments=all forms=all");
    }
  });

  it("explains a refusal without echoing any credential (SEC-8)", () => {
    const message = describeRefusal({ kind: "weak-password", minLength: 12 });
    expect(message).toContain("QCMS_ADMIN_PASSWORD");
    expect(message).not.toContain(PASSWORD);
  });
});
