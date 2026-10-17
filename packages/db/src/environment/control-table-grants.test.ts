import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCESS_AUDIT_TABLE } from "../schema/control/access-audit.js";
import {
  CONTROL_READ_TABLES,
  grantAccessAuditStatements,
  grantControlTableStatements,
  grantEnvironmentStatements,
} from "./sql.js";

/**
 * The grants in migration 0001 and the generator that emits them cannot drift.
 *
 * `baseline.test.ts` makes this comparison for migration 0000, which emits a whole
 * environment. This is the same property one table down, and it is worth asserting for
 * the same reason: a grant that lives only in checked-in SQL is a grant nobody notices
 * is wrong, because a migration with a missing `GRANT` **succeeds**. What fails is a
 * request, later, on a deployment that has application roles - which is not the
 * deployment most tests run against.
 *
 * `toContain` rather than a byte comparison of the whole file: the hand-authored half of
 * this migration also carries the two append-only triggers, which are prose SQL and not
 * a generator's output, so what is pinned here is that each generated statement is
 * present verbatim.
 */
const MIGRATION = fileURLToPath(
  new URL("../../migrations/0001_form_releases.sql", import.meta.url),
);

/** The migration that creates the SEC-15 access audit (task 069). */
const AUDIT_MIGRATION = fileURLToPath(
  new URL("../../migrations/0003_access_audit.sql", import.meta.url),
);

describe("the `form_releases` grants", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantControlTableStatements("form_releases");
    // Two: the control role's DML, and the loop that reaches every environment role.
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("grants `SELECT` to every environment role in the live set, by enumeration", () => {
    // Not a statement per shipped name. An operator may have created a third environment
    // before this migration runs, and its role has to come out of this migration holding
    // the same six-table read list as `test` and `prod` - otherwise the environment
    // created last week starts failing respondent requests on permission the moment a
    // form is released into it.
    expect(sql).toContain("FROM control.environments AS environment");
    expect(sql).toContain(`GRANT SELECT ON "control"."form_releases" TO %I`);
  });

  it("is a grant because `form_releases` is on the environment roles' read list", () => {
    // The link between the list and the statement, asserted rather than assumed: a
    // control-plane table that is NOT on the read list must get no environment-role grant
    // at all, and that is the branch this generator takes for every other new table.
    expect(CONTROL_READ_TABLES).toContain("form_releases");
    expect(grantControlTableStatements("two_factor_resets")).toHaveLength(1);
  });

  it("makes the history append-only at the database (criterion 7)", () => {
    // ADR-40's "the history is still append-only", as two guards rather than a sentence.
    // The grant above is DML, which is what the record gives this role on `control`, so
    // the immutability has to come from a trigger - the same division `form_versions`
    // already uses.
    expect(sql).toContain('CREATE TRIGGER "form_releases_reject_update"');
    expect(sql).toContain('CREATE TRIGGER "form_releases_reject_delete"');
  });
});

describe("the SEC-15 access audit's grants and revokes (task 069, Q40 with Q56)", () => {
  const sql = readFileSync(AUDIT_MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantAccessAuditStatements();
    // Three: the control role's SELECT and INSERT, the loop that reaches every
    // environment role with INSERT, and the revoke of UPDATE and DELETE from the prefix.
    expect(statements).toHaveLength(3);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("gives the control role SELECT and INSERT and neither of the other two", () => {
    expect(sql).toContain(
      `GRANT SELECT, INSERT ON "control"."${ACCESS_AUDIT_TABLE}" TO "qcms_app_control"`,
    );
    expect(sql).not.toContain(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "control"."${ACCESS_AUDIT_TABLE}"`,
    );
  });

  it("gives every environment role in the live set INSERT and nothing else", () => {
    expect(sql).toContain("FROM control.environments AS environment");
    expect(sql).toContain(`GRANT INSERT ON "control"."${ACCESS_AUDIT_TABLE}" TO %I`);
    expect(sql).not.toContain(`GRANT SELECT ON "control"."${ACCESS_AUDIT_TABLE}" TO %I`);
  });

  it("revokes UPDATE and DELETE from every `qcms_app%` role, by prefix", () => {
    // Not from the shipped names: there are as many application roles as there are
    // environments plus one, and an installation that creates `qcms_app_staging` next
    // week has to come out of this migration with the same control.
    expect(sql).toContain("WHERE rolname LIKE 'qcms\\_app%'");
    expect(sql).toContain(`REVOKE UPDATE, DELETE ON TABLE control.${ACCESS_AUDIT_TABLE} FROM %I`);
  });

  it("carries no trigger and no foreign key, both deliberately", () => {
    // SEC-15 says only `qcms_migrate` can alter an audit row, so the immutability is the
    // revoke above rather than a trigger, which would refuse that role too. And an audit
    // row that cascades away with what it describes is not an audit row.
    expect(sql).not.toContain("CREATE TRIGGER");
    expect(sql).not.toContain("FOREIGN KEY");
  });

  it("is owed twice, so the environment generator carries the same grant", () => {
    // The migration covers the environments that exist when it runs; this is what covers
    // every environment created afterwards. A generator that lacked it would leave a new
    // environment's role unable to write the audit row its own response reads need, and
    // the failure would be a refused read rather than a failed migration.
    const generated = grantEnvironmentStatements("staging").join("\n");
    expect(generated).toContain(
      `GRANT INSERT ON "control"."${ACCESS_AUDIT_TABLE}" TO "qcms_app_staging"`,
    );
    // Guarded on the table existing, because the baseline calls the generator before this
    // migration has run.
    expect(generated).toContain(`tablename = '${ACCESS_AUDIT_TABLE}'`);
  });
});
