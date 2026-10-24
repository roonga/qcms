import { boolean, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/**
 * One row per `qcms:reset-2fa` invocation that ran (SEC-1, SEC-10), written only by that
 * command as the migration role. No foreign key to `user`, so the record survives the
 * account it describes. A row is written even when there was nothing to clear, so a
 * mistargeted run is still visible.
 */
export const twoFactorResets = controlSchema.table("two_factor_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  email: text("email").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  /** `current_user` at the moment of the reset - the whole guard, recorded. */
  databaseRole: text("database_role").notNull(),
  clearedFactors: integer("cleared_factors").notNull(),
  wasEnrolled: boolean("was_enrolled").notNull(),
});
