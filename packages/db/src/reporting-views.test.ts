/**
 * A hand-edit to the committed migration would leave each `reporting_<env>` describing
 * different views, and nothing else would notice.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SHIPPED_ENVIRONMENTS } from "./environment/baseline.js";
import { dataSchemaName, reportingSchemaName } from "./schema/schemas.js";
import {
  reportingViewColumns,
  reportingViewStatements,
  replaceReportingViewStatements,
} from "./reporting-views.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

/** Found by what it does, never by position: an appended migration must not shift it. */
function baselineSql(): { name: string; body: string } {
  const bodies = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, body: readFileSync(path.join(MIGRATIONS_DIR, name), "utf8") }))
    .filter((migration) => migration.body.includes('CREATE SCHEMA "reporting_'));
  const only = bodies[0];
  if (only === undefined) throw new Error(`no view-creating migration in ${MIGRATIONS_DIR}`);
  if (bodies.length > 1) {
    throw new Error(
      `${String(bodies.length)} migrations create a reporting schema; this file assumes one`,
    );
  }
  return only;
}

describe("the generator and the baseline agree, per environment", () => {
  const migration = baselineSql();

  it("found a migration to compare against, by derivation rather than by name", () => {
    expect(migration.name).toMatch(/^\d{4}_.*\.sql$/);
  });

  it.each(SHIPPED_ENVIRONMENTS)(
    "carries exactly what the generator emits for %s",
    (environment) => {
      for (const statement of reportingViewStatements({
        reporting: reportingSchemaName(environment),
        data: dataSchemaName(environment),
      })) {
        expect(migration.body, `${environment}: ${statement.slice(0, 60)}`).toContain(statement);
      }
    },
  );

  it("creates one view set per shipped environment and no unqualified `reporting` one", () => {
    for (const environment of SHIPPED_ENVIRONMENTS) {
      const reporting = reportingSchemaName(environment);
      expect(migration.body).toContain(`CREATE VIEW "${reporting}"."responses"`);
      expect(migration.body).toContain(`CREATE VIEW "${reporting}"."answers_flat"`);
    }
    expect(migration.body).not.toContain('CREATE VIEW "reporting"."responses"');
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
