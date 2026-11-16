import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCESS_AUDIT_KINDS, ACCESS_AUDIT_TABLE } from "../schema/control/access-audit.js";
import {
  SITE_AUDIT_KIND_CHECK,
  SITE_AUDIT_KINDS,
  SITE_AUDIT_TABLE,
} from "../schema/control/site-audit.js";
import {
  SIGN_IN_LINK_DELIVERIES,
  SIGN_IN_LINK_DELIVERY_CHECK,
  SIGN_IN_LINK_PURPOSE_CHECK,
  SIGN_IN_LINK_PURPOSES,
  SIGN_IN_LINKS_TABLE,
} from "../schema/control/sign-in-links.js";
import { AGENT_ACTIONS_STEP_UNIQUE, AGENT_ACTIONS_TABLE } from "../schema/control/agent-actions.js";
import { ENDPOINT_PROPOSALS_TABLE } from "../schema/control/endpoint-proposals.js";
import { RELEASE_BATCHES_TABLE } from "../schema/control/release-batches.js";
import {
  RELEASE_WORKFLOW_REVISIONS_TABLE,
  RELEASE_WORKFLOW_RULES_TABLE,
} from "../schema/control/release-workflow.js";
import { APPEARANCE_CORNERS } from "@roonga/qcms-core";

import {
  APPEARANCE_LOGOS_DIGEST_CHECK,
  APPEARANCE_LOGOS_TABLE,
  APPEARANCE_LOGO_TAKEDOWN_FUNCTION,
  APPEARANCE_LOGO_TAKEDOWN_SETTING,
  APPEARANCE_LOGO_TOMBSTONES_TABLE,
  APPEARANCE_LOGOS_TAKEN_DOWN,
  LOGO_CONTENT_TYPES,
  LOGO_MAX_BYTES,
  WORKSPACE_THEMES_TABLE,
} from "../schema/control/workspace-themes.js";

const LOGO_COLUMN_GRANT = `GRANT SELECT ("key", "content_type", "bytes") ON "control"."${APPEARANCE_LOGOS_TABLE}"`;
import {
  CONTROL_READ_COLUMNS,
  CONTROL_READ_TABLES,
  grantAccessAuditStatements,
  grantAgentActionsStatements,
  grantAppearanceLogoTakedownStatements,
  grantAppearanceLogosStatements,
  grantControlTableStatements,
  grantEnvironmentStatements,
  grantSiteAuditStatements,
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

const WORKFLOW_MIGRATION = fileURLToPath(
  new URL("../../migrations/0006_release_workflow.sql", import.meta.url),
);

const AGENT_MIGRATION = fileURLToPath(
  new URL("../../migrations/0007_agent_actions.sql", import.meta.url),
);

const APPEARANCE_MIGRATION = fileURLToPath(
  new URL("../../migrations/0010_appearance_and_workspace_themes.sql", import.meta.url),
);

const SITE_AUDIT_MIGRATION = fileURLToPath(
  new URL("../../migrations/0011_account_state_and_site_audit.sql", import.meta.url),
);

const TAKEDOWN_MIGRATION = fileURLToPath(
  new URL("../../migrations/0012_appearance_logo_takedown.sql", import.meta.url),
);

const SIGN_IN_LINKS_MIGRATION = fileURLToPath(
  new URL("../../migrations/0013_sign_in_links.sql", import.meta.url),
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
    // Only the migration role may alter audit rows; an unconditional append-only trigger would refuse that
    // allowed maintenance too.
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
    // These rows update in place; their append-only history lives in the separate audit table.
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

describe("the release-workflow and confirmation tables' grants (Q85, Q89)", () => {
  const sql = readFileSync(WORKFLOW_MIGRATION, "utf8");
  const tables = [
    RELEASE_WORKFLOW_REVISIONS_TABLE,
    RELEASE_WORKFLOW_RULES_TABLE,
    RELEASE_BATCHES_TABLE,
  ];

  it("are exactly the statements the generator emits, verbatim", () => {
    for (const table of tables) {
      const statements = grantControlTableStatements(table);
      expect(statements, table).toHaveLength(1);
      for (const statement of statements) expect(sql).toContain(statement);
    }
  });

  it("gives no environment role any privilege at all on any of the three", () => {
    for (const table of tables) {
      expect(CONTROL_READ_TABLES).not.toContain(table);
      expect(sql).not.toContain(`ON "control"."${table}" TO %I`);
      expect(grantEnvironmentStatements("staging").join("\n")).not.toContain(table);
    }
    expect(sql).not.toContain("FROM control.environments AS environment");
  });

  it("makes both workflow tables append-only and leaves the replay cache sweepable", () => {
    for (const table of [RELEASE_WORKFLOW_REVISIONS_TABLE, RELEASE_WORKFLOW_RULES_TABLE]) {
      expect(sql).toContain(`CREATE TRIGGER "${table}_reject_update"`);
      expect(sql).toContain(`CREATE TRIGGER "${table}_reject_delete"`);
    }
    expect(sql).not.toContain(`CREATE TRIGGER "${RELEASE_BATCHES_TABLE}_reject_delete"`);
  });

  it("adds the draft revision a confirmation rechecks (F2)", () => {
    expect(sql).toContain(
      'ALTER TABLE "control"."form_drafts" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL',
    );
  });
});

describe("the SEC-17 agent audit's grants (Q12)", () => {
  const sql = readFileSync(AGENT_MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantAgentActionsStatements();
    expect(statements).toHaveLength(3);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("is the access audit's grant set with one table name changed and nothing else", () => {
    const mirrored = grantAccessAuditStatements().map((statement) =>
      statement.replaceAll(ACCESS_AUDIT_TABLE, AGENT_ACTIONS_TABLE),
    );
    expect(grantAgentActionsStatements()).toEqual(mirrored);
  });

  it("carries the per-step single-use constraint and no foreign key", () => {
    expect(sql).toContain(
      `CONSTRAINT "${AGENT_ACTIONS_STEP_UNIQUE}" UNIQUE("proposal_id","step_index")`,
    );
    expect(sql).not.toContain("REFERENCES");
  });

  it("grants an environment created later the same INSERT and no SELECT", () => {
    const later = grantEnvironmentStatements("staging").join("\n");
    expect(later).toContain(
      `GRANT INSERT ON "control"."${AGENT_ACTIONS_TABLE}" TO "qcms_app_staging"`,
    );
    expect(later).not.toContain(`GRANT SELECT ON "control"."${AGENT_ACTIONS_TABLE}"`);
  });
});

describe("the site audit's grants (criterion 112)", () => {
  const sql = readFileSync(SITE_AUDIT_MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantSiteAuditStatements();
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("gives the control role SELECT and INSERT and neither of the other two", () => {
    expect(sql).toContain(
      `GRANT SELECT, INSERT ON "control"."${SITE_AUDIT_TABLE}" TO "qcms_app_control"`,
    );
    expect(sql).not.toContain(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "control"."${SITE_AUDIT_TABLE}"`,
    );
  });

  it("grants no environment role anything, now or for one created later", () => {
    expect(sql).not.toContain(`ON "control"."${SITE_AUDIT_TABLE}" TO %I`);
    const later = grantEnvironmentStatements("staging").join("\n");
    expect(later).not.toContain(`"control"."${SITE_AUDIT_TABLE}"`);
  });

  it("revokes UPDATE and DELETE from every `qcms_app%` role, by prefix", () => {
    expect(sql).toContain("WHERE rolname LIKE 'qcms\\_app%'");
    expect(sql).toContain(`REVOKE UPDATE, DELETE ON TABLE control.${SITE_AUDIT_TABLE} FROM %I`);
  });

  it("carries no trigger and no foreign key, both deliberately", () => {
    expect(sql).not.toContain("CREATE TRIGGER");
    expect(sql).not.toContain("FOREIGN KEY");
  });

  it("pins the site kinds it shipped with and the access audit's eleven at the database", () => {
    expect(sql).toContain(`CONSTRAINT "${SITE_AUDIT_KIND_CHECK}"`);
    // The fifth kind, `logo`, arrives with the takedown in 0012 and is asserted there.
    for (const kind of SITE_AUDIT_KINDS.filter((name) => name !== "logo")) {
      expect(sql).toContain(`'${kind}'`);
    }
    for (const kind of ACCESS_AUDIT_KINDS) expect(sql).toContain(`'${kind}'`);
  });
});

describe("the logo takedown's function and the fifth site audit kind", () => {
  const sql = readFileSync(TAKEDOWN_MIGRATION, "utf8");

  it("are exactly the statements the generator emits, verbatim", () => {
    const statements = grantAppearanceLogoTakedownStatements();
    expect(statements).toHaveLength(3);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("takes every privilege on the tombstones back from the application roles", () => {
    expect(grantAppearanceLogoTakedownStatements().join("\n")).toContain(
      `REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE control.${APPEARANCE_LOGO_TOMBSTONES_TABLE} FROM %I`,
    );
  });

  it("takes EXECUTE back from PUBLIC before giving it to the control role alone", () => {
    const revoked = sql.indexOf(`REVOKE ALL ON FUNCTION ${APPEARANCE_LOGO_TAKEDOWN_FUNCTION}`);
    const granted = sql.indexOf(`GRANT EXECUTE ON FUNCTION ${APPEARANCE_LOGO_TAKEDOWN_FUNCTION}`);
    expect(revoked).toBeGreaterThan(-1);
    expect(granted).toBeGreaterThan(revoked);
    expect(sql).not.toContain("TO %I");
  });

  it("gives no application role DELETE on the store the function deletes from", () => {
    expect(sql).not.toContain(`GRANT DELETE ON "control"."${APPEARANCE_LOGOS_TABLE}"`);
    expect(sql).not.toContain(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "control"."${APPEARANCE_LOGOS_TABLE}"`,
    );
  });

  it("keeps the UPDATE rejection and gates the delete on the flag and the table owner", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain(APPEARANCE_LOGO_TAKEDOWN_SETTING);
    expect(sql).toContain(
      "SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c",
    );
    expect(sql).not.toMatch(/FROM pg_class\b/);
    expect(sql).not.toContain("PG_CONTEXT");
    expect(sql).not.toContain(`DROP TRIGGER "${APPEARANCE_LOGOS_TABLE}_reject_update"`);
  });

  it("records the digest and refuses it on insert, under the name the API maps", () => {
    expect(sql).toContain(`CREATE TABLE "control"."${APPEARANCE_LOGO_TOMBSTONES_TABLE}"`);
    expect(sql).toContain(`INSERT INTO control.${APPEARANCE_LOGO_TOMBSTONES_TABLE}`);
    expect(sql).toContain(`CONSTRAINT = '${APPEARANCE_LOGOS_TAKEN_DOWN}'`);
    expect(sql).not.toContain(`ON "control"."${APPEARANCE_LOGO_TOMBSTONES_TABLE}" TO`);
  });

  it("pins the fifth site audit kind at the database", () => {
    expect(sql).toContain(`CONSTRAINT "${SITE_AUDIT_KIND_CHECK}"`);
    for (const kind of SITE_AUDIT_KINDS) expect(sql).toContain(`'${kind}'`);
  });
});

describe("the appearance tables' grants (D1, D2)", () => {
  const sql = readFileSync(APPEARANCE_MIGRATION, "utf8");

  it("are exactly the statements the generators emit, verbatim", () => {
    const statements = [
      ...grantAppearanceLogosStatements(),
      ...grantControlTableStatements(WORKSPACE_THEMES_TABLE),
    ];
    expect(statements).toHaveLength(4);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("leaves the logo store append-only: SELECT and INSERT, never UPDATE or DELETE", () => {
    expect(sql).toContain(
      `GRANT SELECT, INSERT ON "control"."${APPEARANCE_LOGOS_TABLE}" TO "qcms_app_control"`,
    );
    expect(sql).not.toContain(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "control"."${APPEARANCE_LOGOS_TABLE}"`,
    );
    expect(sql).toContain("WHERE rolname LIKE 'qcms\\_app%'");
    expect(sql).toContain(
      `REVOKE UPDATE, DELETE ON TABLE control.${APPEARANCE_LOGOS_TABLE} FROM %I`,
    );
  });

  it("gives every environment role three COLUMNS of the logo store, never the table", () => {
    // The serving pool reads the bytes it answers with; `created_by` and `created_at`
    // are not on its read list at all.
    expect(CONTROL_READ_TABLES).not.toContain(APPEARANCE_LOGOS_TABLE);
    expect(CONTROL_READ_COLUMNS[APPEARANCE_LOGOS_TABLE]).toEqual(["key", "content_type", "bytes"]);
    expect(sql).toContain(`${LOGO_COLUMN_GRANT} TO %I`);
    expect(sql).not.toContain(`GRANT SELECT ON "control"."${APPEARANCE_LOGOS_TABLE}"`);
    const later = grantEnvironmentStatements("staging").join("\n");
    expect(later).toContain(`${LOGO_COLUMN_GRANT} TO "qcms_app_staging"`);
    expect(later).not.toContain(`GRANT SELECT ON "control"."${APPEARANCE_LOGOS_TABLE}"`);
    expect(later).toContain(`tablename = '${APPEARANCE_LOGOS_TABLE}'`);
  });

  it("gives every environment role nothing at all on the themes", () => {
    expect(CONTROL_READ_TABLES).not.toContain(WORKSPACE_THEMES_TABLE);
    expect(CONTROL_READ_COLUMNS[WORKSPACE_THEMES_TABLE]).toBeUndefined();
    expect(sql).not.toContain(`ON "control"."${WORKSPACE_THEMES_TABLE}" TO %I`);
    expect(grantEnvironmentStatements("staging").join("\n")).not.toContain(WORKSPACE_THEMES_TABLE);
  });

  it("adds the appearance columns and the workspace lock the draft save path reads", () => {
    expect(sql).toContain('ALTER TABLE "control"."form_drafts" ADD COLUMN "appearance" jsonb');
    expect(sql).toContain('ALTER TABLE "control"."form_versions" ADD COLUMN "appearance" jsonb');
    expect(sql).toContain(
      'ALTER TABLE "control"."organization" ADD COLUMN "appearanceLocked" boolean DEFAULT false NOT NULL',
    );
    expect(sql).toContain('"page_tint" boolean DEFAULT false NOT NULL');
  });

  it("makes the logo key the content address at the database, not a caller's promise", () => {
    expect(sql).toContain(
      `CONSTRAINT "${APPEARANCE_LOGOS_DIGEST_CHECK}" CHECK ("control"."${APPEARANCE_LOGOS_TABLE}"."key" = encode(sha256("control"."${APPEARANCE_LOGOS_TABLE}"."bytes"), 'hex'))`,
    );
  });

  it("holds the logo store immutable against every role, not only the application ones", () => {
    expect(sql).toContain(`CREATE TRIGGER "${APPEARANCE_LOGOS_TABLE}_reject_update"`);
    expect(sql).toContain(`CREATE TRIGGER "${APPEARANCE_LOGOS_TABLE}_reject_delete"`);
    // The themes are editable and deletable; it is the logo bytes a draft or a version
    // carries that may not move under them.
    expect(sql).not.toContain(`CREATE TRIGGER "${WORKSPACE_THEMES_TABLE}_reject_delete"`);
  });

  it("pins the hand-written SQL literals to the constants the application reads", () => {
    const list = (values: readonly string[]): string =>
      values.map((value) => `'${value}'`).join(", ");
    expect(sql).toContain(`in (${list(APPEARANCE_CORNERS)})`);
    expect(sql).toContain(`in (${list(LOGO_CONTENT_TYPES)})`);
    expect(sql).toContain(
      `octet_length("control"."${APPEARANCE_LOGOS_TABLE}"."bytes") <= ${LOGO_MAX_BYTES}`,
    );
  });

  it("needs no trigger on the appearance column: `form_versions` refuses every UPDATE", () => {
    const versions = readFileSync(
      fileURLToPath(new URL("../../migrations/0000_environments_baseline.sql", import.meta.url)),
      "utf8",
    );
    expect(versions).toContain('CREATE TRIGGER "form_versions_reject_update"');
  });
});

describe("the sign-in links' grants (task 090)", () => {
  const sql = readFileSync(SIGN_IN_LINKS_MIGRATION, "utf8");

  it("is exactly the statement the generator emits, verbatim", () => {
    const statements = grantControlTableStatements(SIGN_IN_LINKS_TABLE);
    expect(statements).toHaveLength(1);
    for (const statement of statements) expect(sql).toContain(statement);
  });

  it("gives every environment role nothing at all", () => {
    expect(CONTROL_READ_TABLES).not.toContain(SIGN_IN_LINKS_TABLE);
    expect(CONTROL_READ_COLUMNS[SIGN_IN_LINKS_TABLE]).toBeUndefined();
    expect(sql).not.toContain(`ON "control"."${SIGN_IN_LINKS_TABLE}" TO %I`);
    expect(grantEnvironmentStatements("staging").join(" ")).not.toContain(SIGN_IN_LINKS_TABLE);
  });

  it("stores the digest and no token, and pins both value sets at the database", () => {
    expect(sql).toContain('"token_hash" text NOT NULL');
    expect(sql).not.toMatch(/"token" text/);
    expect(sql).toContain(`CONSTRAINT "${SIGN_IN_LINK_PURPOSE_CHECK}"`);
    expect(sql).toContain(`CONSTRAINT "${SIGN_IN_LINK_DELIVERY_CHECK}"`);
    for (const purpose of SIGN_IN_LINK_PURPOSES) expect(sql).toContain(`'${purpose}'`);
    for (const delivery of SIGN_IN_LINK_DELIVERIES) expect(sql).toContain(`'${delivery}'`);
  });

  it("keeps the expiry and the used flag as columns a consume can compare and set", () => {
    expect(sql).toContain('"expires_at" timestamp with time zone NOT NULL');
    expect(sql).toContain('"used_at" timestamp with time zone');
    expect(sql).toContain('"invalidated_at" timestamp with time zone');
  });
});
