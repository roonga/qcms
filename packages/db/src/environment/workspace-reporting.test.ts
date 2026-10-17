/**
 * The per-(workspace, environment) reporting consumers, as string work (Q26, task 067).
 *
 * Criterion 7 is asserted against a real Postgres, in
 * `apps/api/e2e/security/03-db-least-privilege.e2e.ts`: what a role granted one
 * workspace's views in one environment can and cannot read is a fact about privileges and
 * is not provable from a string. What **is** provable here, and worth proving, is the
 * shape of the statements that produce those privileges, because every property the
 * criterion rests on is visible in them:
 *
 *   - the grant names **the two views**, never `ALL TABLES IN SCHEMA`, which is the one
 *     form that would hand a workspace's analysts every other workspace's views the
 *     moment a second set appeared;
 *   - the views are a **filtered projection of the unprefixed pair**, so the erasure
 *     anti-join and the submitted-only predicate stay in one body;
 *   - the filter is the workspace **id** and the name is the **slug**;
 *   - an identifier that would be silently truncated, or a slug that could not be quoted
 *     safely, is **refused and named** rather than built.
 */

import { describe, expect, it } from "vitest";

import { reportingViewColumns, workspaceReportingViewNames } from "../reporting-views.js";
import {
  ENVIRONMENT_NAME_PREFIXES,
  WORKSPACE_REPORTING_ROLE_PREFIX,
  workspaceReportingRoleName,
} from "../schema/schemas.js";

import { refuseWorkspaceReportingNames } from "./reporting.js";
import { workspaceReportingStatements } from "./sql.js";

const PAIR = { environment: "prod", slug: "home", workspaceId: "org_home" } as const;

describe("one workspace's reporting view set", () => {
  const statements = workspaceReportingStatements(PAIR);

  it("creates one view per documented view, named with the workspace's slug", () => {
    const creates = statements.filter((statement) => statement.startsWith("CREATE OR REPLACE"));
    expect(creates).toHaveLength(reportingViewColumns.length);
    for (const view of workspaceReportingViewNames(PAIR.slug)) {
      expect(creates.some((statement) => statement.includes(`"reporting_prod"."${view}"`))).toBe(
        true,
      );
    }
    expect(workspaceReportingViewNames("home")).toEqual(["home_responses", "home_answers_flat"]);
  });

  it("projects the unprefixed pair rather than restating its body", () => {
    // The property that keeps the erasure anti-join and the submitted-only predicate in
    // one place: a per-workspace view that had its own copy of them could lose one, and
    // what it would then serve is an erased respondent's answers.
    const [responses, answersFlat] = statements;
    expect(responses).toContain(`FROM "reporting_prod"."responses" "w"`);
    expect(answersFlat).toContain(`FROM "reporting_prod"."answers_flat" "w"`);
    for (const statement of [responses, answersFlat]) {
      expect(statement).not.toContain("erasure_tombstones");
      expect(statement).not.toContain("'submitted'");
    }
  });

  it("filters on the workspace id, which is the stable half", () => {
    for (const statement of statements.filter((s) => s.startsWith("CREATE OR REPLACE"))) {
      expect(statement).toContain(`"workspace_id" = 'org_home'`);
      expect(statement).toContain(`FROM "control"."forms"`);
    }
  });

  it("carries the documented columns in the documented order", () => {
    for (const [index, contract] of reportingViewColumns.entries()) {
      const statement = statements[index] ?? "";
      const projected = [...statement.matchAll(/"w"\."(\w+)" AS "(\w+)"/g)].map((m) => m[2]);
      expect(projected).toEqual([...contract.columns]);
    }
  });
});

describe("the read-only role's grants", () => {
  const granted = workspaceReportingStatements(PAIR).find((statement) =>
    statement.startsWith("DO $$"),
  );

  it("names the two views and never ALL TABLES IN SCHEMA", () => {
    expect(granted).toBeDefined();
    expect(granted).toContain(`GRANT USAGE ON SCHEMA "reporting_prod"`);
    expect(granted).toContain(`GRANT SELECT ON "reporting_prod"."home_responses"`);
    expect(granted).toContain(`GRANT SELECT ON "reporting_prod"."home_answers_flat"`);
    // The whole of criterion 7's first half, as a negative: `ALL TABLES` would include
    // every other workspace's views and the application's own unfiltered pair.
    expect(granted).not.toContain("ALL TABLES");
    expect(granted).not.toContain(`"reporting_prod"."responses"`);
  });

  it("is guarded on the role existing, like every other grant in this design", () => {
    // An operator may provision these roles their own way, and most databases this runs
    // against have none of them: an unguarded GRANT would fail and take the whole
    // transaction with it.
    expect(granted).toContain("FROM pg_roles WHERE rolname");
    expect(granted).toContain("qcms_reporting_prod_home");
  });

  it("names the role for the pair it belongs to", () => {
    expect(workspaceReportingRoleName("test", "vehicle")).toBe("qcms_reporting_test_vehicle");
  });
});

describe("the names a pair cannot have", () => {
  it("accepts an ordinary pair", () => {
    expect(refuseWorkspaceReportingNames("prod", "home")).toBeUndefined();
    expect(refuseWorkspaceReportingNames("prod", "home-insurance")).toBeUndefined();
  });

  it("refuses a slug that is not a slug, because a view name cannot be a bind parameter", () => {
    // DDL takes no parameters, so a slug this command would have to quote is a slug it
    // refuses. The row is not a request: `organization.slug` has no CHECK, better-auth is
    // a second writer and an operator with the migration credential is a third.
    for (const bad of ['a"b', "Home", "home_insurance", "-home", "home-", "", "home.prod"]) {
      expect(refuseWorkspaceReportingNames("prod", bad), bad).toMatch(/cannot name a reporting/);
    }
  });

  it("refuses an identifier Postgres would truncate, naming the one that would not fit", () => {
    const refusal = refuseWorkspaceReportingNames("prod", "a".repeat(60));
    expect(refusal).toMatch(/aaaa/);
    expect(refusal).toMatch(/silently truncates/);
  });

  it("puts its role prefix in the environment-name length derivation", () => {
    // ADR-40: "the per-(workspace, environment) reporting role joins the list when task
    // 067 names it, and re-derives the limit if its prefix is the longer one". It is, so
    // the limit dropped from 53 to 48 - and this is the assertion that the list is where
    // the drop came from rather than a number somebody edited.
    expect(ENVIRONMENT_NAME_PREFIXES).toContain(WORKSPACE_REPORTING_ROLE_PREFIX);
    expect(Math.max(...ENVIRONMENT_NAME_PREFIXES.map((prefix) => prefix.length))).toBe(
      WORKSPACE_REPORTING_ROLE_PREFIX.length,
    );
  });
});
