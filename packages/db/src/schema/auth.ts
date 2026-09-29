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
 * "At startup" is shorthand for the first request through `auth.handler`, where
 * better-auth 1.7.6 runs `ctx.checkSchema()` from the router's `onRequest` hook and
 * caches the verdict; nothing is checked at import.
 *
 * The check runs in **both directions** as of 1.7.3, which is the property that made
 * issue #849 (`SchemaMismatchError: Drizzle schema mismatch`). A field the library
 * declares and this file lacks was always fatal; now a `NOT NULL` column with no
 * default that the library never writes is fatal too, because the insert it would
 * make cannot satisfy it. So the mirror is reconciled by removal as well as by
 * addition, and a column of ours that outlives its purpose fails the deployment
 * rather than sitting there as dead weight. `user.role` below is ours and stays legal
 * on the same rule: it carries a default, so better-auth's insert succeeds without
 * naming it.
 *
 * These tables are deliberately isolated from the domain schema: no foreign keys
 * cross between auth and the questionnaire tables.
 *
 * Two columns are ours rather than better-auth's default set, and both are declared
 * to the library as `user.additionalFields` entries with `input: false` so that no
 * request body can set either (`apps/api/src/features/auth/instance.ts`).
 *
 * `user.role` (task 031). Launch ships a single `admin` role, but SEC-3 requires the
 * session context to carry a role claim **from day one** so Phase 4 RBAC is additive
 * code rather than a migration against a live deployment. Nothing at launch reads it
 * for an authorization decision.
 *
 * `user.mustChangePassword` (task 061, SEC-1). The password `qcms:create-admin` sets
 * is a transfer mechanism, not a permanent credential: it comes from a shell command,
 * a provisioning script or a CI variable. This column is what says so durably - a
 * cookie or a session claim would not survive a restart or a second browser, which is
 * exactly the property the control needs. better-auth applies the field's declared
 * default when it creates a user, so the flag is set by the only path that creates
 * one; the API clears it on a successful password change and on nothing else.
 *
 * Both carry a column default, which is what keeps them legal under the two-way schema
 * check above: better-auth's own insert succeeds without naming either.
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
  /**
   * Whether this account still holds the provisional credential `qcms:create-admin`
   * set (task 061, SEC-1). See the file header.
   *
   * The **column** default is `false` and better-auth's **declared field** default is
   * `true`, and the difference is deliberate rather than an inconsistency. The column
   * default is what existing rows get when this migration runs, and for a row that
   * predates the control nobody can tell whether its password was ever changed:
   * backfilling `true` would make an upgrade force a password change on every live
   * deployment's administrator, which is a migration taking a policy action on an
   * account. The declared field default is what every account created from this
   * version onwards gets, which is the control.
   */
  mustChangePassword: boolean("mustChangePassword").notNull().default(false),
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

/**
 * An account is keyed on `(providerId, accountId)`, as it was before better-auth 1.7 and
 * is again from 1.7.3.
 *
 * 1.7.0 through 1.7.2 keyed it on `(issuer, accountId)` instead, so this table carried a
 * required `issuer` column and the unique index better-auth declared for the pair
 * (migration `0017_account_issuer`). 1.7.3 reverses that: the account schema is the 1.6
 * one again, `issuer` is never written, and a `NOT NULL` column the library does not
 * write refuses every sign-up. The official upgrade guide's Drizzle instruction is to
 * regenerate rather than hand-write the relaxation, and the regenerated model drops both
 * the field and the compound unique index; migration `0020_account_drops_issuer` is what
 * `drizzle-kit generate` produced from that.
 *
 * Nothing declares an index on this table now: `getAuthTables(...).account.indexes` is
 * empty on 1.7.3, and the identity constraint the removed index enforced was a property
 * of the 1.7.0 keying, not of ours to keep. `(providerId, accountId)` uniqueness is
 * better-auth's own lookup invariant and it is not expressed as a database constraint in
 * 1.6 or 1.7.3.
 */
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
