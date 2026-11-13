import { sql } from "drizzle-orm";
import { boolean, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/**
 * better-auth validates this mirror on the first request through `auth.handler` and
 * refuses to run on a mismatch, in both directions: a column it declares and this file
 * lacks is fatal, and so is a `NOT NULL` column with no default that it never writes. So
 * a column of ours either carries a default or is nullable.
 */

/** An administrator account. */
export const authUser = controlSchema.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  twoFactorEnabled: boolean("twoFactorEnabled"),
  /** Declare this authorization claim with input: false so no request body can set it. */
  role: text("role").notNull().default("admin"),
  /**
   * Whether this account still holds the provisional credential `qcms:create-admin` set. Cleared only by a
   * successful password change.
   */
  mustChangePassword: boolean("mustChangePassword").notNull().default(false),
});

/** A signed-in administrator's session. */
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
  /** The vendor refuses request input for these session scope fields. */
  activeOrganizationId: text("activeOrganizationId"),
  activeTeamId: text("activeTeamId"),
});

/** One account's credential for one provider, keyed on `(providerId, accountId)`. */
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

/** better-auth's short-lived verification values. */
export const authVerification = controlSchema.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

/** An account's enrolled TOTP factor and backup codes. */
export const authTwoFactor = controlSchema.table("twoFactor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  /** `verified` marks a confirmed factor; the other two are the plugin's brute-force lockout state. */
  verified: boolean("verified").default(true),
  failedVerificationCount: integer("failedVerificationCount").default(0),
  lockedUntil: timestamp("lockedUntil"),
});

/** The vendor checks column nullability and defaults, not the Postgres schema owning a table. */

/** A workspace. */
export const authOrganization = controlSchema.table(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    /**
     * Used for nothing enforced: any holder of `organization: update` replaces it
     * wholesale, so every value the API reads to make a decision is a typed field instead.
     */
    metadata: text("metadata"),
    isShared: boolean("isShared").notNull().default(false),
    requireSecondApprover: boolean("requireSecondApprover").notNull().default(false),
    archivedAt: timestamp("archivedAt"),
  },
  (t) => [
    /** At most one shared workspace per installation: one true value, not one row. */
    uniqueIndex("organization_shared_uq")
      .on(t.isShared)
      .where(sql`${t.isShared}`),
  ],
);

/** One account's membership of one workspace, carrying its workspace-wide role. */
export const authMember = controlSchema.table("member", {
  id: text("id").primaryKey(),
  organizationId: text("organizationId")
    .notNull()
    .references(() => authOrganization.id, { onDelete: "cascade" }),
  userId: text("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

/** A pending invitation to a workspace. */
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
 * An access group: a set of roles and one environment set. Neither carries a default on
 * purpose, because a default would be a grant nobody wrote.
 */
export const authTeam = controlSchema.table("team", {
  id: text("id").primaryKey(),
  /** The administrator's own label for the group, unique within the workspace. */
  name: text("name").notNull(),
  memberCount: integer("memberCount").notNull().default(0),
  organizationId: text("organizationId")
    .notNull()
    .references(() => authOrganization.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt"),
  roles: text("roles").array().notNull(),
  /** Empty only where every role in the group ignores the environment set. */
  environments: text("environments").array().notNull(),
  /** Written only by the directory sync path, `input: false`. */
  externalGroupId: text("externalGroupId").unique(),
});

/** One account's place in one access group. */
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
