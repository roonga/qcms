import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CONTROL_TABLE_NAMES } from "../schema/control/index.js";
import { DATA_PLANE_TABLE_NAMES } from "../schema/data/index.js";

import { environmentObjectNames } from "./sql.js";

/**
 * The per-environment set, pinned as arithmetic rather than believed.
 *
 * ## Why a number is written down here, when the whole design says not to
 *
 * `environmentObjectNames` derives the set from the data-plane schema module, and
 * `migrations.test.ts` compares that derivation against what the database actually
 * holds. Both are real checks, and **together they prove nothing about completeness**,
 * because they share a source: a guard dropped from the schema module disappears from
 * the expectation and from the database in the same commit, and every assertion still
 * passes.
 *
 * That is not hypothetical. Deriving the set for this task found that
 * `answers_retraction_value` had been in the database since migration 0009 and had
 * **never** been declared on the Drizzle table. Under the old hand-appended chain that
 * cost nothing. Under ADR-40 it would have cost the guard outright in every
 * environment, silently, because the generator emits from the module.
 *
 * So the totals are pinned, with the derivation written out beside them. Changing one
 * is then a deliberate edit somebody has to justify in a diff, which is the property a
 * self-consistent derivation cannot have. The figures below are **this lane's
 * derivation from the chain as it stood at its base**, not a number copied from a
 * document; where they disagree with a document, the document's figure is what gets
 * corrected.
 *
 * ## The derivation, object by object
 *
 * Grep the superseded migration SQL for each data-plane table name and take every
 * `CREATE TRIGGER`, `CONSTRAINT ... CHECK`, `CONSTRAINT ... UNIQUE` and `CREATE INDEX`
 * that names it:
 *
 *   - **triggers, 2**: `answers_reject_update` (0001), `answers_reject_delete` (0004)
 *   - **CHECKs, 3**: `answers_retraction_value` (0009),
 *     `webhook_deliveries_snippet_requires_attempt` (0015),
 *     `outbox_redacted_payload_has_no_answers` (0016)
 *   - **UNIQUE, 1**: `webhook_deliveries_event_webhook_uq` (0007)
 *   - **indexes, 6**: `sessions_status_expires_at_idx`,
 *     `answers_session_question_answered_at_idx`, `outbox_delivery_idx` (all 0000),
 *     `webhook_deliveries_due_idx` (0007), `outbox_payload_retention_idx`,
 *     `webhook_deliveries_snippet_retention_idx` (both 0018)
 *
 * That is **twelve**, plus Q46's `sessions_environment_matches`, which is **thirteen**.
 * The control-plane guards of the same chain - `question_versions_version_positive`,
 * `form_versions_version_positive`, `questions_slug_unique`, `session_token_unique`,
 * `user_email_unique`, `question_versions_freeze_published` and
 * `form_versions_reject_update` - are one copy each and are not in this set.
 *
 * Foreign keys declared **on** a data-plane table: four in-plane
 * (`answers_session_id_sessions_session_id_fk`,
 * `submissions_session_id_sessions_session_id_fk`,
 * `webhook_deliveries_outbox_id_outbox_id_fk`,
 * `webhook_deliveries_webhook_id_webhooks_webhook_id_fk`) and three crossing into
 * `control` (`sessions_form_version_fk`; the link key, now composite on
 * `(link_id, environment)` and renamed `sessions_secure_link_fk` by Q46;
 * `webhooks_form_id_forms_form_id_fk`). That is **seven**.
 *
 * ## Against the figures in the plan and in ADR-40
 *
 * Both state **eight** tables, **seventeen** guards and **eight** foreign keys. Those
 * are the reconciled totals **with task 072's `answer_group_instances`** included - one
 * table, two triggers, one CHECK, one index and one foreign key. 072 has not merged, so
 * it is not on the chain this lane rebases onto yet, and Q50 says this task rebases
 * after it. **At that rebase the figures below become 8, 17 and 8** and this comment
 * gets the roster's five names added to the derivation above. Nothing else changes: the
 * generator emits whatever the data-plane module holds.
 */
const PER_ENVIRONMENT = {
  tables: 7,
  guards: 13,
  inPlaneForeignKeys: 4,
  crossingForeignKeys: 3,
} as const;

describe("the per-environment set", () => {
  const names = environmentObjectNames("test");

  it("is the size the derivation says", () => {
    expect(names.tables).toHaveLength(PER_ENVIRONMENT.tables);
    expect(names.guards).toHaveLength(PER_ENVIRONMENT.guards);
    expect(names.inPlaneForeignKeys).toHaveLength(PER_ENVIRONMENT.inPlaneForeignKeys);
    expect(names.crossingForeignKeys).toHaveLength(PER_ENVIRONMENT.crossingForeignKeys);
    expect(names.foreignKeys).toHaveLength(
      PER_ENVIRONMENT.inPlaneForeignKeys + PER_ENVIRONMENT.crossingForeignKeys,
    );
  });

  it("names every object once", () => {
    // A duplicate would make a count right for the wrong reason and would collide in
    // Postgres, where an index name is unique per schema.
    expect(new Set(names.guards).size).toBe(names.guards.length);
    expect(new Set(names.foreignKeys).size).toBe(names.foreignKeys.length);
  });

  it("derives every name from the environment it was asked for", () => {
    const prod = environmentObjectNames("prod");
    expect(prod.schema).toBe("data_prod");
    expect(prod.reportingSchema).toBe("reporting_prod");
    expect(prod.role).toBe("qcms_app_prod");
  });
});

describe("the two planes stay disjoint (criterion 3a)", () => {
  it("shares no table name between the control module and the data-plane module", () => {
    // The search path is `data_<env>, control` with the data plane FIRST, so a name in
    // both would resolve to the environment's copy with no error, no warning and a
    // control-plane read that quietly became a per-environment one. This is the cheap
    // in-process half; `scripts/check-schema-disjoint.mjs` runs the same intersection in
    // `check:all` without a container, and `migrations.test.ts` runs it against the
    // database the migration built.
    const control = new Set(CONTROL_TABLE_NAMES);
    const shared = DATA_PLANE_TABLE_NAMES.filter((name) => control.has(name));
    expect(shared).toEqual([]);
  });
});

/**
 * The one helper allowed to name a data-plane schema (criterion 3, resolution half).
 *
 * Every other helper reaches the data plane by an **unqualified** name, so the
 * connection's `search_path` decides which environment it touches and no helper can
 * name an environment it was not handed a pool for. The exception is the outbox insert
 * that runs on the **control** pool: that pool's search path is `control` alone, so an
 * unqualified `outbox` resolves to nothing there, and the one grant `qcms_app_control`
 * holds in a data schema is `INSERT` on `outbox` (Q49).
 *
 * Named, rather than matched by a loose pattern: an allowance shaped like
 * "any line mentioning a schema" would let the next one through unnoticed.
 */
const SCHEMA_QUALIFYING_HELPERS = ["outbox.ts"];

describe("no query helper emits a schema-qualified data-plane name", () => {
  const QUERIES_DIR = fileURLToPath(new URL("../queries/", import.meta.url));

  it("names no `data_` schema outside the one helper that must", () => {
    const offenders = readdirSync(QUERIES_DIR)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => !SCHEMA_QUALIFYING_HELPERS.includes(name))
      .filter((name) => /\bdata_/.test(readFileSync(`${QUERIES_DIR}${name}`, "utf8")));
    expect(offenders).toEqual([]);
  });
});
