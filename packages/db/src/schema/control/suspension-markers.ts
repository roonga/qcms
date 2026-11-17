import { sql } from "drizzle-orm";
import { index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

export const SUSPENSION_MARKERS_TABLE = "suspension_markers";

/**
 * Who owes a re-confirmation for an account's response access after a reset or a
 * reactivation. A row with `team_id` names one access group and outlives the membership, so
 * a removal and re-add never lifts it; a row without names the account's run, during which a
 * response grant by its performer or the account itself is written suspended. No foreign
 * key: a marker must survive the membership and the group it names.
 */
export const suspensionMarkers = controlSchema.table(
  SUSPENSION_MARKERS_TABLE,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    teamId: text("team_id"),
    performedBy: text("performed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    liftedAt: timestamp("lifted_at", { withTimezone: true, mode: "date" }),
    liftedBy: text("lifted_by"),
  },
  (t) => [
    uniqueIndex("suspension_markers_one_open")
      .on(t.userId, sql`coalesce(${t.teamId}, '')`, t.performedBy)
      .where(sql`lifted_at is null`),
    index("suspension_markers_user_idx").on(t.userId),
  ],
);
