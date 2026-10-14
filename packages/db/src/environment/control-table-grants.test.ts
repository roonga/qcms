import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTROL_READ_TABLES, grantControlTableStatements } from "./sql.js";

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
