import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Domain enums, mirrored from the state machines in `DOMAIN_SCHEMA.md` §4.
 * Postgres enforces the closed set; the kernel owns the transitions.
 */

/** Question version lifecycle (`DOMAIN_SCHEMA.md` §4.2). */
export const questionStatus = pgEnum("question_status", ["draft", "published", "deprecated"]);

/**
 * Form lifecycle status (`DOMAIN_SCHEMA.md` §4.1). `open` accepts new sessions;
 * `closed` is "closed to new sessions" — in-flight sessions still finish on the
 * version they started (R1). Reopening happens via a new draft/version. This is
 * a single-field state (not a cross-row invariant), so the transition is a plain
 * query helper, not a kernel concern (R5).
 */
export const formStatus = pgEnum("form_status", ["open", "closed"]);

/** How a respondent reached a session (`ARCHITECTURE.md` §7; secure links = SEC-2). */
export const accessMode = pgEnum("access_mode", ["anonymous", "secure_link"]);

/** Respondent session lifecycle (`DOMAIN_SCHEMA.md` §4.3, ADR-07). */
export const sessionStatus = pgEnum("session_status", [
  "created",
  "in_progress",
  "submitted",
  "expired",
]);
