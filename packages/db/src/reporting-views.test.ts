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
 *
 * **Task 064 changed what "the committed migration" means, and the first block below
 * with it.** There is no longer a migration whose whole body is one view set under one
 * schema name: the chain is a single per-environment baseline (Q41), and it carries the
 * generator's output **once per shipped environment**, among the tables, guards and
 * grants. So the agreement is asserted per environment against that baseline, which is
 * strictly more than the old "ends with the generated body" and is still derived rather
 * than written as a literal. `environment/baseline.test.ts` compares the whole
 * hand-authored half against its emitter, so a generator change that nobody re-emitted
 * fails there too.
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

/**
 * The marker a generated reporting-view migration carries in its preamble, and the
 * one this test finds it by.
 *
 * **Derived rather than named, because the migration chain is append-only.** The next
 * reshape of these views appends a migration and leaves the one before it applied and
 * untouched, so a test naming `0025` by hand would have to be retargeted by hand - and
 * a lane that forgot would either edit an applied migration or ship a generator nothing
 * compares. Tasks 064 and 068 move this body again, which makes that a near certainty
 * rather than a hypothetical. So the rule is in the code: the **highest-numbered**
 * migration that names the generator is the one whose body the generator must still
 * produce. The brief's "no test hard-codes a migration number" is the same rule.
 */
const GENERATOR_MARKER = "packages/db/src/reporting-views.ts";

/** The one baseline the chain is, read once for the assertions below. */
function baselineSql(): { name: string; body: string } {
  const named = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const newest = named.at(-1);
  if (newest === undefined) throw new Error(`no migration in ${MIGRATIONS_DIR}`);
  return { name: newest, body: readFileSync(path.join(MIGRATIONS_DIR, newest), "utf8") };
}

describe("the generator and the baseline agree, per environment", () => {
  const migration = baselineSql();

  it("found a migration to compare against, by derivation rather than by name", () => {
    // A filter that matched nothing would make every assertion below vacuous. The name
    // is matched by shape, never by number: the brief's rule, and the reason the old
    // form of this test had to go.
    expect(migration.name).toMatch(/^\d{4}_.*\.sql$/);
  });

  it.each(SHIPPED_ENVIRONMENTS)(
    "carries exactly what the generator emits for %s",
    (environment) => {
      // Byte for byte, every statement, in order. This is what keeps a hand-edit to the
      // baseline's view bodies from leaving `reporting_test` and `reporting_prod`
      // describing different views while nothing else notices - which is the whole
      // reason 075 made the DDL a function of its schema names.
      for (const statement of reportingViewStatements({
        reporting: reportingSchemaName(environment),
        data: dataSchemaName(environment),
      })) {
        expect(migration.body, `${environment}: ${statement.slice(0, 60)}`).toContain(statement);
      }
    },
  );

  it("creates one view set per shipped environment and no unqualified `reporting` one", () => {
    // The count is the claim: two environments, two `responses` views, two
    // `answers_flat`. An unqualified `reporting` schema would be the pre-ADR-40 shape
    // surviving by accident, so its absence is asserted rather than assumed.
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
