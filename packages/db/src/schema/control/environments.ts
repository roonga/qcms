import { bigint, integer, text, timestamp } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/**
 * The live environment set. Rows are written only by the operator command under the
 * migration role, never over HTTP, because creating a schema is DDL and no application
 * role holds any (SEC-10). An environment's credential is deliberately not here: it
 * arrives through the typed configuration and is never echoed (SEC-8).
 */
export const environments = controlSchema.table("environments", {
  /**
   * Also the `data_<env>`, `reporting_<env>` and `qcms_app_<env>` suffix and the `/<env>/`
   * address prefix. The pattern and length rules are enforced by the operator command
   * rather than by a CHECK, because the refusal has to name the derived identifier.
   */
  name: text("name").primaryKey(),
  /**
   * The canonical order a set of environments is written in, so `dev-test` and `test-dev`
   * cannot be two spellings of one access-group name.
   */
  position: integer("position").notNull().unique(),
  /** `NULL` to use the installation-wide typed value. */
  challengeProvider: text("challenge_provider"),
  /** `NULL` for `QCMS_DELIVERY_SNIPPET_TTL_MS`. */
  deliverySnippetTtlMs: bigint("delivery_snippet_ttl_ms", { mode: "number" }),
  /** `NULL` for `QCMS_OUTBOX_PAYLOAD_TTL_MS`. */
  outboxPayloadTtlMs: bigint("outbox_payload_ttl_ms", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
