import { bigint, integer, text, timestamp } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/**
 * The live environment set (ADR-40, Q1).
 *
 * An environment is a **release state over the one immutable version history**, and
 * this table is the list of them. A fresh database is created with exactly two rows,
 * `test` and `prod`; further rows are written by the operator command that creates an
 * environment, under the migration role, never by an administrator and never over
 * HTTP, because creating a schema is DDL and no application role holds any (SEC-10).
 *
 * **This table is the source of the set, and `data_%` is a consistency check rather
 * than the source** (Q1, scenario finding 1). Every per-environment job, export,
 * backup, retention pass, reporting view and telemetry attribute enumerates these rows
 * rather than a compiled-in pair. The **credential** for an environment is not here: it
 * is a per-environment entry in the typed configuration (ADR-24), arriving through the
 * process environment, validated at boot and never echoed (SEC-8), because a credential
 * the database hands out is a credential the database can be made to hand out.
 *
 * Every application role holds `SELECT` here and nothing else: an environment pool has
 * to be able to read the set it belongs to, and no pool may write it.
 */
export const environments = controlSchema.table("environments", {
  /**
   * The environment's name, which is also its `data_<env>` suffix, its
   * `reporting_<env>` suffix, its `qcms_app_<env>` role suffix and its `/<env>/`
   * address prefix (Q21, Q23). Matches `^[a-z][a-z0-9]*$` and is length-checked
   * against the longest identifier derived from it (Q42); both rules are enforced by
   * the operator command rather than by a CHECK, because the refusal has to name the
   * derived identifier that would not fit.
   */
  name: text("name").primaryKey(),
  /**
   * The order the set is written in (Q42). A combined access-group name joins a set
   * of environments with hyphens, and `dev-test` and `test-dev` would otherwise both
   * parse while being two spellings of one grant, so the canonical order is the order
   * of the rows here. **Task 069 owns the normalisation and the refusal**; this column
   * is what it orders by, and it exists in this task because a foreign key cannot
   * reference a column a later task adds and neither can an ordering.
   */
  position: integer("position").notNull().unique(),
  /**
   * The per-environment challenge provider (Q11, ADR-24's amendment), or `NULL` to
   * use the installation-wide typed value. A test environment that asks a tester to
   * solve a visible challenge is a cost with no benefit.
   *
   * **Task 066 owns reading it.** This task creates the column so the operator command
   * has somewhere to put the value an operator passes it.
   */
  challengeProvider: text("challenge_provider"),
  /**
   * Per-environment override of `QCMS_DELIVERY_SNIPPET_TTL_MS`, or `NULL` for the
   * installation-wide value (Q11). **Task 067 owns reading it.**
   */
  deliverySnippetTtlMs: bigint("delivery_snippet_ttl_ms", { mode: "number" }),
  /**
   * Per-environment override of `QCMS_OUTBOX_PAYLOAD_TTL_MS`, or `NULL` for the
   * installation-wide value (Q11). **Task 067 owns reading it.**
   */
  outboxPayloadTtlMs: bigint("outbox_payload_ttl_ms", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
