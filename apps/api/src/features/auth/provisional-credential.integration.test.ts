import { authSession, authUser, clearMustChangePassword } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadAdminAuthConfig } from "../../config.js";
import { validEnv } from "../../test-support.js";
import { createInitialAdmin } from "./bootstrap.js";
import { createAdminAuth, type AdminAuth } from "./instance.js";

/**
 * SEC-1's provisional bootstrap credential, against a real better-auth over a real
 * Postgres (task 061, exit criterion 2). Requires Docker.
 *
 * ## Why this is an integration test and not a unit test
 *
 * Every claim here is a claim about what the **library** does with a field we declared
 * to it, and there is nothing to unit-test on our side: the flag is set by
 * better-auth's own `defaultValue` handling inside `signUpEmail`, returned by its own
 * `parseUserOutput` from `get-session`, and cleared by a database hook better-auth
 * decides when to run. A stub would assert our understanding of 1.7.6 rather than
 * 1.7.6, which is exactly the failure mode the `account.update.after` seam is exposed
 * to - the hook fires on a write we do not make.
 *
 * ## Exit criterion 2, one case per line
 *
 * "Cleared by a successful change and not by anything else: not by a failed attempt,
 * not by signing out and in again, not by a session refresh. Each of those asserted
 * separately, because they fail separately." They are four separate `it`s below, and
 * the three negative ones each first establish that the thing they name actually
 * happened - a sign-out that revoked nothing, or a refresh that refreshed nothing,
 * would pass vacuously.
 */

/** Generated per run: a literal here is a hard-coded credential the lint gate flags. */
const BOOTSTRAP_PASSWORD = `bootstrap-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const CHOSEN_PASSWORD = `chosen-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "provisional.admin@example.test";

let testDb: TestDb;
let auth: AdminAuth;

beforeAll(async () => {
  testDb = await startTestDb();
  const config = loadAdminAuthConfig(
    validEnv({ DATABASE_URL: testDb.connectionUri, QCMS_ADMIN_BASE_URL: "http://localhost:7040" }),
  );
  auth = createAdminAuth({ db: testDb.db, adminAuth: config.adminAuth });
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/** The stored flag, read off the column rather than off any response body. */
async function storedFlag(): Promise<boolean | undefined> {
  const [row] = await testDb.db
    .select({ flag: authUser.mustChangePassword })
    .from(authUser)
    .where(eq(authUser.email, EMAIL));
  return row?.flag;
}

/** Sign in and return the cookie header a later call can present. */
async function signIn(password: string): Promise<string> {
  const response = await auth.api.signInEmail({
    body: { email: EMAIL, password },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * The unsigned session token inside a cookie header.
 *
 * Needed rather than "the newest session row for this user" because this file signs
 * in several times and leaves the earlier sessions standing: picking a row by user id
 * picks an arbitrary one, and the refresh assertion below would then measure a session
 * nobody touched. better-auth signs the cookie as `<token>.<signature>`, and a token
 * carries no dot of its own.
 */
function sessionTokenOf(cookie: string): string {
  const match = /qcms_admin\.session_token=([^;]+)/.exec(cookie);
  if (match?.[1] === undefined) throw new Error("no session cookie in the sign-in response");
  const [token] = decodeURIComponent(match[1]).split(".");
  if (token === undefined || token === "") throw new Error("empty session token");
  return token;
}

/** The session body better-auth hands back, narrowed to what the BFF gate reads. */
async function sessionBody(cookie: string): Promise<{
  user?: { mustChangePassword?: unknown };
  session?: { expiresAt?: string };
}> {
  const response = await auth.api.getSession({
    headers: new Headers({ cookie }),
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as never;
}

describe("qcms:create-admin leaves the account marked provisional", () => {
  it("sets the flag without bootstrap.ts naming it", async () => {
    // `bootstrap.ts` contains no assignment to this field. better-auth applies the
    // `defaultValue` we declared in `user.additionalFields`, which is the whole point
    // of declaring it there: a future account-creation path inherits the marking
    // rather than having to remember it.
    const created = await createInitialAdmin(auth, testDb.db, {
      email: EMAIL,
      password: BOOTSTRAP_PASSWORD,
      name: "Provisional Admin",
    });
    expect(created.ok).toBe(true);
    expect(await storedFlag()).toBe(true);
  });

  it("returns the flag on the session user, which is where the gate reads it", async () => {
    // The work order's first better-auth finding, checked rather than assumed: a
    // column added behind the library's back would be absent here, and the admin's
    // gate would silently never fire. `get-session` is the exact call the BFF makes.
    const body = await sessionBody(await signIn(BOOTSTRAP_PASSWORD));
    expect(body.user?.mustChangePassword).toBe(true);
  });

  it("refuses a request body that tries to set it, because `input: false`", async () => {
    // Nothing on the mount's allowlist takes a user field, so this is belt: what it
    // pins is that the field cannot be self-assigned if one ever did.
    const response = await auth.api.signUpEmail({
      body: {
        email: "self.assigned@example.test",
        password: CHOSEN_PASSWORD,
        name: "Self Assigned",
        mustChangePassword: false,
      } as never,
      asResponse: true,
    });
    // `parseInputData` writes the declared default on a create instead of the supplied
    // value, so the account is created and is provisional regardless of what was sent.
    expect(response.status).toBe(200);
    const [row] = await testDb.db
      .select({ flag: authUser.mustChangePassword })
      .from(authUser)
      .where(eq(authUser.email, "self.assigned@example.test"));
    expect(row?.flag).toBe(true);
  });
});

describe("what clears the flag, and what does not (exit criterion 2)", () => {
  it("is NOT cleared by a failed change attempt", async () => {
    const cookie = await signIn(BOOTSTRAP_PASSWORD);
    const refused = await auth.api.changePassword({
      body: {
        currentPassword: `${BOOTSTRAP_PASSWORD}-wrong`,
        newPassword: CHOSEN_PASSWORD,
        revokeOtherSessions: true,
      },
      headers: new Headers({ cookie }),
      asResponse: true,
    });
    // Establish that the attempt really was refused: a 200 here would make the
    // assertion below vacuous.
    expect(refused.ok).toBe(false);
    expect(await storedFlag()).toBe(true);
  });

  it("is NOT cleared by signing out and in again", async () => {
    const cookie = await signIn(BOOTSTRAP_PASSWORD);
    const before = await testDb.db.select({ id: authSession.id }).from(authSession);
    const signedOut = await auth.api.signOut({
      headers: new Headers({ cookie }),
      asResponse: true,
    });
    expect(signedOut.ok).toBe(true);
    // Establish that the sign-out really removed a session row (SEC-1 requires
    // server-side invalidation, not a cleared cookie), so "and in again" is a new one.
    const after = await testDb.db.select({ id: authSession.id }).from(authSession);
    expect(after.length).toBeLessThan(before.length);

    await signIn(BOOTSTRAP_PASSWORD);
    expect(await storedFlag()).toBe(true);
  });

  it("is NOT cleared by a session refresh", async () => {
    const cookie = await signIn(BOOTSTRAP_PASSWORD);
    const token = sessionTokenOf(cookie);

    // better-auth refreshes when the remaining life is inside `updateAge`, which this
    // instance sets to a quarter of the idle window. Bringing `expiresAt` in is how a
    // refresh is provoked without waiting a quarter of an hour for one.
    await testDb.db
      .update(authSession)
      .set({ expiresAt: new Date(Date.now() + 30_000) })
      .where(eq(authSession.token, token));

    const body = await sessionBody(cookie);
    const [refreshed] = await testDb.db
      .select({ expiresAt: authSession.expiresAt })
      .from(authSession)
      .where(eq(authSession.token, token));
    // Establish that a refresh actually happened: without this the case passes on any
    // read at all, including one that did nothing. `expiresAt` was 30s out a moment
    // ago and the refreshed window is the full idle lifetime.
    expect(refreshed?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(body.user?.mustChangePassword).toBe(true);
    expect(await storedFlag()).toBe(true);
  });

  it("IS cleared by a successful change, before the call returns", async () => {
    const cookie = await signIn(BOOTSTRAP_PASSWORD);
    const changed = await auth.api.changePassword({
      body: {
        currentPassword: BOOTSTRAP_PASSWORD,
        newPassword: CHOSEN_PASSWORD,
        revokeOtherSessions: true,
      },
      headers: new Headers({ cookie }),
      asResponse: true,
    });
    expect(changed.ok).toBe(true);
    // Read immediately, with nothing awaited in between. The `account.update.after`
    // hook is queued through `queueAfterTransactionHook`, which runs it inline when no
    // transaction is open and otherwise after the commit - either way inside the call.
    // If it were fire-and-forget, the admin's very next request would still be gated
    // and the redirect after the form POST would loop.
    expect(await storedFlag()).toBe(false);

    // And the credential really did move: the flag going away has to mean the password
    // changed, not merely that something was written.
    const reSignedIn = await signIn(CHOSEN_PASSWORD);
    expect((await sessionBody(reSignedIn)).user?.mustChangePassword).toBe(false);
  });

  it("stays clear across a later sign-out and sign-in (criterion 4)", async () => {
    const cookie = await signIn(CHOSEN_PASSWORD);
    await auth.api.signOut({ headers: new Headers({ cookie }), asResponse: true });
    const body = await sessionBody(await signIn(CHOSEN_PASSWORD));
    expect(body.user?.mustChangePassword).toBe(false);
    expect(await storedFlag()).toBe(false);
  });

  it("clears on a change made from Settings, not only from the forced screen", async () => {
    // The hook is on the password write, not on a screen, so an admin who reached
    // Settings with the flag somehow still set is fixed by the ordinary path too.
    // Restored directly here, which is the one place this test writes the flag on.
    const restored = `restored-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
    await testDb.db
      .update(authUser)
      .set({ mustChangePassword: true })
      .where(eq(authUser.email, EMAIL));
    expect(await storedFlag()).toBe(true);

    const cookie = await signIn(CHOSEN_PASSWORD);
    const changed = await auth.api.changePassword({
      body: { currentPassword: CHOSEN_PASSWORD, newPassword: restored, revokeOtherSessions: true },
      headers: new Headers({ cookie }),
      asResponse: true,
    });
    expect(changed.ok).toBe(true);
    expect(await storedFlag()).toBe(false);
  });
});

describe("clearMustChangePassword", () => {
  it("touches one row and leaves the rest of it alone", async () => {
    await testDb.db
      .update(authUser)
      .set({ mustChangePassword: true })
      .where(eq(authUser.email, EMAIL));
    const [before] = await testDb.db.select().from(authUser).where(eq(authUser.email, EMAIL));
    if (before === undefined) throw new Error("the bootstrap admin is missing");

    await clearMustChangePassword(testDb.db, before.id);

    const [after] = await testDb.db.select().from(authUser).where(eq(authUser.email, EMAIL));
    expect(after?.mustChangePassword).toBe(false);
    // Nothing else moves except `updatedAt`, which moves deliberately: a row this
    // package writes without touching it would report a modification time that
    // predates its own contents.
    expect(after?.email).toBe(before.email);
    expect(after?.role).toBe(before.role);
    expect(after?.twoFactorEnabled).toBe(before.twoFactorEnabled);
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });
});

/**
 * `/change-password` is atomic, because the drizzle adapter is opted into transactions
 * (Code Owner, 2026-10-22).
 *
 * ## What is being asserted, and why it needs a real database
 *
 * `instance.ts` passes `transaction: true` to `drizzleAdapter`, which turns better-auth's
 * `runWithTransaction` wrap around the session revocation, the credential write and the
 * replacement session into one `BEGIN`. The property that buys is a negative one - that a
 * failure part-way through leaves **nothing** behind - and a negative about rollback is
 * only observable against a database that can roll back. A stub adapter would assert that
 * a fake transaction was opened, which is the claim already in the type.
 *
 * ## How the failure is forced
 *
 * With a Postgres trigger that raises on the write under test, which is the only seam that
 * fails the statement better-auth is in the middle of without reaching into the library.
 * Each case installs its trigger after the fixture is set up and drops it before the state
 * is read back, so the reads are ordinary ones.
 *
 * Two cases, because the two failure positions lose different things:
 *
 * - **The credential write fails**, after the revocation. What must survive is the
 *   sessions. Untransacted, the `DELETE` has already committed and every other session is
 *   gone while the old password still works.
 * - **The replacement session fails**, after the credential write. What must survive is the
 *   old password **and** the provisional flag. Untransacted, the password has moved while
 *   the caller is told the change failed, and `runWithTransaction` drains the queued
 *   `account.update.after` hook anyway on the path where work could not roll back
 *   (`@better-auth/core/dist/context/transaction.mjs:106`)
 *   <!-- expect: if (adapter.options?.adapterConfig.transaction === false) --> - so the
 *   flag is cleared by a change that did not happen.
 *
 * Both cases are red with `transaction: false` and green with `transaction: true`, which is
 * what makes them a test of this configuration rather than of better-auth.
 */
describe("a failed /change-password leaves nothing behind (Code Owner, 2026-10-22)", () => {
  const ATOMIC_EMAIL = "atomic.admin@example.test";
  const FIRST_PASSWORD = `atomic-first-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
  const SECOND_PASSWORD = `atomic-second-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

  /**
   * A second account, so this block shares no state with the ones above.
   *
   * They walk one account through a bootstrap and several changes in file order, and a
   * case that has to know which password is current would be coupled to that order for no
   * reason. `signUpEmail` marks it provisional by the same `defaultValue` the bootstrap
   * relies on, which is the starting state these cases need anyway.
   */
  beforeAll(async () => {
    const created = await auth.api.signUpEmail({
      body: { email: ATOMIC_EMAIL, password: FIRST_PASSWORD, name: "Atomic Admin" },
      asResponse: true,
    });
    expect(created.status).toBe(200);
  });

  /** The user id, read off the column. */
  async function atomicUserId(): Promise<string> {
    const [row] = await testDb.db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, ATOMIC_EMAIL));
    if (row === undefined) throw new Error("the atomicity fixture account is missing");
    return row.id;
  }

  /**
   * The committed state of this account, through {@link TestDb.client}.
   *
   * The dedicated client rather than the pool, because what these cases are about is what
   * survived a rollback: a read has to see committed rows and nothing else.
   */
  async function committedState(): Promise<{
    sessions: number;
    flag: boolean | null;
    passwordHash: string | null;
  }> {
    const userId = await atomicUserId();
    const sessions = await testDb.client.query<{ total: string }>(
      'select count(*)::text as total from control."session" where "userId" = $1',
      [userId],
    );
    const user = await testDb.client.query<{ must_change_password: boolean | null }>(
      'select "mustChangePassword" as must_change_password from control."user" where id = $1',
      [userId],
    );
    const account = await testDb.client.query<{ password: string | null }>(
      'select password from control."account" where "userId" = $1 and "providerId" = $2',
      [userId, "credential"],
    );
    return {
      sessions: Number(sessions.rows[0]?.total ?? "0"),
      flag: user.rows[0]?.must_change_password ?? null,
      passwordHash: account.rows[0]?.password ?? null,
    };
  }

  /** Install a trigger that refuses one statement on one table, and hand back its undo. */
  async function refuse(
    table: "session" | "account",
    event: "insert" | "update",
  ): Promise<() => Promise<void>> {
    const name = `qcms_refuse_${table}_${event}`;
    await testDb.client.query(
      `create or replace function control.${name}() returns trigger as $$ ` +
        `begin raise exception 'refused by the atomicity test'; end; $$ language plpgsql`,
    );
    await testDb.client.query(
      `create trigger ${name} before ${event} on control."${table}" ` +
        `for each row execute function control.${name}()`,
    );
    return async () => {
      await testDb.client.query(`drop trigger if exists ${name} on control."${table}"`);
      await testDb.client.query(`drop function if exists control.${name}()`);
    };
  }

  /**
   * Attempt the change and say how it ended.
   *
   * A trigger's `RAISE` reaches this caller as a thrown `pg` error rather than as a non-2xx
   * body, `asResponse` or not: better-auth maps its own `APIError` to a response and lets
   * anything else out. So the outcome is read off which way the call left, and a refusal
   * these cases provoked deliberately is not re-thrown - what each one asserts is the state
   * afterwards.
   */
  async function attemptChange(cookie: string): Promise<"ok" | "threw"> {
    try {
      const response = await auth.api.changePassword({
        body: {
          currentPassword: FIRST_PASSWORD,
          newPassword: SECOND_PASSWORD,
          revokeOtherSessions: true,
        },
        headers: new Headers({ cookie }),
        asResponse: true,
      });
      return response.ok ? "ok" : "threw";
    } catch {
      return "threw";
    }
  }

  /** Sign this account in, returning the cookie header. */
  async function signInAtomic(password: string): Promise<string> {
    const response = await auth.api.signInEmail({
      body: { email: ATOMIC_EMAIL, password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }

  it("keeps the sessions when the credential write fails after the revocation", async () => {
    const cookie = await signInAtomic(FIRST_PASSWORD);
    // A second session, so "the revocation was rolled back" is a claim about more than the
    // caller's own row: `revokeOtherSessions` deletes every session this account holds.
    await signInAtomic(FIRST_PASSWORD);
    const before = await committedState();
    expect(before.sessions).toBeGreaterThanOrEqual(2);

    const undo = await refuse("account", "update");
    const outcome = await attemptChange(cookie);
    await undo();
    // Establish that the attempt really failed: a success here would make everything below
    // vacuous.
    expect(outcome).toBe("threw");

    const after = await committedState();
    // The rollback, stated as the three rows it covers.
    expect(after.sessions).toBe(before.sessions);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.flag).toBe(true);
    // And the credential really did not move, which the hash comparison implies and a
    // sign-in proves: the old password is still the password.
    await signInAtomic(FIRST_PASSWORD);
  });

  it("keeps the old password and the provisional flag when the replacement session fails", async () => {
    const cookie = await signInAtomic(FIRST_PASSWORD);
    const before = await committedState();
    expect(before.flag).toBe(true);
    expect(before.sessions).toBeGreaterThanOrEqual(1);

    // Refusing the `session` insert fails the wrap at its last step, with the revocation
    // and the credential write already issued inside it.
    const undo = await refuse("session", "insert");
    const outcome = await attemptChange(cookie);
    await undo();
    expect(outcome).toBe("threw");

    const after = await committedState();
    // Task 061's fail-closed half first, because it is the one this configuration changed:
    // the flag is cleared by a password change that commits and by nothing else.
    // Untransacted this reads `false`, cleared by the queued hook on a change the caller
    // was told had failed.
    expect(after.flag).toBe(true);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.sessions).toBe(before.sessions);

    // The account is still usable with the password it had, and still gated.
    const body = await auth.api.getSession({
      headers: new Headers({ cookie: await signInAtomic(FIRST_PASSWORD) }),
      asResponse: true,
    });
    expect(body.status).toBe(200);
    expect(((await body.json()) as { user?: { mustChangePassword?: unknown } }).user
      ?.mustChangePassword).toBe(true);
  });

  it("commits all three rows together when nothing fails", async () => {
    // The positive case, so the two negatives above cannot pass by the endpoint being
    // broken for every input: one session replaces the set, the credential moves, and the
    // flag clears, in one act.
    const cookie = await signInAtomic(FIRST_PASSWORD);
    await signInAtomic(FIRST_PASSWORD);
    const before = await committedState();

    const changed = await auth.api.changePassword({
      body: {
        currentPassword: FIRST_PASSWORD,
        newPassword: SECOND_PASSWORD,
        revokeOtherSessions: true,
      },
      headers: new Headers({ cookie }),
      asResponse: true,
    });
    expect(changed.ok).toBe(true);

    const after = await committedState();
    expect(after.sessions).toBe(1);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(after.flag).toBe(false);
  });
});
