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
 * A migration with a missing `GRANT` succeeds; what fails is a request, later, on a
 * deployment that has application roles.
 */
const MIGRATION = fileURLToPath(
  new URL("../../migrations/0001_form_releases.sql", import.meta.url),
);

const AUDIT_MIGRATION = fileURLToPath(
  new URL("../../migrations/0004_access_audit.sql", import.meta.url),
);

const PROPOSALS_MIGRATION = fileURLToPath(
  new URL("../../migrations/0005_two_person_rule.sql", import.meta.url),
);

describe("the `form_releases` grants", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantControlTableStatements("form_releases");
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("grants `SELECT` to every environment role in the live set, by enumeration", () => {
    expect(sql).toContain("FROM control.environments AS environment");
    expect(sql).toContain(`GRANT SELECT ON "control"."form_releases" TO %I`);
  });

  it("is a grant because `form_releases` is on the environment roles' read list", () => {
    expect(CONTROL_READ_TABLES).toContain("form_releases");
    expect(grantControlTableStatements("two_factor_resets")).toHaveLength(1);
  });

  it("makes the history append-only at the database (criterion 7)", () => {
    expect(sql).toContain('CREATE TRIGGER "form_releases_reject_update"');
    expect(sql).toContain('CREATE TRIGGER "form_releases_reject_delete"');
  });
});

describe("the SEC-15 access audit's grants and revokes (task 069, Q40 with Q56)", () => {
  const sql = readFileSync(AUDIT_MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantAccessAuditStatements();
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
    expect(sql).toContain("WHERE rolname LIKE 'qcms\\_app%'");
    expect(sql).toContain(`REVOKE UPDATE, DELETE ON TABLE control.${ACCESS_AUDIT_TABLE} FROM %I`);
  });

  it("carries no trigger and no foreign key, both deliberately", () => {
    // SEC-15: only `qcms_migrate` may alter an audit row, so a trigger would refuse the
    // one role allowed to.
    expect(sql).not.toContain("CREATE TRIGGER");
    expect(sql).not.toContain("FOREIGN KEY");
  });

  it("is owed twice, so the environment generator carries the same grant", () => {
    const generated = grantEnvironmentStatements("staging").join("\n");
    expect(generated).toContain(
      `GRANT INSERT ON "control"."${ACCESS_AUDIT_TABLE}" TO "qcms_app_staging"`,
    );
    // Guarded on the table existing: the baseline calls the generator before this
    // migration has run.
    expect(generated).toContain(`tablename = '${ACCESS_AUDIT_TABLE}'`);
  });
});

describe("the pending `prod` endpoint change's grants (task 070, Q30 with Q51)", () => {
  const sql = readFileSync(PROPOSALS_MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantControlTableStatements(ENDPOINT_PROPOSALS_TABLE);
    expect(statements).toHaveLength(1);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("gives no environment role any privilege at all", () => {
    // The credential serving anonymous respondent traffic must not reach a proposed
    // production URL.
    expect(CONTROL_READ_TABLES).not.toContain(ENDPOINT_PROPOSALS_TABLE);
    expect(sql).not.toContain("FROM control.environments AS environment");
    expect(sql).not.toContain(`ON "control"."${ENDPOINT_PROPOSALS_TABLE}" TO %I`);
    expect(grantEnvironmentStatements("staging").join("\n")).not.toContain(
      ENDPOINT_PROPOSALS_TABLE,
    );
  });

  it("carries no append-only trigger, unlike `form_releases`", () => {
    // These rows are updated in place; the append-only record is the SEC-15 audit.
    expect(sql).not.toContain("CREATE TRIGGER");
  });

  it("refuses a self-confirmation at the database as well as in the handler", () => {
    expect(sql).toContain('CONSTRAINT "webhook_endpoint_proposals_second_account"');
    // `applied_at`, not `confirmed_at`: a confirmation whose endpoint write did not land
    // can still be resumed, so it keeps the endpoint claimed.
    expect(sql).toContain('CREATE UNIQUE INDEX "webhook_endpoint_proposals_one_open"');
    expect(sql).toContain("WHERE applied_at is null and withdrawn_at is null");
  });

  it("records the publishing account the release rule compares against (Q51)", () => {
    expect(sql).toContain('ALTER TABLE "control"."form_versions" ADD COLUMN "published_by" text');
  });
});
