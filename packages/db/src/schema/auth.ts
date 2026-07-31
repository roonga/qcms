import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * better-auth tables (`ARCHITECTURE.md` §7, admin identity with TOTP 2FA at
 * launch). These mirror the Drizzle schema better-auth's adapter expects for its core
 * models plus the `twoFactor` plugin - camelCase column names, `text` primary keys,
 * `timestamp` (no timezone) - plus one column of our own (`user.role`, below).
 *
 * They live here because migration history is package-owned: the admin's users,
 * sessions, and accounts share the deployment's one Postgres.
 *
 * Task 031 wired the real auth instance and reconciled this mirror against
 * better-auth 1.6's own field definitions (`getAuthTables`), which found three
 * missing `twoFactor` columns - see the note on that table. The library validates the
 * Drizzle schema at startup and refuses to run on a mismatch, so **the check is not
 * optional and not deferrable**: any change to the configured plugin set means
 * re-reconciling this file and appending a migration, or the first request after the
 * upgrade throws.
 *
 * These tables are deliberately isolated from the domain schema: no foreign keys
 * cross between auth and the questionnaire tables.
 *
 * One column is ours rather than better-auth's default set: `user.role`
 * (task 031). Launch ships a single `admin` role, but SEC-3 requires the session
 * context to carry a role claim **from day one** so Phase 4 RBAC is additive code
 * rather than a migration against a live deployment. The admin shell declares it
 * to better-auth as an `additionalFields` entry with `input: false`, so no
 * request body can set it; nothing at launch reads it for an authorization
 * decision.
 */

export const authUser = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  twoFactorEnabled: boolean("twoFactorEnabled"),
  /** SEC-3 role claim. Single value (`admin`) at launch; see the file header. */
  role: text("role").notNull().default("admin"),
});

export const authSession = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
});

export const authAccount = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const authVerification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const authTwoFactor = pgTable("twoFactor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  /**
   * The plugin's own enrollment and lockout bookkeeping (task 031). These three columns
   * were missing from the 013 hand-written mirror, and better-auth refuses to run
   * without them: it validates the Drizzle schema against its plugin field definitions
   * and throws `The field "verified" does not exist in the "twoFactor" Drizzle schema`
   * at the first sign-in. That is exactly the drift this file's header predicted, so the
   * values below are read off the plugin's definitions rather than guessed.
   *
   * `verified` marks a confirmed factor; `failedVerificationCount` and `lockedUntil` are
   * the plugin's brute-force lockout state for TOTP and recovery-code attempts, which
   * makes them part of SEC-1's throttling story rather than incidental bookkeeping.
   */
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failedVerificationCount").default(0),
  lockedUntil: timestamp("lockedUntil"),
});
