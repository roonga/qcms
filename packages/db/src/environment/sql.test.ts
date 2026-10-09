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
 * that names it. Against the chain this task replaces, which is every migration up to
 * and including task 075's reporting rework:
 *
 *   - **triggers, 4**: `answers_reject_update`, `answers_reject_delete`,
 *     `answer_group_instances_reject_update`, `answer_group_instances_reject_delete`
 *     (the last two are task 072's)
 *   - **CHECKs, 4**: `answers_retraction_value`,
 *     `webhook_deliveries_snippet_requires_attempt`,
 *     `outbox_redacted_payload_has_no_answers`, `answer_group_instances_event` (072's)
 *   - **UNIQUE, 1**: `webhook_deliveries_event_webhook_uq`
 *   - **indexes, 7**: `sessions_status_expires_at_idx`,
 *     `answers_session_question_answered_at_idx`, `outbox_delivery_idx`,
 *     `webhook_deliveries_due_idx`, `outbox_payload_retention_idx`,
 *     `webhook_deliveries_snippet_retention_idx`,
 *     `answer_group_instances_session_group_occurred_at_idx` (072's)
 *
 * That is **sixteen**, plus Q46's `sessions_environment_matches`, which is
 * **seventeen**. The control-plane guards of the same chain are one copy each and are
 * not in this set.
 *
 * Foreign keys declared **on** a data-plane table: **five** in-plane
 * (`answers_session_id_sessions_session_id_fk`,
 * `answer_group_instances_session_id_sessions_session_id_fk`,
 * `submissions_session_id_sessions_session_id_fk`,
 * `webhook_deliveries_outbox_id_outbox_id_fk`,
 * `webhook_deliveries_webhook_id_webhooks_webhook_id_fk`) and **three** crossing into
 * `control` (`sessions_form_version_fk`; the link key, composite on
 * `(link_id, environment)` and renamed `sessions_secure_link_fk` by Q46;
 * `webhooks_form_id_forms_form_id_fk`). That is **eight**.
 *
 * ## Against the figures in the plan and in ADR-40
 *
 * They agree. Both state **eight** data-plane tables, **seventeen** guards and
 * **eight** foreign keys, which is **twenty-five** objects counted as guards plus
 * foreign keys, and that is what the derivation above reaches now that tasks 072, 073
 * and 075 have merged and Q50's landing order is satisfied.
 *
 * **Three things that moved under this task and changed none of these numbers.** Task
 * 073's `op_token` is a nullable column on the roster and is deliberately unconstrained
 * in the database, because the invariant it serves is cross-row and is held in the API
 * inside the session's advisory lock; task 075 reshaped both reporting views and added
 * no table, guard or foreign key, views being counted nowhere in this set; and task
 * 061's `mustChangePassword` is a control-plane column, one copy, outside it.
 */
const PER_ENVIRONMENT = {
  tables: 8,
  guards: 17,
  inPlaneForeignKeys: 5,
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

/**
 * Strip comments before looking for a schema name.
 *
 * Several helpers **explain** the layout in their headers - `data_<env>`, `search_path`,
 * why an unqualified name is the right one - and a check that could not tell the
 * explanation from the statement would fail on the prose that documents its own rule.
 * The first version of this assertion did exactly that.
 */
function withoutComments(source: string): string {
  // `[^*]*\*+(?:[^/*][^*]*\*+)*` is the standard non-backtracking block-comment body:
  // a lazy `[\s\S]*?` reads the same and is super-linear on a file with many comments,
  // which every file here is.
  return source.replaceAll(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "").replaceAll(/\/\/[^\n]*/g, "");
}

describe("no query helper emits a schema-qualified data-plane name", () => {
  const QUERIES_DIR = fileURLToPath(new URL("../queries/", import.meta.url));

  it("names no `data_` schema outside the one helper that must", () => {
    const offenders = readdirSync(QUERIES_DIR)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => !SCHEMA_QUALIFYING_HELPERS.includes(name))
      .filter((name) =>
        /\bdata_/.test(withoutComments(readFileSync(`${QUERIES_DIR}${name}`, "utf8"))),
      );
    expect(offenders).toEqual([]);
  });
});
