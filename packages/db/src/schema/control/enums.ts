import { controlSchema } from "../schemas.js";

/** Postgres enforces the closed set; the kernel owns the transitions. */

/** Question version lifecycle. */
export const questionStatus = controlSchema.enum("question_status", [
  "draft",
  "published",
  "deprecated",
]);

/** How a respondent reached a session (secure links = SEC-2). */
export const accessMode = controlSchema.enum("access_mode", ["anonymous", "secure_link"]);

/** Respondent session lifecycle. */
export const sessionStatus = controlSchema.enum("session_status", [
  "created",
  "in_progress",
  "submitted",
  "expired",
]);
