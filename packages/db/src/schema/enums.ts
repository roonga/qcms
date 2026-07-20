import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Domain enums, mirrored from the state machines in `DOMAIN_SCHEMA.md` §4.
 * Postgres enforces the closed set; the kernel owns the transitions.
 */

/** Question version lifecycle (`DOMAIN_SCHEMA.md` §4.2). */
export const questionStatus = pgEnum("question_status", ["draft", "published", "deprecated"]);

/** How a respondent reached a session (`ARCHITECTURE.md` §7; secure links = SEC-2). */
export const accessMode = pgEnum("access_mode", ["anonymous", "secure_link"]);

/** Respondent session lifecycle (`DOMAIN_SCHEMA.md` §4.3, ADR-07). */
export const sessionStatus = pgEnum("session_status", [
  "created",
  "in_progress",
  "submitted",
  "expired",
]);
