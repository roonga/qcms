/**
 * The reporting view generator and the committed migration are one thing (task
 * 075).
 *
 * The generator exists because ADR-40 makes the view set per environment and task
 * 068 makes it per workspace, so the DDL has to be creatable more than once under
 * more than one schema name. That only buys anything while the migration that
 * created the launch view set really is the generator's output: a migration
 * hand-edited after the fact would leave `reporting` and every `reporting_<env>`
 * created later describing different views, and nothing else would notice.
 *
 * So this file asserts the two agree byte for byte, and that the generator's
 * schema parameters actually reach the SQL. The live catalogue is compared against
 * `reportingViewColumns` by the drift test in
 * `queries/reporting-retention.integration.test.ts`, which needs a real Postgres;
 * everything here is pure string work.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  reportingViewColumns,
  reportingViewMigrationSql,
  reportingViewStatements,
  replaceReportingViewStatements,
} from "./reporting-views.js";

const MIGRATION = fileURLToPath(
  new URL("../migrations/0025_reporting_repeat_grain.sql", import.meta.url),
);

describe("the generator and migration 0025 agree", () => {
  const file = readFileSync(MIGRATION, "utf8");
  const generated = reportingViewMigrationSql({ reporting: "reporting" });

  it("ends with exactly the generated body", () => {
    expect(file.endsWith(generated)).toBe(true);
  });

  it("carries nothing but SQL comments before that body", () => {
    const preamble = file.slice(0, file.length - generated.length);
    const offending = preamble
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("--"));
    expect(offending).toEqual([]);
  });

  it("names the migration in the preamble, so a reader finds the generator", () => {
    expect(file).toContain("packages/db/src/reporting-views.ts");
  });
});

describe("the schema parameters reach the SQL", () => {
  it("qualifies the reporting views and leaves the data plane unqualified by default", () => {
    const [responses] = reportingViewStatements({ reporting: "reporting" });
    expect(responses).toContain('CREATE VIEW "reporting"."responses"');
    expect(responses).toContain('FROM "submissions" "sub"');
    expect(responses).toContain('FROM "answer_group_instances" "agi"');
  });

  it("qualifies the data plane too when a data schema is named (ADR-40, task 064)", () => {
    const [responses, flat] = reportingViewStatements({
      reporting: "reporting_test",
      data: "data_test",
    });
    expect(responses).toContain('CREATE VIEW "reporting_test"."responses"');
    expect(responses).toContain('FROM "data_test"."submissions" "sub"');
    expect(responses).toContain('JOIN "data_test"."sessions" "s"');
    expect(responses).toContain('LEFT JOIN "data_test"."erasure_tombstones" "t"');
    expect(responses).toContain('FROM "data_test"."answer_group_instances" "agi"');
    // answers_flat reads the reporting view, never the data plane directly.
    expect(flat).toContain('FROM "reporting_test"."responses" "r"');
    expect(flat).not.toContain("data_test");
  });

  it("creates no schema: an environment's schema is its owner's to create", () => {
    for (const statement of reportingViewStatements({ reporting: "reporting_prod" })) {
      expect(statement).not.toContain("CREATE SCHEMA");
    }
  });
});

describe("the replacement order", () => {
  it("drops the dependent view first and recreates both", () => {
    expect(replaceReportingViewStatements({ reporting: "reporting" })).toEqual([
      'DROP VIEW IF EXISTS "reporting"."answers_flat";',
      'DROP VIEW IF EXISTS "reporting"."responses";',
      ...reportingViewStatements({ reporting: "reporting" }),
    ]);
  });
});

describe("the documented column lists", () => {
  it("appends instance_id to answers_flat rather than inserting it", () => {
    const flat = reportingViewColumns.find((view) => view.name === "answers_flat");
    expect(flat?.columns.at(-1)).toBe("instance_id");
    // The six columns the contract had before 075, in their original positions.
    expect(flat?.columns.slice(0, 6)).toEqual([
      "session_id",
      "form_id",
      "form_version",
      "submitted_at",
      "question_id",
      "value",
    ]);
  });

  it("leaves reporting.responses' column list unchanged", () => {
    const responses = reportingViewColumns.find((view) => view.name === "responses");
    expect(responses?.columns).toEqual([
      "session_id",
      "form_id",
      "form_version",
      "submitted_at",
      "access_mode",
      "answers",
    ]);
  });

  it("names every column the generated select list aliases", () => {
    const statements = reportingViewStatements({ reporting: "reporting" });
    for (const [index, view] of reportingViewColumns.entries()) {
      const statement = statements[index]!;
      for (const column of view.columns) expect(statement).toContain(`AS "${column}"`);
    }
  });
});
