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

/**
 * First-run bootstrap tests (task 031 exit criterion 3, "empty DB → create admin →
 * sign in"; relocated to the API by task 056 with the code they cover).
 *
 * Against a real migrated Postgres, because the whole feature is "what is in the
 * database": the zero-admins guard is a count query, the created account is a real
 * better-auth user with a real password hash, and "then sign in" is the only assertion
 * that proves the hash is one better-auth can verify. A mocked adapter would pass while
 * shipping an account nobody can use. Requires Docker.
 *
 * The instance is built here from {@link loadAdminAuthConfig} rather than from a
 * composed app, which is exactly what `create-admin.ts` does: the CLI's whole
 * configuration surface is the database URL and the admin-auth block, and this test
 * proves that slice is sufficient.
 */

/**
 * Generated per run, not written down: a literal here is a hard-coded credential the
 * lint gate flags, and the point of the fixture is only that it is long enough to be
 * accepted.
 */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "first.admin@example.test";

let testDb: TestDb;
let auth: AdminAuth;

beforeAll(async () => {
  // **No seeded workspace**, which this suite needs and the others do not: the harness
  // adopts an existing workspace rather than adding one beside it, and so does the
  // bootstrap, so a pre-seeded fixture row sends `seedFirstWorkspace` down its adopt
  // branch and the first administrator's grants are never seeded at all. The suite's own
  // title is "against an empty database"; this makes it one (PR #1061's review, S4).
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

    // Neither refusal created anything.
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
    // The SEC-3 role claim exists from creation, with no way for input to set it.
    expect(row?.role).toBe("admin");
    // 2FA is NOT enrolled by the CLI: enrollment needs an authenticator app, so it
    // happens on the operator's first sign-in and is enforced before any API call.
    expect(row?.twoFactorEnabled ?? false).toBe(false);

    // A command line has no browser, so the session signUpEmail issues is revoked.
    const sessions = await auth.api.listSessions({ headers: new Headers() }).catch(() => []);
    expect(Array.isArray(sessions) ? sessions.length : 0).toBe(0);

    // "then sign in": the only proof the stored hash is one better-auth verifies.
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
    // Not an upsert and not a second account: still exactly one.
    expect(await countAdminUsers(testDb.db)).toBe(1);
  });

  it("seeds exactly the authoring family, with no responses grant (task 069)", async () => {
    // The assertion `SEEDED_FIRST_ADMIN_ROLES`' own comment promised and the first version
    // of this suite did not have (PR #1061's review, S4). The seed is accepted as built
    // (Code Owner, 2026-10-18, PR #1061), and what makes it acceptable is the part this
    // asserts: the first account can author, publish and release, and it can read no
    // response data until somebody deliberately grants that (Q29).
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
    // Not a `responses.*` grant anywhere, which is the half a reader has to be able to see.
    expect(groups.filter((group) => group.role.startsWith("responses."))).toEqual([]);

    for (const group of groups) {
      // Scope `all` in both dimensions, so the first account is not quietly confined.
      expect(group.environments).toEqual(["all"]);
      expect(group.forms).toEqual(["all"]);
      // And the account actually holds each one: a group nobody is in grants nothing.
      const holders = await listAccessGroupHolders(testDb.db, group.teamId);
      expect(holders.map((holder) => holder.email)).toEqual([EMAIL]);
    }
  });

  it("audits each seeded grant as the created account, naming the command (Q56)", async () => {
    // Code Owner, 2026-10-18, PR #1061: Q56's "every grant write is a SEC-15 row" is meant
    // literally, so the seed writes one. Without these rows the first page of the audit
    // shows two grants nobody granted.
    const [workspace] = await listWorkspaces(testDb.db);
    const { rows } = await listAccessAudit(testDb.db, workspace?.id ?? "", { kind: "grant" });
    const [account] = await testDb.db.select().from(authUser);

    expect(rows).toHaveLength(SEEDED_FIRST_ADMIN_ROLES.length);
    for (const role of SEEDED_FIRST_ADMIN_ROLES) {
      const row = rows.find((candidate) => candidate.detail?.includes(`group=all.${role}`));
      expect(row, `no seeded grant row for all.${role}`).toBeDefined();
      // The created account is the actor: it is the account the grant is for and the only
      // identity the installation has. The detail is what says the command did it.
      expect(row?.actor).toBe(account?.id);
      expect(row?.detail).toContain(SEED_AUDIT_DETAIL_PREFIX);
      // Q61: a grant row's scope goes in the detail, and these two columns stay empty
      // because the act names neither an environment nor a form.
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
