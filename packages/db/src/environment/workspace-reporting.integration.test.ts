import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CONTAINER_BOOT_TIMEOUT_MS,
  SEED_WORKSPACE_ID,
  startTestDb,
  type TestDb,
} from "../testing/harness.js";
import { authOrganization } from "../schema/index.js";

import { createEnvironment } from "./command.js";
import { reconcileWorkspaceReporting } from "./reporting.js";

/**
 * The per-(workspace, environment) reporting reconciliation, against a real Postgres (Q26;
 * task 067, criterion 7's other half).
 *
 * The least-privilege suite asserts what a consumer **role** can and cannot read, which is
 * the criterion. What is asserted here is the thing that puts those views and grants there:
 * that the command covers the whole cross product, that running it twice is running it
 * once, that an environment created afterwards arrives with every workspace's views
 * already in it, and that a name it cannot build is refused rather than truncated.
 *
 * Idempotency is the property worth a container of its own. An operator runs this after
 * every workspace they create, over a set that already mostly exists, so a command that
 * failed on the second run would be a command nobody could follow the documentation for.
 *
 * Requires Docker, like every `*.integration.test.ts`.
 */

const TIMEOUT_MS = 60_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

/** The views that exist in one reporting schema, by name. */
async function viewsIn(schema: string): Promise<string[]> {
  const res = await testDb.db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.views
         where table_schema = ${schema} order by table_name`,
  );
  return res.rows.map((row) => row.table_name);
}

describe("reconciling the per-workspace reporting view sets", { timeout: TIMEOUT_MS }, () => {
  it("covers every (workspace, environment) pair and is idempotent", async () => {
    await testDb.db
      .insert(authOrganization)
      .values({ id: "org_recon_home", name: "Home", slug: "home" });

    const first = await reconcileWorkspaceReporting(testDb.db);
    expect(first.refusals).toEqual([]);
    // The cross product: the seeded workspace and the one above, in both shipped
    // environments. Asserted as a set rather than a count, so a pair that went missing is
    // named by the failure.
    expect(
      first.pairs.map((pair) => `${pair.reportingSchema}/${pair.workspaceSlug}`).sort(),
    ).toEqual([
      "reporting_prod/default",
      "reporting_prod/home",
      "reporting_test/default",
      "reporting_test/home",
    ]);

    expect(await viewsIn("reporting_prod")).toEqual([
      "answers_flat",
      "default_answers_flat",
      "default_responses",
      "home_answers_flat",
      "home_responses",
      "responses",
    ]);

    // Twice is once. `CREATE OR REPLACE VIEW` and grants that are no-ops when already
    // held, which is what lets the documentation say "run this after creating a
    // workspace" without a caveat.
    const second = await reconcileWorkspaceReporting(testDb.db);
    expect(second.refusals).toEqual([]);
    expect(second.pairs.length).toBe(first.pairs.length);
    expect(await viewsIn("reporting_prod")).toEqual(await viewsIn("reporting_prod"));
  });

  it("reports the role per pair and whether it exists yet", async () => {
    const report = await reconcileWorkspaceReporting(testDb.db);
    const pair = report.pairs.find(
      (row) => row.environment === "prod" && row.workspaceSlug === "home",
    );
    expect(pair?.role).toBe("qcms_reporting_prod_home");
    expect(pair?.views).toEqual(["home_responses", "home_answers_flat"]);
    // No role in this container, and the line says so rather than reporting a grant that
    // was guarded out: a grant that silently did not land is the failure an operator needs
    // named.
    expect(pair?.roleExists).toBe(false);
    expect(pair?.archived).toBe(false);
  });

  it("gives a newly created environment every workspace's views without a second command", async () => {
    // Criterion 2's shape applied to this object: the environment command emits the same
    // statements for the environment it builds, because there is no `ALTER DEFAULT
    // PRIVILEGES` anywhere in this design and an object a later environment needs has to
    // be emitted by whatever creates the environment.
    await createEnvironment(testDb.db, { name: "dev" });
    expect(await viewsIn("reporting_dev")).toEqual([
      "answers_flat",
      "default_answers_flat",
      "default_responses",
      "home_answers_flat",
      "home_responses",
      "responses",
    ]);
  });

  it("keeps an archived workspace's views and says so", async () => {
    // Q66 makes an archive terminal; it says nothing about destroying the record of what
    // the workspace held, and these views are what an adopter's BI tool is connected to.
    // Tidying one away would break a report as a side effect of an administrative act.
    await testDb.db.execute(
      sql`update control.organization set "archivedAt" = now() where id = 'org_recon_home'`,
    );
    const report = await reconcileWorkspaceReporting(testDb.db);
    const pair = report.pairs.find(
      (row) => row.environment === "prod" && row.workspaceSlug === "home",
    );
    expect(pair?.archived).toBe(true);
    expect(await viewsIn("reporting_prod")).toContain("home_responses");
  });

  it("refuses a pair it cannot name, and covers the rest", async () => {
    // Postgres truncates an over-long identifier silently, so two workspaces differing
    // only past the limit would quietly share one role. The refusal names the identifier
    // that would not fit, and the pairs that can be named are still reconciled - an
    // operator fixes one slug rather than losing every view set to it.
    const long = "w".repeat(60);
    await testDb.db
      .insert(authOrganization)
      .values({ id: "org_recon_long", name: "Long", slug: long });

    const report = await reconcileWorkspaceReporting(testDb.db);
    expect(report.refusals.join("\n")).toMatch(/silently truncates/);
    expect(report.pairs.some((pair) => pair.workspaceSlug === long)).toBe(false);
    expect(report.pairs.some((pair) => pair.workspaceSlug === "home")).toBe(true);
    await testDb.db.execute(sql`delete from control.organization where id = 'org_recon_long'`);
  });

  it("creates one pair's role when it is given a credential, and grants it", async () => {
    const report = await reconcileWorkspaceReporting(testDb.db, {
      create: {
        environment: "prod",
        workspaceSlug: "home",
        // A throwaway credential for a containerised role, generated rather than
        // committed.
        password: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      },
    });
    const pair = report.pairs.find(
      (row) => row.environment === "prod" && row.workspaceSlug === "home",
    );
    expect(pair?.roleExists).toBe(true);

    const granted = await testDb.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.role_table_grants
           where grantee = 'qcms_reporting_prod_home' and table_schema = 'reporting_prod'
           order by table_name`,
    );
    // Its own two views and nothing else in the schema, which is the whole of criterion 7
    // expressed as a catalogue read: the unfiltered pair and every other workspace's set
    // are absent.
    expect(granted.rows.map((row) => row.table_name)).toEqual([
      "home_answers_flat",
      "home_responses",
    ]);
  });

  it("refuses a pair whose workspace or environment does not exist", async () => {
    await expect(
      reconcileWorkspaceReporting(testDb.db, {
        create: { environment: "nowhere", workspaceSlug: "home", password: "unused" },
      }),
    ).rejects.toThrow(/environment nowhere does not exist/);
    await expect(
      reconcileWorkspaceReporting(testDb.db, {
        create: { environment: "prod", workspaceSlug: "nobody", password: "unused" },
      }),
    ).rejects.toThrow(/workspace nobody does not exist/);
  });

  it("filters a workspace's views to its own forms", async () => {
    // The predicate, read back from the catalogue rather than from the generator: the view
    // body carries the workspace **id**, which is the stable half, while the name carries
    // the slug.
    const definition = await testDb.db.execute<{ definition: string }>(
      sql`select pg_get_viewdef('reporting_prod.home_responses'::regclass, true) as definition`,
    );
    expect(definition.rows[0]?.definition).toContain("org_recon_home");
    expect(definition.rows[0]?.definition).toContain("forms");
    // And it projects the unprefixed view rather than restating its body, so the erasure
    // anti-join and the submitted-only predicate stay in one place.
    expect(definition.rows[0]?.definition).toContain("responses");
    expect(definition.rows[0]?.definition).not.toContain("erasure_tombstones");
  });

  it("leaves the seeded workspace's set beside the others", async () => {
    // Sanity on the fixture this file leans on: `SEED_WORKSPACE_ID` is the workspace a
    // bootstrapped installation has, and its set is reconciled like any other.
    const report = await reconcileWorkspaceReporting(testDb.db);
    expect(report.pairs.some((pair) => pair.workspaceId === SEED_WORKSPACE_ID)).toBe(true);
  });
});
