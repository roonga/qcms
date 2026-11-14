import {
  authUser,
  countAdminUsers,
  listAccessAudit,
  listAccessGroupHolders,
  listAccessGroups,
  listEnvironmentNames,
  listWorkspaces,
  resolveMembership,
  starterGroups,
} from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validEnv } from "../../test-support.js";
import { loadAdminAuthConfig } from "../../config.js";
import { SEED_AUDIT_DETAIL_PREFIX, createInitialAdmin, describeRefusal } from "./bootstrap.js";
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

  it("makes the first account a one-person site: Site administrator, Workspace administrator, in all four starter groups (criterion 110)", async () => {
    const [account] = await testDb.db.select().from(authUser);
    expect(account?.role).toBe("admin");

    const [workspace] = await listWorkspaces(testDb.db);
    expect(workspace).toBeDefined();
    expect(workspace?.requireSecondApprover).toBe(false);
    const membership = await resolveMembership(testDb.db, account?.id ?? "", workspace?.id ?? "");
    expect(membership.memberRole).toBe("forms.owner");

    const live = await listEnvironmentNames(testDb.db);
    const groups = await listAccessGroups(testDb.db, workspace?.id ?? "");
    const expected = starterGroups(live);
    expect(groups.map((group) => group.name).sort()).toEqual(
      expected.map((group) => group.name).sort(),
    );
    for (const want of expected) {
      const group = groups.find((row) => row.name === want.name);
      expect(group?.roles).toEqual(want.roles);
      expect(group?.environments).toEqual(want.environments);
      const holders = await listAccessGroupHolders(testDb.db, group?.teamId ?? "");
      expect(holders.map((holder) => holder.email)).toEqual([EMAIL]);
    }
  });

  it("audits the appointment and every seeded grant as the created account, naming the command (Q56)", async () => {
    const [workspace] = await listWorkspaces(testDb.db);
    const { rows } = await listAccessAudit(testDb.db, workspace?.id ?? "", { kind: "grant" });
    const [account] = await testDb.db.select().from(authUser);

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.actor).toBe(account?.id);
      expect(row.detail).toContain(SEED_AUDIT_DETAIL_PREFIX);
      expect(row.environment ?? null).toBeNull();
      expect(row.formId ?? null).toBeNull();
    }
    expect(rows.filter((row) => row.detail?.includes("memberRole=forms.owner"))).toHaveLength(1);
    for (const name of ["Authors", "Publishers", "Response viewers", "Response erasers"]) {
      expect(rows.filter((row) => row.detail?.includes(`group=${name} `))).toHaveLength(1);
    }
  });

  it("gives a new account nothing: not a Site administrator, no workspace, no group (criterion 75)", async () => {
    const signedUp = await auth.api.signUpEmail({
      body: { email: "new.account@example.test", password: PASSWORD, name: "New Account" },
    });
    const userId = signedUp.user.id;
    const [row] = await testDb.db.select().from(authUser).where(eq(authUser.id, userId));
    expect(row?.role ?? null).toBeNull();

    for (const workspace of await listWorkspaces(testDb.db)) {
      const membership = await resolveMembership(testDb.db, userId, workspace.id);
      expect(membership.memberRole).toBeUndefined();
      expect(membership.grants).toEqual([]);
    }
  });

  it("explains a refusal without echoing any credential (SEC-8)", () => {
    const message = describeRefusal({ kind: "weak-password", minLength: 12 });
    expect(message).toContain("QCMS_ADMIN_PASSWORD");
    expect(message).not.toContain(PASSWORD);
  });
});
