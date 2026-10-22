import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCESS_AUDIT_TABLE } from "../schema/control/access-audit.js";
import { ENDPOINT_PROPOSALS_TABLE } from "../schema/control/endpoint-proposals.js";
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

/**
 * The migration that creates the SEC-15 access audit (task 069).
 *
 * 0004 rather than 0003 because task 066 took that number for the per-environment closed
 * state. The number is `db:generate`'s and is hard-coded nowhere else.
 */
const AUDIT_MIGRATION = fileURLToPath(
  new URL("../../migrations/0004_access_audit.sql", import.meta.url),
);

/** The migration that creates the pending `prod` endpoint change (task 070, Q30, Q51). */
const PROPOSALS_MIGRATION = fileURLToPath(
  new URL("../../migrations/0005_two_person_rule.sql", import.meta.url),
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

describe("the pending `prod` endpoint change's grants (task 070, Q30 with Q51)", () => {
  const sql = readFileSync(PROPOSALS_MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantControlTableStatements(ENDPOINT_PROPOSALS_TABLE);
    // **One**, and the count is the decision: the control role's DML, and no loop over the
    // environment roles, because this table is not on their read list.
    expect(statements).toHaveLength(1);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("gives no environment role any privilege at all", () => {
    // The property the control plane's split buys here: the credential that serves
    // anonymous respondent traffic cannot read a proposed production URL and cannot write
    // one. Proposing and confirming are an administrator's acts on configuration, so they
    // run on the control pool - exactly as minting a secure link does while redeeming one
    // does not (Q53).
    expect(CONTROL_READ_TABLES).not.toContain(ENDPOINT_PROPOSALS_TABLE);
    expect(sql).not.toContain("FROM control.environments AS environment");
    expect(sql).not.toContain(`ON "control"."${ENDPOINT_PROPOSALS_TABLE}" TO %I`);
    expect(grantEnvironmentStatements("staging").join("\n")).not.toContain(
      ENDPOINT_PROPOSALS_TABLE,
    );
  });

  it("carries no append-only trigger, unlike `form_releases`", () => {
    // These rows have a lifecycle and are updated in place; the append-only record of what
    // happened is the SEC-15 audit, which no application role may UPDATE or DELETE.
    expect(sql).not.toContain("CREATE TRIGGER");
  });

  it("refuses a self-confirmation at the database as well as in the handler", () => {
    // The one rule the whole mechanism exists for, written at every layer that could
    // enforce it: a CHECK here, a predicate in `confirmEndpointProposal`, and a refusal
    // with a message in the handler.
    expect(sql).toContain('CONSTRAINT "webhook_endpoint_proposals_second_account"');
    // The predicate is `applied_at is null`, not `confirmed_at is null`: a confirmation
    // whose endpoint write did not land can still be resumed, so it keeps the endpoint
    // claimed and a second proposal cannot be applied beside it.
    expect(sql).toContain('CREATE UNIQUE INDEX "webhook_endpoint_proposals_one_open"');
    expect(sql).toContain("WHERE applied_at is null and withdrawn_at is null");
  });

  it("records the publishing account the release rule compares against (Q51)", () => {
    // `form_versions` is append-only, so a column added to it can never be filled in for
    // the rows written before this migration - which is why the release rule refuses a
    // `prod` release of such a version while the switch is on rather than waving it through.
    expect(sql).toContain('ALTER TABLE "control"."form_versions" ADD COLUMN "published_by" text');
  });
});
