import { authTwoFactor, authUser, schema, twoFactorResets } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import {
  applyMigrations,
  CONTAINER_BOOT_TIMEOUT_MS,
  startTestDb,
  type TestDb,
} from "@roonga/qcms-db/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { generate } from "otplib";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadAdminAuthConfig } from "../../config.js";
import { validEnv } from "../../test-support.js";
import { createInitialAdmin } from "./bootstrap.js";
import { createAdminAuth, type AdminAuth } from "./instance.js";
import {
  describeResetOutcome,
  describeResetRefusal,
  resetAdminTwoFactor,
} from "./reset-two-factor.js";

/**
 * The `qcms:reset-2fa` break-glass, against a real Postgres with the real role
 * split (issue #432).
 *
 * ## Why this suite builds two database roles rather than one
 *
 * The command's entire guard is which credential opened the connection, so a test
 * that runs everything as one superuser would assert the refusal against a role
 * that does not exist in any deployment and prove nothing about the one that does.
 * So the container is booted **unmigrated**, `qcms_migrate` and `qcms_app` are
 * created from the `docs/operations.md` recipe (the same recipe
 * `apps/api/e2e/security/03-db-least-privilege.e2e.ts` executes), the migrations
 * run as `qcms_migrate`, and from then on each half of the story uses the
 * credential it uses in production:
 *
 * - **better-auth runs as `qcms_app`.** Creating the admin and both enrolments go
 *   through the real library on the application credential, which is what every
 *   API process holds.
 * - **The reset runs as `qcms_migrate`.** And the same call on the `qcms_app`
 *   handle is refused, even though that role holds `DELETE` on every table in
 *   `public` and could perfectly well execute the statement. That is the point:
 *   the guard is ownership, not privilege, so reaching the credential that is on a
 *   running box does not reach the break-glass.
 *
 * ## Why the enrolment is driven through better-auth rather than inserted
 *
 * "The admin can enrol again" is the acceptance criterion, and only the library
 * can answer it: a hand-written `twoFactor` row would be encrypted by this test
 * rather than by the plugin, and a sign-in that then verified against it would be
 * testing the fixture. The enrolment here is the two-step the mounted surface
 * performs (`enableTwoFactor`, then a real TOTP code), the same shape
 * `backup-code-storage.integration.test.ts` uses, so the assertion after the reset
 * is that a genuine enrolment completes on an account whose previous one was
 * deleted underneath it.
 *
 * Requires Docker.
 */

const MIGRATE_ROLE = "qcms_migrate";
const APP_ROLE = "qcms_app";

/**
 * Generated per run, not written down: a literal here is a hard-coded credential
 * the lint gate flags, and the fixture only needs to be long enough to be accepted.
 */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "locked.out@example.test";
/** A second account, never enrolled, for the no-op and ambiguity cases. */
const SPARE_EMAIL = "never.enrolled@example.test";

let testDb: TestDb;
let owner: pg.Client;
let migratePool: pg.Pool;
let appPool: pg.Pool;
/** The migration role's handle: what the command connects with. */
let migrateDb: Executor;
/** The application role's handle: what every API process connects with. */
let appDb: Executor;
let auth: AdminAuth;
/** The `twoFactor.backupCodes` blob of the first enrolment, to prove the second differs. */
let firstBlob = "";

/** A throwaway password for a containerised role. Generated, never committed. */
function ephemeralPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `testDb`'s connection string rewritten to authenticate as `role`. */
function uriFor(role: string, password: string): string {
  const uri = new URL(testDb.connectionUri);
  uri.username = role;
  uri.password = password;
  return uri.toString();
}

/** The TOTP secret better-auth just provisioned, read off the otpauth URI. */
function secretFromUri(totpUri: string): string {
  const secret = new URL(totpUri).searchParams.get("secret");
  if (secret === null) throw new Error("no secret in the provisioning URI");
  return secret;
}

/** One cookie header from a better-auth response's `Set-Cookie` list. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * Complete a real two-step enrolment for the fixture account and return the
 * session cookie it ends on.
 */
async function enrol(): Promise<void> {
  const signedIn = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  expect(signedIn.ok, "a password-only sign-in should succeed on an un-enrolled account").toBe(
    true,
  );
  const body = (await signedIn.clone().json()) as { twoFactorRedirect?: boolean };
  expect(body.twoFactorRedirect, "no challenge is owed before enrolment").toBeUndefined();

  const cookie = cookiesOf(signedIn);
  const enabled = await auth.api.enableTwoFactor({
    body: { password: PASSWORD },
    headers: new Headers({ cookie }),
    asResponse: true,
  });
  const provisioned = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
  expect(provisioned.backupCodes.length).toBeGreaterThan(0);

  const verified = await auth.api.verifyTOTP({
    body: { code: await generate({ secret: secretFromUri(provisioned.totpURI) }) },
    headers: new Headers({ cookie }),
    asResponse: true,
  });
  expect(verified.ok, "a real TOTP code should complete enrolment").toBe(true);
}

/** Rows in `twoFactor` for the fixture account. */
async function factorRows(): Promise<{ id: string; backupCodes: string }[]> {
  const rows = await migrateDb
    .select({ id: authTwoFactor.id, backupCodes: authTwoFactor.backupCodes })
    .from(authTwoFactor);
  return rows.map((row) => ({ id: row.id, backupCodes: String(row.backupCodes) }));
}

/** Whether the fixture account is currently enrolled. */
async function isEnrolled(email: string): Promise<boolean> {
  const rows = await migrateDb
    .select({ email: authUser.email, twoFactorEnabled: authUser.twoFactorEnabled })
    .from(authUser);
  return rows.find((row) => row.email === email)?.twoFactorEnabled === true;
}

/** One audit row, in the shape this suite asserts on. */
interface AuditRow {
  readonly id: string;
  readonly email: string;
  readonly databaseRole: string;
  readonly clearedFactors: number;
  readonly wasEnrolled: boolean;
}

/** Every audit row. */
async function auditRows(): Promise<AuditRow[]> {
  return migrateDb
    .select({
      id: twoFactorResets.id,
      email: twoFactorResets.email,
      databaseRole: twoFactorResets.databaseRole,
      clearedFactors: twoFactorResets.clearedFactors,
      wasEnrolled: twoFactorResets.wasEnrolled,
    })
    .from(twoFactorResets);
}

beforeAll(async () => {
  // UNMIGRATED on purpose: the recipe runs before the first migration, and the
  // migration then runs as qcms_migrate. Migrating as the superuser first would
  // leave every object owned by the wrong role, and the ownership guard this suite
  // exists to exercise would be asserting nothing.
  testDb = await startTestDb({ migrate: false });
  owner = new pg.Client({ connectionString: testDb.connectionUri });
  await owner.connect();

  const migratePassword = ephemeralPassword();
  const appPassword = ephemeralPassword();

  await owner.query(`CREATE ROLE ${MIGRATE_ROLE} LOGIN PASSWORD '${migratePassword}'`);
  await owner.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${appPassword}'`);
  await owner.query(`ALTER SCHEMA public OWNER TO ${MIGRATE_ROLE}`);
  const database = (await owner.query<{ name: string }>("SELECT current_database() AS name"))
    .rows[0]?.name;
  await owner.query(`GRANT CREATE ON DATABASE "${String(database)}" TO ${MIGRATE_ROLE}`);
  await owner.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} GRANT SELECT ON TABLES TO ${APP_ROLE}`,
  );
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} IN SCHEMA public
       GRANT INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
  );
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} IN SCHEMA public
       GRANT USAGE ON SEQUENCES TO ${APP_ROLE}`,
  );
  await owner.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATE_ROLE} GRANT USAGE ON SCHEMAS TO ${APP_ROLE}`,
  );

  const migrator = new pg.Client({ connectionString: uriFor(MIGRATE_ROLE, migratePassword) });
  await migrator.connect();
  await applyMigrations(migrator);
  await migrator.end();

  migratePool = new pg.Pool({ connectionString: uriFor(MIGRATE_ROLE, migratePassword) });
  appPool = new pg.Pool({ connectionString: uriFor(APP_ROLE, appPassword) });
  migrateDb = drizzle(migratePool, { schema });
  appDb = drizzle(appPool, { schema });

  const config = loadAdminAuthConfig(
    validEnv({ DATABASE_URL: testDb.connectionUri, QCMS_ADMIN_BASE_URL: "http://localhost:7040" }),
  );
  auth = createAdminAuth({ db: appDb, adminAuth: config.adminAuth });

  const created = await createInitialAdmin(auth, appDb, { email: EMAIL, password: PASSWORD });
  expect(created.ok, "the fixture admin should be created").toBe(true);
  await enrol();
  firstBlob = (await factorRows())[0]?.backupCodes ?? "";
  expect(firstBlob).not.toBe("");
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await migratePool?.end();
  await appPool?.end();
  await owner?.end();
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the qcms_app refusal (SEC-10)", () => {
  it("refuses the credential every API process holds, even though it could execute the delete", async () => {
    // The precondition that makes this meaningful: the role IS allowed to delete
    // the row. If this ever fails, the refusal below stops being about ownership.
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query('DELETE FROM "twoFactor"');
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const outcome = await resetAdminTwoFactor(appDb, { email: EMAIL, confirm: true });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.kind).toBe("insufficient-database-role");
    expect(describeResetRefusal(outcome.refusal)).toContain(APP_ROLE);

    // And nothing moved.
    expect(await factorRows()).toHaveLength(1);
    expect(await isEnrolled(EMAIL)).toBe(true);
    expect(await auditRows()).toHaveLength(0);
  });
});

describe("resolving the account", () => {
  it("refuses an address no admin has", async () => {
    const outcome = await resetAdminTwoFactor(migrateDb, {
      email: "nobody@example.test",
      confirm: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.kind).toBe("no-such-admin");
    expect(await auditRows()).toHaveLength(0);
  });
});

describe("the dry run", () => {
  it("reports what it would clear and writes nothing without --yes", async () => {
    const outcome = await resetAdminTwoFactor(migrateDb, { email: EMAIL, confirm: false });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(describeResetRefusal(outcome.refusal));
    expect(outcome.applied).toBe(false);
    expect(outcome.target.email).toBe(EMAIL);
    expect(outcome.target.factorRows).toBe(1);
    expect(outcome.target.wasEnrolled).toBe(true);
    // The dry run says so in as many words; an operator who misses it acts on the
    // wrong belief, so the sentence is part of the contract.
    expect(describeResetOutcome(outcome)).toContain("Nothing has changed");
    expect(describeResetOutcome(outcome)).toContain("--yes");

    expect(await factorRows()).toHaveLength(1);
    expect(await isEnrolled(EMAIL)).toBe(true);
    expect(await auditRows()).toHaveLength(0);
  });
});

describe("the reset itself", () => {
  it("clears the second factor and the recovery codes, and records the run", async () => {
    const outcome = await resetAdminTwoFactor(migrateDb, { email: EMAIL, confirm: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.applied) throw new Error("the reset should have applied");
    expect(outcome.target.factorRows).toBe(1);
    expect(outcome.databaseRole).toBe(MIGRATE_ROLE);

    // The row is gone, so the recovery codes are gone with it: better-auth keeps
    // them in `twoFactor.backupCodes`, which is why no separate statement clears them.
    expect(await factorRows()).toHaveLength(0);
    expect(await isEnrolled(EMAIL)).toBe(false);

    // What the operator actually reads. Asserted here rather than in a unit test
    // because these are the real values: a real audit id and the role the reset
    // genuinely ran as, not a fixture's idea of them.
    const printed = describeResetOutcome(outcome);
    expect(printed).toContain(EMAIL);
    expect(printed).toContain(outcome.auditId);
    expect(printed).toContain(MIGRATE_ROLE);
    expect(printed).toContain("Existing sessions are left alone");

    const audit = await auditRows();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.id).toBe(outcome.auditId);
    expect(audit[0]?.email).toBe(EMAIL);
    expect(audit[0]?.databaseRole).toBe(MIGRATE_ROLE);
    expect(audit[0]?.clearedFactors).toBe(1);
    expect(audit[0]?.wasEnrolled).toBe(true);
  });

  it("lets that admin sign in on the password alone and enrol a new factor", async () => {
    await enrol();
    expect(await isEnrolled(EMAIL)).toBe(true);
    const rows = await factorRows();
    expect(rows).toHaveLength(1);
    // A genuinely new enrolment, not the old one restored: the stored blob is
    // ciphertext over a freshly generated secret and a fresh set of codes.
    expect(rows[0]?.backupCodes).not.toBe(firstBlob);
  });
});

describe("an account with nothing to clear, and an ambiguous address", () => {
  it("records the run even when there was no factor to remove", async () => {
    await migrateDb
      .insert(authUser)
      .values({ id: crypto.randomUUID(), name: "Spare", email: SPARE_EMAIL });

    const outcome = await resetAdminTwoFactor(migrateDb, { email: SPARE_EMAIL, confirm: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.applied) throw new Error("the reset should have applied");
    expect(outcome.target.factorRows).toBe(0);
    expect(outcome.target.wasEnrolled).toBe(false);

    const audit = await auditRows();
    expect(audit).toHaveLength(2);
    const recorded = audit.find((row) => row.email === SPARE_EMAIL);
    expect(recorded?.clearedFactors).toBe(0);
    expect(recorded?.wasEnrolled).toBe(false);
  });

  it("refuses when two accounts differ only in the case of their address", async () => {
    // Two distinct rows under `user.email`'s unique index, one address to an
    // operator. This is why the resolution is case-insensitive and why the
    // ambiguity refusal is not dead code.
    await migrateDb
      .insert(authUser)
      .values({ id: crypto.randomUUID(), name: "Twin", email: SPARE_EMAIL.toUpperCase() });

    const outcome = await resetAdminTwoFactor(migrateDb, { email: SPARE_EMAIL, confirm: true });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.kind).toBe("ambiguous-email");
    expect(outcome.refusal.kind === "ambiguous-email" && outcome.refusal.matches).toBe(2);
    // Refused before anything was written: still the two rows from the test above.
    expect(await auditRows()).toHaveLength(2);
  });
});
