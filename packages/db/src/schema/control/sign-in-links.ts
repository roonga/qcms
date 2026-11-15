import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { authUser } from "./auth.js";

import { controlSchema } from "../schemas.js";

/** Why the link was issued. The values match the mail template's own purposes. */
export const SIGN_IN_LINK_PURPOSES = ["account-created", "reactivated", "reset"] as const;

/** One of {@link SIGN_IN_LINK_PURPOSES}. */
export type SignInLinkPurpose = (typeof SIGN_IN_LINK_PURPOSES)[number];

/** How the message carrying the link fared. `pending` is the row before the relay answers. */
export const SIGN_IN_LINK_DELIVERIES = ["pending", "sent", "undeliverable"] as const;

/** One of {@link SIGN_IN_LINK_DELIVERIES}. */
export type SignInLinkDelivery = (typeof SIGN_IN_LINK_DELIVERIES)[number];

/** The name of the CHECK that pins {@link SIGN_IN_LINK_PURPOSES} at the database. */
export const SIGN_IN_LINK_PURPOSE_CHECK = "sign_in_links_purpose";

/** The name of the CHECK that pins {@link SIGN_IN_LINK_DELIVERIES} at the database. */
export const SIGN_IN_LINK_DELIVERY_CHECK = "sign_in_links_delivery";

/** The table name, for the grant emitter and the migration that creates it. */
export const SIGN_IN_LINKS_TABLE = "sign_in_links";

/**
 * One emailed single-use sign-in link. Only the token's SHA-256 digest is stored, so a
 * reader of this table cannot sign in as anybody: the token itself exists in the message
 * and nowhere else.
 */
export const signInLinks = controlSchema.table(
  SIGN_IN_LINKS_TABLE,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    /** Lower-case hex SHA-256 of the token. Unique, so a digest collision cannot mint a second link. */
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Null means still usable; set by the compare-and-set that consumes the link. */
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    /** Set when a later link for the same account supersedes this one. */
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
    delivery: text("delivery").notNull().default("pending"),
    /** `user.id` of the Site administrator who issued it, or the account itself at bootstrap. */
    issuedBy: text("issued_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("sign_in_links_user_idx").on(t.userId),
    check(
      SIGN_IN_LINK_PURPOSE_CHECK,
      sql`${t.purpose} in ('account-created', 'reactivated', 'reset')`,
    ),
    check(SIGN_IN_LINK_DELIVERY_CHECK, sql`${t.delivery} in ('pending', 'sent', 'undeliverable')`),
  ],
);
