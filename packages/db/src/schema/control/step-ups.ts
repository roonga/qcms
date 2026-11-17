import { integer, text, timestamp } from "drizzle-orm/pg-core";

import { authSession } from "./auth.js";

import { controlSchema } from "../schemas.js";

/** How long a step-up stays valid. */
export const STEP_UP_TTL_MS = 5 * 60 * 1000;

/** Failed attempts after which a session can no longer step up. */
export const STEP_UP_MAX_FAILURES = 5;

export const STEP_UPS_TABLE = "step_ups";

/**
 * A password and second-factor re-check, bound to one session: it dies with the session row, so
 * a step-up never authorises an act from any other session.
 */
export const stepUps = controlSchema.table(STEP_UPS_TABLE, {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => authSession.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
});
