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

/** Requires Docker, like every `*.integration.test.ts`. */

const TIMEOUT_MS = 60_000;

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

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
    expect(pair?.roleExists).toBe(false);
    expect(pair?.archived).toBe(false);
  });

  it("gives a newly created environment every workspace's views without a second command", async () => {
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
    // Postgres truncates an over-long identifier silently, so two such slugs would
    // quietly share one role.
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
        // A throwaway credential, generated rather than committed.
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
    // Least privilege: not the unfiltered pair, and not another workspace's set.
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
    const definition = await testDb.db.execute<{ definition: string }>(
      sql`select pg_get_viewdef('reporting_prod.home_responses'::regclass, true) as definition`,
    );
    expect(definition.rows[0]?.definition).toContain("org_recon_home");
    expect(definition.rows[0]?.definition).toContain("forms");
    expect(definition.rows[0]?.definition).toContain("responses");
    expect(definition.rows[0]?.definition).not.toContain("erasure_tombstones");
  });

  it("leaves the seeded workspace's set beside the others", async () => {
    const report = await reconcileWorkspaceReporting(testDb.db);
    expect(report.pairs.some((pair) => pair.workspaceId === SEED_WORKSPACE_ID)).toBe(true);
  });
});
