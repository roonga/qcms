import { controlSchema } from "../schemas.js";

/**
 * Domain enums, mirrored from the state machines in `DOMAIN_SCHEMA.md` §4.
 * Postgres enforces the closed set; the kernel owns the transitions.
 */

/** Question version lifecycle (`DOMAIN_SCHEMA.md` §4.2). */
export const questionStatus = controlSchema.enum("question_status", [
  "draft",
  "published",
  "deprecated",
]);

/**
 * **`form_status` is gone, since task 066** (Q18). The closed state is per
 * (form, environment) and is the `closed` flag on `control.form_releases`, read as the
 * newest row for the pair; nothing stores a whole-form status any more, so there is no
 * vocabulary left for an enum to close. `FormStatus` in `queries/forms.ts` is now a
 * derived union of the two readings a screen renders, and `DOMAIN_SCHEMA.md` §4.1
 * records the state machine as per-environment.
 */

/** How a respondent reached a session (`ARCHITECTURE.md` §7; secure links = SEC-2). */
export const accessMode = controlSchema.enum("access_mode", ["anonymous", "secure_link"]);

/** Respondent session lifecycle (`DOMAIN_SCHEMA.md` §4.3, ADR-07). */
export const sessionStatus = controlSchema.enum("session_status", [
  "created",
  "in_progress",
  "submitted",
  "expired",
]);
