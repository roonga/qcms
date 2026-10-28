import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Executor } from "../queries/executor.js";
import { listEnvironmentNames } from "../queries/grants.js";
import {
  CONTAINER_BOOT_TIMEOUT_MS,
  PRIVILEGE_MAP_SQL,
  applyMigrations,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";

import { workspaceReportingRoleName } from "../schema/schemas.js";

import { createEnvironment, ownsControlSchema } from "./command.js";
import { reconcileWorkspaceReporting } from "./reporting.js";
import { describeError } from "./describe-error.js";
import { GRANT_SOURCES } from "./grants.js";
import { regrantEnvironments } from "./regrant.js";

const REGRANT_TIMEOUT_MS = 60_000;

const MIGRATE_ROLE = "qcms_migrate";

const WORKSPACES: readonly (readonly [string, string])[] = [
  ["org_regrant_home", "home"],
  ["org_regrant_vehicle", "vehicle"],
];
const APPLICATION_ROLES = [
  "qcms_app_control",
  "qcms_app_test",
  "qcms_app_prod",
  "qcms_app_zebra",
] as const;

let testDb: TestDb;
let owner: pg.Client;
let db: Executor;
/** Generated, never committed. */
let password: string;

function ephemeralPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** No schema is excluded: this harness never recreates the database. */
async function grantMap(client: pg.Client): Promise<string[]> {
  const res = await client.query<{ line: string }>(PRIVILEGE_MAP_SQL, [[]]);
  return res.rows.map((row) => row.line);
}

beforeAll(async () => {
  // Unmigrated: the roles have to exist before the baseline reaches its grant block, or
  // there is no grant to compare against.
  testDb = await startTestDb({ migrate: false });
  owner = testDb.register(new pg.Client({ connectionString: testDb.connectionUri }), "owner");
  await owner.connect();

  password = ephemeralPassword();
  for (const role of [MIGRATE_ROLE, ...APPLICATION_ROLES]) {
    // The role name is a literal from the list above, never input.
    await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  }
  await applyMigrations(owner);
  for (const [id, slug] of WORKSPACES) {
    await owner.query(
      `insert into control.organization (id, name, slug, "createdAt") values ($1, $1, $2, now())`,
      [id, slug],
    );
    for (const environment of ["test", "prod"]) {
      await owner.query(
        `CREATE ROLE ${workspaceReportingRoleName(environment, slug)} LOGIN PASSWORD '${password}'`,
      );
    }
  }
  // Registered so teardown drains it before the container stops; an unregistered pool
  // reports an unhandled termination error.
  const pool = testDb.register(
    new pg.Pool({ connectionString: testDb.connectionUri }),
    "owner pool",
  );
  // Cast: `drizzle(pool)` with no schema satisfies `Executor` structurally but not
  // nominally, and nothing under test reads a declared table through it.
  db = drizzle(pool) as unknown as Executor;
  // Required setup: without it the database holds no per-workspace view.
  await reconcileWorkspaceReporting(db);
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

describe("the re-grant subcommand", { timeout: REGRANT_TIMEOUT_MS }, () => {
  it("reads the live set in `position` order", async () => {
    expect(await listEnvironmentNames(db)).toEqual(["test", "prod"]);
  });

  it("changes nothing on a database that is already correct", async () => {
    const before = await grantMap(owner);
    expect(before.length).toBeGreaterThan(50);
    const report = await regrantEnvironments(db);
    expect(report.environments).toEqual(["test", "prod"]);
    expect(report.statements).toBeGreaterThan(0);
    expect(await grantMap(owner)).toEqual(before);
  });

  it("changes nothing when it runs twice", async () => {
    const after = await grantMap(owner);
    await regrantEnvironments(db);
    expect(await grantMap(owner)).toEqual(after);
  });

  it("reports one pass per source, with every environment-scoped source expanded", async () => {
    const report = await regrantEnvironments(db);
    const perEnvironment = GRANT_SOURCES.filter((source) => source.scope !== "installation").length;
    const installation = GRANT_SOURCES.length - perEnvironment;
    expect(report.passes).toHaveLength(installation + perEnvironment * 2);
    for (const pass of report.passes) expect(pass.statements).toBeGreaterThan(0);
  });

  it("reports that `public` grants PUBLIC no CREATE, which the baseline established", async () => {
    const report = await regrantEnvironments(db);
    expect(report.publicCreateGrantedToPublic).toBe(false);
  });

  it("restores exactly the grant map after the application grants are taken away", async () => {
    // The repair must land on the same grant map, never a superset.
    const expected = await grantMap(owner);
    for (const role of APPLICATION_ROLES) {
      for (const schema of [
        "control",
        "data_test",
        "data_prod",
        "reporting_test",
        "reporting_prod",
      ]) {
        await owner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM ${role}`);
        await owner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM ${role}`);
        await owner.query(`REVOKE ALL ON SCHEMA ${schema} FROM ${role}`);
      }
    }
    const stripped = await grantMap(owner);
    expect(stripped).not.toEqual(expected);
    const refused = await owner.query<{ has: boolean }>(
      `select has_table_privilege('qcms_app_prod', 'data_prod.sessions', 'INSERT') as has`,
    );
    expect(refused.rows[0]?.has).toBe(false);

    await regrantEnvironments(db);
    expect(await grantMap(owner)).toEqual(expected);
  });

  it("covers an environment created after the migrations, by reading the live set", async () => {
    await owner.query(`CREATE ROLE qcms_app_staging LOGIN PASSWORD '${password}'`);
    await createEnvironment(db, { name: "staging" });
    const expected = await grantMap(owner);
    for (const schema of ["control", "data_staging", "reporting_staging"]) {
      await owner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM qcms_app_staging`);
      await owner.query(`REVOKE ALL ON SCHEMA ${schema} FROM qcms_app_staging`);
    }
    expect(await grantMap(owner)).not.toEqual(expected);

    const report = await regrantEnvironments(db);
    expect(report.environments).toEqual(["test", "prod", "staging"]);
    expect(await grantMap(owner)).toEqual(expected);
  });

  it("names the source and never the statement when Postgres refuses (SEC-8)", async () => {
    // drizzle wraps a failed statement in an error carrying the SQL and its params, and
    // the CLI unwraps a cause into the line it writes to stderr.
    const uri = new URL(testDb.connectionUri);
    uri.username = "qcms_app_control";
    uri.password = password;
    const pool = testDb.register(new pg.Pool({ connectionString: uri.toString() }), "non-owner");
    // Cast: `drizzle(pool)` with no schema satisfies `Executor` structurally but not
    // nominally, and nothing under test reads a declared table through it.
    const asApplicationRole = drizzle(pool) as unknown as Executor;
    expect((await ownsControlSchema(asApplicationRole)).owns).toBe(false);

    const failure = await regrantEnvironments(asApplicationRole).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    // Cast: a narrowing the compiler cannot make through `unknown`.
    const thrown = failure as Error;

    // What the entry file actually writes to stderr, which is the layer that matters.
    const printed = `qcms-db environment failed: ${describeError(thrown)}`;
    for (const leak of [/\bGRANT\b/, /\bREVOKE\b/, /Failed query/, /DO \$\$/, /params:/]) {
      expect(printed, `stderr must not carry ${String(leak)}`).not.toMatch(leak);
    }
    expect(printed).toContain("could not re-apply");
    expect(printed).toContain("the control role's DML on control (baseline)");
    expect(printed).toMatch(/permission denied/i);
    // `describeError` appends a cause's message, so the wrapper must attach none.
    expect(thrown.cause).toBeUndefined();
  });

  it("is stable over a workspace whose reporting roles the operator has not created", async () => {
    // These views carry a NULL `relacl`, and a `REVOKE` on one materialises it: the
    // owner's implicit entries then appear for a semantically unchanged relation.
    await owner.query(
      `insert into control.organization (id, name, slug, "createdAt")
         values ('org_regrant_unprovisioned', 'Unprovisioned', 'unprovisioned', now())`,
    );
    await reconcileWorkspaceReporting(db);
    const expected = await grantMap(owner);
    expect(expected.filter((line) => line.includes("unprovisioned"))).toEqual([]);

    await regrantEnvironments(db);
    expect(await grantMap(owner), "after one re-grant").toEqual(expected);
    await regrantEnvironments(db);
    expect(await grantMap(owner), "after a second re-grant").toEqual(expected);
  });

  it("names the read and never the query when a READ fails (SEC-8)", async () => {
    // A rename is the cheapest way to make one of the reads fail.
    await owner.query(`alter table control.environments rename to environments_sec8_renamed`);
    try {
      const failure = await regrantEnvironments(db).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      // Cast: a narrowing the compiler cannot make through `unknown`.
      const thrown = failure as Error;
      const printed = `qcms-db environment failed: ${describeError(thrown)}`;

      for (const leak of [/Failed query/, /params:/, /\bselect\b/i, /\bGRANT\b/, /DO \$\$/]) {
        expect(printed, `stderr must not carry ${String(leak)}`).not.toMatch(leak);
      }
      expect(printed).toContain("could not read the live environment set");
      expect(printed).toMatch(/does not exist/i);
      expect(thrown.cause).toBeUndefined();
    } finally {
      await owner.query(`alter table control.environments_sec8_renamed rename to environments`);
    }
  });

  it("refuses a database whose live set is empty, rather than granting nothing quietly", async () => {
    await owner.query(
      `create table control.environments_regrant_backup as table control.environments`,
    );
    await owner.query(`delete from control.environments where name = 'staging'`);
    await owner.query(`alter table control.form_releases disable trigger all`);
    await owner.query(`delete from control.form_releases`);
    await owner.query(`delete from control.environments`);
    try {
      await expect(regrantEnvironments(db)).rejects.toThrow(/environments is empty/);
    } finally {
      await owner.query(
        `insert into control.environments select * from control.environments_regrant_backup`,
      );
      await owner.query(`alter table control.form_releases enable trigger all`);
      await owner.query(`drop table control.environments_regrant_backup`);
    }
  });
});
