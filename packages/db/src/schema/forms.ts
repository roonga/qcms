import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import type { CompiledForm } from "@qcms/a2ui-compiler";
import type { FormDefinition, FormId } from "@qcms/core";

/** Form identity. */
export const forms = pgTable("forms", {
  formId: text("form_id").$type<FormId>().primaryKey(),
  slug: text("slug").notNull(),
  defaultLocale: text("default_locale").notNull(),
});

/**
 * The mutable working state of a form. The `form_id` primary key enforces the
 * one-open-draft-per-form invariant (a second draft insert for the same form
 * fails the PK uniqueness check).
 */
export const formDrafts = pgTable("form_drafts", {
  formId: text("form_id")
    .$type<FormId>()
    .primaryKey()
    .references(() => forms.formId),
  definition: jsonb("definition").$type<FormDefinition>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Immutable published snapshots (R1, I1, ADR-18): the frozen domain definition,
 * the compiled A2UI documents served verbatim by the portal, and the version
 * stamps that make the audit copy self-describing. A BEFORE UPDATE trigger
 * (`form_versions_reject_update`, migration 0001) rejects every UPDATE.
 */
export const formVersions = pgTable(
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
  },
  (t) => [
    primaryKey({ columns: [t.formId, t.version] }),
    check("form_versions_version_positive", sql`${t.version} > 0`),
  ],
);
