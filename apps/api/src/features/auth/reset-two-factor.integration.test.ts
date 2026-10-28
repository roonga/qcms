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

// The command's guard is which credential opened the connection, so each half of this
// suite runs as the role it runs as in production.

const MIGRATE_ROLE = "qcms_migrate";
// The control role (ADR-40): naming a role the baseline grants nothing to would make the
// refusal half pass for the wrong reason.
const APP_ROLE = "qcms_app_control";

/** Generated rather than literal so no credential-shaped string is ever committed here. */
const PASSWORD = `fixture-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;
const EMAIL = "locked.out@example.test";
const SPARE_EMAIL = "never.enrolled@example.test";

let testDb: TestDb;
let owner: pg.Client;
let migratePool: pg.Pool;
let appPool: pg.Pool;
let migrateDb: Executor;
let appDb: Executor;
let auth: AdminAuth;
let firstBlob = "";

/** Generated, never committed: a throwaway password for a containerised role. */
function ephemeralPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function uriFor(role: string, password: string): string {
  const uri = new URL(testDb.connectionUri);
  uri.username = role;
  uri.password = password;
  return uri.toString();
}

function secretFromUri(totpUri: string): string {
  const secret = new URL(totpUri).searchParams.get("secret");
  if (secret === null) throw new Error("no secret in the provisioning URI");
  return secret;
}

function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

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

async function factorRows(): Promise<{ id: string; backupCodes: string }[]> {
  const rows = await migrateDb
    .select({ id: authTwoFactor.id, backupCodes: authTwoFactor.backupCodes })
    .from(authTwoFactor);
  return rows.map((row) => ({ id: row.id, backupCodes: String(row.backupCodes) }));
}

async function isEnrolled(email: string): Promise<boolean> {
  const rows = await migrateDb
    .select({ email: authUser.email, twoFactorEnabled: authUser.twoFactorEnabled })
    .from(authUser);
  return rows.find((row) => row.email === email)?.twoFactorEnabled === true;
}

interface AuditRow {
  readonly id: string;
  readonly email: string;
  readonly databaseRole: string;
  readonly clearedFactors: number;
  readonly wasEnrolled: boolean;
}

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
  // Unmigrated: migrating as the superuser would leave every object owned by the wrong
  // role, and the ownership guard would assert nothing.
  testDb = await startTestDb({ migrate: false });
  // Registered with the harness so one teardown drains every connection in order.
  owner = testDb.register(
    new pg.Client({ connectionString: testDb.connectionUri }),
    "owner client",
  );
  await owner.connect();

  const migratePassword = ephemeralPassword();
  const appPassword = ephemeralPassword();

  await owner.query(`CREATE ROLE ${MIGRATE_ROLE} LOGIN PASSWORD '${migratePassword}'`);
  await owner.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${appPassword}'`);
  await owner.query(`ALTER SCHEMA public OWNER TO ${MIGRATE_ROLE}`);
  const database = (await owner.query<{ name: string }>("SELECT current_database() AS name"))
    .rows[0]?.name;
  await owner.query(`GRANT CREATE ON DATABASE "${String(database)}" TO ${MIGRATE_ROLE}`);
  // The table grants are the baseline migration's and are guarded on each role existing,
  // which is why both roles are created before it runs (ADR-40).
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

  const migrator = testDb.register(
    new pg.Client({ connectionString: uriFor(MIGRATE_ROLE, migratePassword) }),
    "migrator client",
  );
  await migrator.connect();
  await applyMigrations(migrator);
  // Closed here because the ownership assertions below must not see it; it is also
  // registered, so a throwing `applyMigrations` cannot leave it open.
  await migrator.end();

  migratePool = testDb.register(
    new pg.Pool({ connectionString: uriFor(MIGRATE_ROLE, migratePassword) }),
    "migrate pool",
  );
  appPool = testDb.register(
    new pg.Pool({ connectionString: uriFor(APP_ROLE, appPassword) }),
    "app pool",
  );
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
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the application-credential refusal (SEC-10)", () => {
  it("refuses the credential every API process holds, even though it could execute the delete", async () => {
    // The precondition: this role is allowed to delete the row, so the refusal below is
    // about ownership rather than privilege.
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      // Schema-qualified: `control` is on no connection's search path here.
      await client.query('DELETE FROM "control"."twoFactor"');
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const outcome = await resetAdminTwoFactor(appDb, { email: EMAIL, confirm: true });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.kind).toBe("insufficient-database-role");
    expect(describeResetRefusal(outcome.refusal)).toContain(APP_ROLE);

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

    // better-auth keeps the recovery codes in this row, so deleting it clears them and no
    // separate statement does.
    expect(await factorRows()).toHaveLength(0);
    expect(await isEnrolled(EMAIL)).toBe(false);

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
    await migrateDb
      .insert(authUser)
      .values({ id: crypto.randomUUID(), name: "Twin", email: SPARE_EMAIL.toUpperCase() });

    const outcome = await resetAdminTwoFactor(migrateDb, { email: SPARE_EMAIL, confirm: true });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.refusal.kind).toBe("ambiguous-email");
    expect(outcome.refusal.kind === "ambiguous-email" && outcome.refusal.matches).toBe(2);
    expect(await auditRows()).toHaveLength(2);
  });
});
