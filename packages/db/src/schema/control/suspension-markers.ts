import { sql } from "drizzle-orm";
import { index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

export const SUSPENSION_MARKERS_TABLE = "suspension_markers";

/**
 * Who owes a re-confirmation after a reset or reactivation. A row with `team_id` outlives the
 * membership it names; one without is the account's run. No foreign key, so a marker
 * survives both the membership and the group.
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
