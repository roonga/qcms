import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import type { FormDefinition, FormId } from "@roonga/qcms-core";

import { authOrganization } from "./auth.js";

import { controlSchema } from "../schemas.js";

/**
 * Form identity. There is deliberately no `status` column: the closed state is per (form, environment) and
 * lives on `control.form_releases`. `slug` is unique installation-wide so `/f/{slug}` needs no workspace
 * segment; the `workspaceId` reference backstops deleting a workspace that still owns a form.
 */
export const forms = controlSchema.table("forms", {
  formId: text("form_id").$type<FormId>().primaryKey(),
  slug: text("slug").notNull().unique(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => authOrganization.id),
  defaultLocale: text("default_locale").notNull(),
  challengeRequired: boolean("challenge_required").notNull().default(false),
  /** `NULL` to use the config-default min-time floor. */
  minSubmitMs: integer("min_submit_ms"),
});

/**
 * The mutable working state of a form. The `form_id` primary key is what enforces one open
 * draft per form.
 */
export const formDrafts = controlSchema.table("form_drafts", {
  formId: text("form_id")
    .$type<FormId>()
    .primaryKey()
    .references(() => forms.formId),
  definition: jsonb("definition").$type<FormDefinition>().notNull(),
  /** Provenance shown on the publish confirmation, not a permission. */
  agentAssisted: boolean("agent_assisted").notNull().default(false),
  /**
   * Bumped on every save, so a publish confirmation can name the draft it reviewed and the
   * commit can refuse one that moved underneath it. `updatedAt` cannot do that job: two
   * saves in one clock tick carry the same timestamp.
   */
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Immutable published snapshots: the frozen definition, the compiled A2UI documents the
 * portal serves verbatim, and the version stamps. `form_versions_reject_update` rejects
 * every UPDATE (R1, I1).
 */
export const formVersions = controlSchema.table(
  "form_versions",
  {
    formId: text("form_id")
      .$type<FormId>()
      .notNull()
      .references(() => forms.formId),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<FormDefinition>().notNull(),
    compiled: jsonb("compiled").$type<CompiledForm>().notNull(),
    compilerVersion: text("compiler_version").notNull(),
    a2uiSpecVersion: text("a2ui_spec_version").notNull(),
    semanticsVersion: text("semantics_version").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * The author the two-person rule compares a `prod` release against. No foreign key, so an account deletion
     * cannot cascade or block the audit answer. Null means unknown, and the release path refuses such a `prod`
     * release while the workspace switch is on.
     */
    publishedBy: text("published_by"),
  },
  (t) => [
    primaryKey({ columns: [t.formId, t.version] }),
    check("form_versions_version_positive", sql`${t.version} > 0`),
  ],
);
