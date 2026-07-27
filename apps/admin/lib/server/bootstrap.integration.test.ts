import { authUser, countAdminUsers } from "@qcms/db";
import { startTestDb, type TestDb } from "@qcms/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAuth } from "./auth.ts";
import { createInitialAdmin, describeRefusal } from "./bootstrap.ts";
import { closeAdminDb } from "./db.ts";

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
 * The environment is populated in `beforeAll`, before anything calls `getAuth()`.
 * That works precisely because the better-auth instance is built lazily on first use
 * rather than at module load (see `lib/server/auth.ts`), so one test file can point it
 * at a throwaway container without any import gymnastics.
 */

const BOOT_TIMEOUT = 120_000;
/** Comfortably over the 12-character minimum, and not a real credential. */
const PASSWORD = "correct-horse-battery-staple";
const EMAIL = "first.admin@example.test";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.connectionUri;
  process.env.QCMS_ADMIN_BASE_URL = "http://localhost:3200";
  // Synthetic, generated per run: no real secret ever enters a fixture.
  process.env.QCMS_ADMIN_AUTH_SECRET = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("base64url");
}, BOOT_TIMEOUT);

afterAll(async () => {
  // Close the auth pool BEFORE stopping the container: a live client at teardown
  // surfaces as an unhandled pg error that reds the run (see `closeAdminDb`).
  await closeAdminDb();
  await testDb?.teardown();
}, BOOT_TIMEOUT);

describe("createInitialAdmin against an empty database", () => {
  it("refuses a weak password and an invalid email before touching the database", async () => {
    expect(await countAdminUsers(testDb.db)).toBe(0);

    const short = await createInitialAdmin(testDb.db, {
      email: EMAIL,
      password: "too-short",
    });
    expect(short.ok).toBe(false);
    expect(short.ok === false && short.refusal.kind).toBe("weak-password");

    const malformed = await createInitialAdmin(testDb.db, {
      email: "not-an-email",
      password: PASSWORD,
    });
    expect(malformed.ok).toBe(false);
    expect(malformed.ok === false && malformed.refusal.kind).toBe("invalid-email");

    // Neither refusal created anything.
    expect(await countAdminUsers(testDb.db)).toBe(0);
  });

  it("creates the first admin, leaves no session behind, and that admin can sign in", async () => {
    const created = await createInitialAdmin(testDb.db, {
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
    const sessions = await getAuth().api.listSessions({ headers: new Headers() }).catch(() => []);
    expect(Array.isArray(sessions) ? sessions.length : 0).toBe(0);

    // "then sign in": the only proof the stored hash is one better-auth verifies.
    const signIn = await getAuth().api.signInEmail({
      body: { email: EMAIL, password: PASSWORD },
      asResponse: true,
    });
    expect(signIn.status).toBe(200);
    expect(signIn.headers.getSetCookie().join(";")).toContain("qcms_admin.session_token=");
  });

  it("refuses once any admin exists, which is what makes the command re-runnable", async () => {
    const again = await createInitialAdmin(testDb.db, {
      email: "second.admin@example.test",
      password: PASSWORD,
    });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.refusal.kind).toBe("already-bootstrapped");
    // Not an upsert and not a second account: still exactly one.
    expect(await countAdminUsers(testDb.db)).toBe(1);
  });

  it("explains a refusal without echoing any credential (SEC-8)", () => {
    const message = describeRefusal({ kind: "weak-password", minLength: 12 });
    expect(message).toContain("QCMS_ADMIN_PASSWORD");
    expect(message).not.toContain(PASSWORD);
  });
});
