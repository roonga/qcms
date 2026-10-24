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

  it("declares `security_barrier`, which is what makes the filter a boundary", () => {
    // A plain view's WHERE is not a privilege boundary: Postgres may push a consumer's
    // qual below it and evaluate it against the rows the view hides.
    for (const statement of statements.filter((s) => s.startsWith("CREATE OR REPLACE"))) {
      expect(statement).toContain("WITH (security_barrier = true)");
    }
  });

  it("projects the unprefixed pair rather than restating its body", () => {
    // A per-workspace copy of the erasure anti-join could lose it and serve an erased
    // respondent's answers.
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
    expect(granted).not.toContain("ALL TABLES");
    expect(granted).not.toContain(`"reporting_prod"."responses"`);
  });

  it("is guarded on the role existing, like every other grant in this design", () => {
    // Most databases this runs against have none of these roles, and an unguarded GRANT
    // would take the transaction down.
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
    // DDL takes no bind parameters and `organization.slug` has no CHECK, so an
    // unquotable slug is refused rather than interpolated.
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
    expect(ENVIRONMENT_NAME_PREFIXES).toContain(WORKSPACE_REPORTING_ROLE_PREFIX);
    expect(Math.max(...ENVIRONMENT_NAME_PREFIXES.map((prefix) => prefix.length))).toBe(
      WORKSPACE_REPORTING_ROLE_PREFIX.length,
    );
  });
});
