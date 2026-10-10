import { boolean, integer, text, timestamp } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

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
 * better-auth 1.7.7 runs `ctx.checkSchema()` from the router's `onRequest` hook and
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
 * One column is ours rather than better-auth's default set: `user.role`
 * (task 031). Launch ships a single `admin` role, but SEC-3 requires the session
 * context to carry a role claim **from day one** so Phase 4 RBAC is additive code
 * rather than a migration against a live deployment. The admin shell declares it
 * to better-auth as an `additionalFields` entry with `input: false`, so no
 * request body can set it; nothing at launch reads it for an authorization
 * decision.
 */

export const authUser = controlSchema.table("user", {
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
   * Whether this account still holds the provisional credential
   * `qcms:create-admin` set (task 061, SEC-1).
   *
   * The password that command sets is a transfer mechanism and not a permanent
   * credential: it comes from a shell command, a provisioning script or a CI
   * variable. This column is what says so durably, where a cookie or a session claim
   * would not survive a restart or a second browser. better-auth applies the field's
   * declared default when it creates a user, so the flag is set by the only path that
   * creates one; the API clears it on a successful password change and on nothing else.
   *
   * The **column** default is `false` while better-auth's **declared field** default is
   * `true`, and the difference is deliberate. Under Q22 this task is green field, so no
   * row predates the control and the column default decides nothing here; it is kept as
   * 061 declared it so the mirror and that task's reasoning stay one thing.
   */
  mustChangePassword: boolean("mustChangePassword").notNull().default(false),
});

export const authSession = controlSchema.table("session", {
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
  /**
   * The organisation plugin's two session columns (Q32, Q39). Both are
   * `required: false` and `input: false` in better-auth 1.7.7
   * (`dist/plugins/organization/organization.mjs:858-871`), <!-- expect: activeOrganizationId: { -->
   * so they are nullable here and no request body can set them. `activeTeamId` exists
   * only while `teams.enabled` is on, which task 069's configuration turns on; the
   * column is created now either way, because a column better-auth declares and the
   * mirror lacks is fatal on the first request through its handler.
   */
  activeOrganizationId: text("activeOrganizationId"),
  activeTeamId: text("activeTeamId"),
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
export const authAccount = controlSchema.table("account", {
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

export const authVerification = controlSchema.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const authTwoFactor = controlSchema.table("twoFactor", {
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

/**
 * # The organisation plugin's tables (ADR-41, Q32, Q39)
 *
 * A **workspace** is an `organization` row; `forms.owner` is the `member` row's role;
 * **every other grant is a team**, whose additional fields carry one role and its
 * scope. Task 069 declares the plugin and owns every write path; **this task creates
 * the tables and the mirror and declares no role, no statement and no write path**
 * (task 064's out-of-scope list).
 *
 * They are created **here, in this task's baseline**, rather than by an appended
 * migration, because the two tracks are independent and whichever lands first carries
 * them; 068 creates them instead only if 068 lands first.
 *
 * ## The fields below are read off better-auth 1.7.7, not remembered
 *
 * `dist/plugins/organization/organization.mjs:704-840` <!-- expect: const schema = { -->
 * declares `organization`, `member` and `invitation`.
 * `dist/plugins/organization/organization.mjs:585-660` <!-- expect: const teamSchema = teamSupport -->
 * declares `team` and `teamMember`, and only when `teams.enabled` is on:
 * `dist/plugins/organization/organization.mjs:419`. <!-- expect: const teamSupport = opts.teams?.enabled -->
 * Every model also carries the core `id` primary key.
 *
 * ## What the library's check does and does not look at
 *
 * `@better-auth/drizzle-adapter 1.7.7` introspects the Drizzle schema **by the key
 * each table is exported under and the property name of each column**, reading only
 * `notNull` and `hasDefault`
 * (`@better-auth/drizzle-adapter/dist/schema-check-DFZjRat1.mjs:85-99`). <!-- expect: if (!is(table, Table)) continue -->
 * `diffSchema` then asks two questions and no others: every column the library writes
 * exists, and every column it does **not** write is nullable or carries a default
 * (`@better-auth/core/dist/db/schema-diff.mjs:41-54`). <!-- expect: kind: "unexpected-required-column" -->
 *
 * Two consequences worth stating, because both are load-bearing for this task:
 *
 * 1. **The Postgres schema is invisible to the check.** Nothing in that introspection
 *    reads the schema a `pgSchema` table belongs to, so moving the whole mirror into
 *    `control` cannot fail it. The tables still have to be *reachable*, which is a
 *    grant and a `search_path` question rather than a schema-check one, and criterion
 *    7 asserts it against a real Postgres rather than against this paragraph.
 * 2. **A `NOT NULL` column of ours that the library never writes is fatal**, on the
 *    first request through the handler. So each QCMS additional field below either
 *    carries a default or is nullable, except the two that task 069 declares to the
 *    plugin as required fields - a team with no role and no scope is not a grant, and
 *    a default there would be a grant nobody wrote.
 */

export const authOrganization = controlSchema.table("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  /**
   * The plugin's free-form column. **QCMS uses it for nothing enforced** (Q39): any
   * holder of `organization: update` replaces it wholesale, so every value the API
   * reads to make a decision is a typed additional field instead.
   */
  metadata: text("metadata"),
  /** The org-wide question library every workspace may pin from (ADR-41). */
  isShared: boolean("isShared").notNull().default(false),
  /** The per-workspace two-person switch for `prod` (Q13: off by default). */
  requireSecondApprover: boolean("requireSecondApprover").notNull().default(false),
  /** Set when the workspace is archived; a workspace is archived, never deleted (Q15). */
  archivedAt: timestamp("archivedAt"),
  /** F17's convenience, as a visible setting rather than a habit (Q39). */
  seedNewEditorsWithTestData: boolean("seedNewEditorsWithTestData").notNull().default(false),
});

export const authMember = controlSchema.table("member", {
  id: text("id").primaryKey(),
  organizationId: text("organizationId")
    .notNull()
    .references(() => authOrganization.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  /** `forms.owner` for an owner; the plugin's own default is `member` (Q32, Q38). */
  role: text("role").notNull().default("member"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const authInvitation = controlSchema.table("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organizationId")
    .notNull()
    .references(() => authOrganization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  teamId: text("teamId"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  inviterId: text("inviterId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
});

/**
 * An **access group**: one grant, carrying a role and its scope (Q32, Q37, Q38).
 *
 * `role`, `environments` and `forms` have **no default on purpose**. They are the
 * grant, and a default would be a grant nobody wrote; task 069 declares all three to
 * the plugin as required additional fields, which is what keeps the library writing
 * them. Nothing in this task creates a team row.
 */
export const authTeam = controlSchema.table("team", {
  id: text("id").primaryKey(),
  /** The stored access-group name, `<environments>.<plane>.<role>[.<label>]` (Q37). */
  name: text("name").notNull(),
  /** The plugin's own bookkeeping: `input: false`, `returned: false`, default 0. */
  memberCount: integer("memberCount").notNull().default(0),
  organizationId: text("organizationId")
    .notNull()
    .references(() => authOrganization.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt"),
  /** One of Q38's six role names. Task 069 declares it and validates the set. */
  role: text("role").notNull(),
  /**
   * The environment scope: a set of `control.environments` names, or the single
   * element `all`. A Postgres `text[]`, which is what `@better-auth/drizzle-adapter
   * 1.7.6` maps a `string[]` additional field to on `pg`
   * (`@better-auth/drizzle-adapter/dist/generate-drizzle-schema-iWvrXnu0.mjs:112-114`). <!-- expect: text('${name}').array() -->
   */
  environments: text("environments").array().notNull(),
  /** The form scope: a list of form ids, or the single element `all` (Q28). */
  forms: text("forms").array().notNull(),
  /**
   * The key task C3's directory mapping joins on (Q39, Q37 rule 3). Written only by
   * the sync path, `input: false`, and unique. Declared **now**, though nothing writes
   * it until C3, so that C3 is a sync path rather than a migration against a live
   * deployment. Nullable, because every team that exists before C3 has none.
   */
  externalGroupId: text("externalGroupId").unique(),
});

export const authTeamMember = controlSchema.table("teamMember", {
  id: text("id").primaryKey(),
  teamId: text("teamId")
    .notNull()
    .references(() => authTeam.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  /** The plugin's own uniqueness key: `input: false`, `returned: false`, optional. */
  membershipKey: text("membershipKey").unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});
