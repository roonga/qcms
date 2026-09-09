import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The break-glass audit trail: one row per `qcms:reset-2fa` invocation that
 * actually ran (issue #432, SEC-1/SEC-10).
 *
 * Clearing an administrator's second factor removes an authentication factor from
 * a live account, and the command that does it is guarded by nothing but
 * possession of the migrate-role database credential. There is no HTTP surface and
 * no environment flag to read afterwards, so without this table the only trace of a
 * break-glass would be a log line in whatever the operator's stdout went to. A row
 * here is durable, is in the same database as the account it describes, and answers
 * the question an incident review actually asks: was this account's second factor
 * removed out of band, when, and by which database role.
 *
 * Three properties, each deliberate:
 *
 * - **No foreign key to `user`.** The same choice `erasure_tombstones` makes one
 *   table over: an audit record that cascades away with the thing it describes is
 *   not an audit record. The account may later be removed; the fact that somebody
 *   reset its second factor survives that.
 * - **The email is stored, and that is not a telemetry decision.** A direct
 *   identifier is fine in the operational database (`user.email` is right beside
 *   it) and is exactly what makes the row readable a year later. SEC-13 governs
 *   what is *exported*, and nothing here is: the paired log event carries no
 *   attributes at all.
 * - **A row is written even when there was nothing to clear.** An operator who
 *   runs the command against an account with no enrolment has still exercised the
 *   break-glass, and `cleared_factors = 0` is the honest record of it. Writing
 *   only on a change would make "the command was run" invisible in exactly the
 *   case where a mistargeted run is the thing worth seeing.
 *
 * Never written by the application: the API connects as `qcms_app`, which the
 * command refuses to run as (SEC-10). The only writer is the command itself,
 * connected as the migration role.
 */
export const twoFactorResets = pgTable("two_factor_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** `user.id` of the account whose factor was cleared. Not a foreign key; see above. */
  userId: text("user_id").notNull(),
  /** The stored address of that account, resolved from the operator's argument. */
  email: text("email").notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  /** `current_user` at the moment of the reset - the whole guard, recorded. */
  databaseRole: text("database_role").notNull(),
  /** How many `twoFactor` rows the reset deleted. Zero is a real, recordable outcome. */
  clearedFactors: integer("cleared_factors").notNull(),
  /** Whether `user.twoFactorEnabled` was true before the reset. */
  wasEnrolled: boolean("was_enrolled").notNull(),
});
