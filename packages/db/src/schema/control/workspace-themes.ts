import { sql } from "drizzle-orm";
import { check, customType, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { AppearanceFace, AppearancePalettes } from "@roonga/qcms-core";

import { authOrganization } from "./auth.js";

import { controlSchema } from "../schemas.js";

/** The table name, for the grant emitters and the migration that creates it. */
export const APPEARANCE_LOGOS_TABLE = "appearance_logos";

/** The table name, for the grant emitters and the migration that creates it. */
export const WORKSPACE_THEMES_TABLE = "workspace_themes";

/** The raster types a stored logo may carry; SVG is refused at upload (SEC-9, SEC-18). */
export const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoContentType = (typeof LOGO_CONTENT_TYPES)[number];

/** The largest logo the store accepts, pinned by a CHECK so no caller can raise it. */
export const LOGO_MAX_BYTES = 524_288;

export const APPEARANCE_LOGOS_KEY_CHECK = "appearance_logos_key_hex";
export const APPEARANCE_LOGOS_CONTENT_TYPE_CHECK = "appearance_logos_content_type";
export const APPEARANCE_LOGOS_SIZE_CHECK = "appearance_logos_size";
export const WORKSPACE_THEMES_CORNERS_CHECK = "workspace_themes_corners";
export const WORKSPACE_THEMES_NAME_UNIQUE = "workspace_themes_workspace_name";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Immutable, content-addressed logo bytes, keyed by the SHA-256 of the bytes. `UPDATE` and
 * `DELETE` are revoked from every `qcms_app%` role, so a key a theme, a draft or a version
 * carries always resolves to the same image: deleting a theme removes no logo, and a
 * version's logo is frozen with the version (ADR-07).
 */
export const appearanceLogos = controlSchema.table(
  APPEARANCE_LOGOS_TABLE,
  {
    /** Lowercase hex SHA-256 of `bytes`, which is `LogoKey` in `@roonga/qcms-core`. */
    key: text("key").primaryKey(),
    contentType: text("content_type").$type<LogoContentType>().notNull(),
    bytes: bytea("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** `user.id`, or null where a seeding path stored it. No foreign key, as on the audits. */
    createdBy: text("created_by"),
  },
  (t) => [
    check(APPEARANCE_LOGOS_KEY_CHECK, sql`${t.key} ~ '^[0-9a-f]{64}$'`),
    check(
      APPEARANCE_LOGOS_CONTENT_TYPE_CHECK,
      sql`${t.contentType} in ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check(
      APPEARANCE_LOGOS_SIZE_CHECK,
      sql`octet_length(${t.bytes}) > 0 and octet_length(${t.bytes}) <= 524288`,
    ),
  ],
);

/**
 * A workspace's named themes. Nothing links a form to one: applying a theme copies its
 * tokens into the draft by value, so changing or deleting a theme alters no draft and no
 * version (`docs/WORKSPACE_ACCESS.md` section 9).
 */
export const workspaceThemes = controlSchema.table(
  WORKSPACE_THEMES_TABLE,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => authOrganization.id),
    name: text("name").notNull(),
    palettes: jsonb("palettes").$type<AppearancePalettes>().notNull(),
    face: text("face").$type<AppearanceFace>().notNull(),
    corners: text("corners").notNull(),
    /** No cascade and no `ON DELETE SET NULL`: the bytes outlive every theme that names them. */
    logoKey: text("logo_key").references(() => appearanceLogos.key),
    /** The host a derive read. Null for a theme made by hand. */
    sourceHost: text("source_host"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    createdBy: text("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [
    uniqueIndex(WORKSPACE_THEMES_NAME_UNIQUE).on(t.workspaceId, t.name),
    check(
      WORKSPACE_THEMES_CORNERS_CHECK,
      sql`${t.corners} in ('sharp', 'subtle', 'rounded', 'pill')`,
    ),
  ],
);
