import { authSession, authUser, clearMustChangePassword } from "@roonga/qcms-db";
import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadAdminAuthConfig } from "../../config.js";
import { validEnv } from "../../test-support.js";
import { createInitialAdmin } from "./bootstrap.js";
import { createAdminAuth, type AdminAuth } from "./instance.js";

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

async function storedFlag(): Promise<boolean | undefined> {
  const [row] = await testDb.db
    .select({ flag: authUser.mustChangePassword })
    .from(authUser)
    .where(eq(authUser.email, EMAIL));
  return row?.flag;
}

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

// Needed rather than picking a row by user id, because this file leaves several sessions
// standing. better-auth signs the cookie as `<token>.<signature>`.
function sessionTokenOf(cookie: string): string {
  const match = /qcms_admin\.session_token=([^;]+)/.exec(cookie);
  if (match?.[1] === undefined) throw new Error("no session cookie in the sign-in response");
  const [token] = decodeURIComponent(match[1]).split(".");
  if (token === undefined || token === "") throw new Error("empty session token");
  return token;
}

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
    // `bootstrap.ts` assigns nothing here: better-auth applies the `defaultValue`
    // declared in `user.additionalFields`.
    const created = await createInitialAdmin(auth, testDb.db, {
      email: EMAIL,
      password: BOOTSTRAP_PASSWORD,
      name: "Provisional Admin",
    });
    expect(created.ok).toBe(true);
    expect(await storedFlag()).toBe(true);
  });

  it("returns the flag on the session user, which is where the gate reads it", async () => {
    const body = await sessionBody(await signIn(BOOTSTRAP_PASSWORD));
    expect(body.user?.mustChangePassword).toBe(true);
  });

  it("refuses a request body that tries to set it, because `input: false`", async () => {
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
    // value, so the account is still created.
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
    const after = await testDb.db.select({ id: authSession.id }).from(authSession);
    expect(after.length).toBeLessThan(before.length);

    await signIn(BOOTSTRAP_PASSWORD);
    expect(await storedFlag()).toBe(true);
  });

  it("is NOT cleared by a session refresh", async () => {
    const cookie = await signIn(BOOTSTRAP_PASSWORD);
    const token = sessionTokenOf(cookie);

    // better-auth refreshes only when the remaining life is inside `updateAge`, so
    // bringing `expiresAt` in provokes one without waiting.
    await testDb.db
      .update(authSession)
      .set({ expiresAt: new Date(Date.now() + 30_000) })
      .where(eq(authSession.token, token));

    const body = await sessionBody(cookie);
    const [refreshed] = await testDb.db
      .select({ expiresAt: authSession.expiresAt })
      .from(authSession)
      .where(eq(authSession.token, token));
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
    // Read with nothing awaited in between: the `account.update.after` hook must run
    // inside the call, or the admin's next request is still gated.
    expect(await storedFlag()).toBe(false);

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
    expect(after?.email).toBe(before.email);
    expect(after?.role).toBe(before.role);
    expect(after?.twoFactorEnabled).toBe(before.twoFactorEnabled);
    expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });
});

/**
 * Without `transaction: true`, `runWithTransaction` drains the queued hook even where the
 * work could not roll back, clearing the flag for a change that did not happen:
 * `@better-auth/core/dist/context/transaction.mjs:106` <!-- expect: if (adapter.options?.adapterConfig.transaction === false) -->
 */
describe("a failed /change-password leaves nothing behind (Code Owner, 2026-10-22)", () => {
  const ATOMIC_EMAIL = "atomic.admin@example.test";
  const FIRST_PASSWORD = `atomic-first-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
  const SECOND_PASSWORD = `atomic-second-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

  // A second account, so these cases do not depend on which password the shared one is on.
  beforeAll(async () => {
    const created = await auth.api.signUpEmail({
      body: { email: ATOMIC_EMAIL, password: FIRST_PASSWORD, name: "Atomic Admin" },
      asResponse: true,
    });
    expect(created.status).toBe(200);
  });

  async function atomicUserId(): Promise<string> {
    const [row] = await testDb.db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, ATOMIC_EMAIL));
    if (row === undefined) throw new Error("the atomicity fixture account is missing");
    return row.id;
  }

  // The dedicated client rather than the pool, so the read sees committed rows only.
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

  // A trigger's `RAISE` reaches the caller as a thrown `pg` error rather than a non-2xx
  // body, `asResponse` or not, so the outcome is read off which way the call left.
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
    // A second session, because `revokeOtherSessions` deletes every session but the caller's.
    await signInAtomic(FIRST_PASSWORD);
    const before = await committedState();
    expect(before.sessions).toBeGreaterThanOrEqual(2);

    const undo = await refuse("account", "update");
    const outcome = await attemptChange(cookie);
    await undo();
    expect(outcome).toBe("threw");

    const after = await committedState();
    expect(after.sessions).toBe(before.sessions);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.flag).toBe(true);
    await signInAtomic(FIRST_PASSWORD);
  });

  it("keeps the old password and the provisional flag when the replacement session fails", async () => {
    const cookie = await signInAtomic(FIRST_PASSWORD);
    const before = await committedState();
    expect(before.flag).toBe(true);
    expect(before.sessions).toBeGreaterThanOrEqual(1);

    // The `session` insert is the wrap's last step: the revocation and the credential
    // write have already been issued inside it.
    const undo = await refuse("session", "insert");
    const outcome = await attemptChange(cookie);
    await undo();
    expect(outcome).toBe("threw");

    const after = await committedState();
    expect(after.flag).toBe(true);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.sessions).toBe(before.sessions);

    const body = await auth.api.getSession({
      headers: new Headers({ cookie: await signInAtomic(FIRST_PASSWORD) }),
      asResponse: true,
    });
    expect(body.status).toBe(200);
    expect(
      ((await body.json()) as { user?: { mustChangePassword?: unknown } }).user?.mustChangePassword,
    ).toBe(true);
  });

  it("commits all three rows together when nothing fails", async () => {
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
