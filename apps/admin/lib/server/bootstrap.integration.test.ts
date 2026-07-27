import { authUser, countAdminUsers } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * First-run bootstrap tests (task 031, exit criterion 3: "empty DB → create admin →
 * sign in").
 *
 * Against a real migrated Postgres, because the whole feature is "what is in the
 * database": the zero-admins guard is a count query, the created account is a real
 * better-auth user with a real password hash, and "then sign in" is the only assertion
 * that proves the hash is one better-auth can verify. A mocked adapter would pass while
 * shipping an account nobody can use. Requires Docker.
 *
 * The environment is set **before** importing the modules under test: `lib/server/auth.ts`
 * builds the better-auth instance (and its database pool) at module load, so a dynamic
 * import after `process.env` is populated is what lets one test file point it at a
 * throwaway container. That is also why the imports below are inside `beforeAll`.
 */

const BOOT_TIMEOUT = 120_000;
/** Comfortably over the 12-character minimum, and not a real credential. */
const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "first.admin@example.test";

let testDb: TestDb;
let bootstrap: typeof import("./bootstrap.ts");
let auth: typeof import("./auth.ts");

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.connectionUri;
  process.env.QCMS_ADMIN_BASE_URL = "http://localhost:3200";
  // Synthetic, generated per run: no real secret ever enters a fixture.
  process.env.QCMS_ADMIN_AUTH_SECRET = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
  bootstrap = await import("./bootstrap.ts");
  auth = await import("./auth.ts");
}, BOOT_TIMEOUT);

afterAll(async () => {
  await testDb?.teardown();
}, BOOT_TIMEOUT);

describe("createInitialAdmin against an empty database", () => {
  it("refuses a weak password and an invalid email before touching the database", async () => {
    expect(await countAdminUsers(testDb.db)).toBe(0);

    const short = await bootstrap.createInitialAdmin(testDb.db, {
      email: EMAIL,
      password: "too-short",
    });
    expect(short.ok).toBe(false);
    expect(short.ok === false && short.refusal.kind).toBe("weak-password");

    const malformed = await bootstrap.createInitialAdmin(testDb.db, {
      email: "not-an-email",
      password: PASSWORD,
    });
    expect(malformed.ok).toBe(false);
    expect(malformed.ok === false && malformed.refusal.kind).toBe("invalid-email");

    // Neither refusal created anything.
    expect(await countAdminUsers(testDb.db)).toBe(0);
  });

  it("creates the first admin, leaves no session behind, and that admin can sign in", async () => {
    const created = await bootstrap.createInitialAdmin(testDb.db, {
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
    const sessions = await auth.auth.api.listSessions({ headers: new Headers() }).catch(() => []);
    expect(Array.isArray(sessions) ? sessions.length : 0).toBe(0);

    // "then sign in": the only proof the stored hash is one better-auth verifies.
    const signIn = await auth.auth.api.signInEmail({
      body: { email: EMAIL, password: PASSWORD },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
    expect(signIn.headers.getSetCookie().join(";")).toContain("qcms_admin.session_token=");
  });

  it("refuses once any admin exists, which is what makes the command re-runnable", async () => {
    const again = await bootstrap.createInitialAdmin(testDb.db, {
      email: "second.admin@example.test",
      password: PASSWORD,
    });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.refusal.kind).toBe("already-bootstrapped");
    // Not an upsert and not a second account: still exactly one.
    expect(await countAdminUsers(testDb.db)).toBe(1);
  });

  it("explains a refusal without echoing any credential (SEC-8)", () => {
    const message = bootstrap.describeRefusal({ kind: "weak-password", minLength: 12 });
    expect(message).toContain("QCMS_ADMIN_PASSWORD");
    expect(message).not.toContain(PASSWORD);
  });
});
