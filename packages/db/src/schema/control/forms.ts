import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import type { FormDefinition, FormId } from "@roonga/qcms-core";

import { authOrganization } from "./auth.js";

import { controlSchema } from "../schemas.js";

/**
 * Form identity.
 *
 * **There is no `status` column, since task 066** (Q18, ADR-39's Amendment). The closed
 * state is per **(form, environment)** and lives on the per-environment release state,
 * `control.form_releases`, where closing appends a row carrying that environment's
 * released version with `closed` set. A single column here could only say "closed
 * everywhere", which is the one thing Q18 removed: closing `prod` intake while a `test`
 * run continues is an ordinary operation, and so is the reverse. The `form_status` enum
 * went with the column.
 *
 * What a screen still calls a form's status is therefore **derived, per environment**,
 * from the newest release row for the pair (`getFormEnvironmentState` and
 * `environmentStatesByForm` in `queries/releases.ts`), and is never read from here.
 *
 * `challengeRequired` and `minSubmitMs` are per-form abuse-control settings
 * (task 026) - operational domain config that lives on the mutable identity
 * row, not in the immutable published definition and not a deployment flag
 * (ADR-24). `challengeRequired` gates start-session (018) behind the environment's
 * challenge provider (Q11); `minSubmitMs` overrides the config-default min-time floor
 * the submit slice (020) enforces (`NULL` = use the config default).
 *
 * `workspaceId` is the workspace that owns this form (ADR-41, task 068, criterion 1).
 * **`NOT NULL` with no default**, which is the whole of that criterion: a form cannot
 * exist without exactly one workspace, and the column is what enforces it rather than a
 * backfill or an authoring convention. Ownership sits on the identity row, so moving a
 * form between workspaces is one `UPDATE` here and no published version changes hands
 * (criterion 7).
 *
 * The foreign key points at the organisation row a workspace **is** (Q32), and it is
 * also the backstop under criterion 5: nothing deletes a workspace, and a delete that
 * somehow reached `control.organization` would be refused by this reference while the
 * workspace still owns a form. `archivedAt` is what a workspace's end of life is
 * (Q15), and this column is why an archive is the last step rather than a cascade.
 *
 * `slug` carries the unique constraint ADR-41's Note asks for (criterion 3): slugs are
 * unique **installation-wide** rather than per workspace, so `/f/{slug}` needs no
 * workspace segment and a slug never changes meaning by context. Green field (Q22)
 * makes it a plain constraint rather than a data fix, since no installation holds a
 * duplicate for it to fail against.
 */
export const forms = controlSchema.table("forms", {
  formId: text("form_id").$type<FormId>().primaryKey(),
  slug: text("slug").notNull().unique(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => authOrganization.id),
  defaultLocale: text("default_locale").notNull(),
  challengeRequired: boolean("challenge_required").notNull().default(false),
  minSubmitMs: integer("min_submit_ms"),
});

/**
 * The mutable working state of a form. The `form_id` primary key enforces the
 * one-open-draft-per-form invariant (a second draft insert for the same form
 * fails the PK uniqueness check).
 */
export const formDrafts = controlSchema.table("form_drafts", {
  formId: text("form_id")
    .$type<FormId>()
    .primaryKey()
    .references(() => forms.formId),
  definition: jsonb("definition").$type<FormDefinition>().notNull(),
  /**
   * Whether an agent-assisted proposal has been accepted into this draft (041,
   * ADR-25). Provenance, not a permission: it is what the builder header and the
   * publish confirmation show, so the human publishing knows what they are
   * signing. Sticky within a draft and reset when the draft is discarded, since
   * a fresh draft has no agent history.
   */
  agentAssisted: boolean("agent_assisted").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Immutable published snapshots (R1, I1, ADR-18): the frozen domain definition,
 * the compiled A2UI documents served verbatim by the portal, and the version
 * stamps that make the audit copy self-describing. A BEFORE UPDATE trigger
 * (`form_versions_reject_update`, migration 0001) rejects every UPDATE.
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
  },
  (t) => [
    primaryKey({ columns: [t.formId, t.version] }),
    check("form_versions_version_positive", sql`${t.version} > 0`),
  ],
);
