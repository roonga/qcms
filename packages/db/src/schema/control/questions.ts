import { sql } from "drizzle-orm";
import { check, integer, jsonb, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import type { QuestionDefinition, QuestionId } from "@roonga/qcms-core";

import { authOrganization } from "./auth.js";
import { questionStatus } from "./enums.js";

import { controlSchema } from "../schemas.js";

/**
 * Question library identity. A `questionId` is stable forever and never reused
 * with a different meaning (R6); the human-facing `slug` is unique.
 *
 * `workspaceId` is the workspace that owns this question (ADR-41, task 068, criterion
 * 1), `NOT NULL` with no default for the reason `forms.workspaceId` is: a question
 * cannot exist without exactly one workspace and the column is the enforcement.
 *
 * **Ownership is on this identity row and never on a version**, which is what makes
 * Q14's move one `UPDATE`: a question moves workspaces, every stored version is
 * untouched, and a form elsewhere that already pins one keeps serving it (ADR-02, R6).
 * Whether a **new** pin is allowed is a publish-time rule over this column and the
 * owning workspace's `isShared` flag, in `apps/api/src/features/workspaces/rules.ts`,
 * not a constraint here: the constraint would have to see a draft.
 */
export const questions = controlSchema.table("questions", {
  questionId: text("question_id").$type<QuestionId>().primaryKey(),
  slug: text("slug").notNull().unique(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => authOrganization.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Versioned question definitions. `definition` is opaque domain JSONB (§2.2 of
 * `DOMAIN_SCHEMA.md`) that Postgres stores and indexes but never interprets.
 *
 * Immutability (I1): once `status = 'published'`, `definition` is frozen - a
 * BEFORE UPDATE trigger (`question_versions_freeze_published`, migration 0001)
 * rejects any change to it. See `packages/db/README.md` for the rationale
 * behind trigger-over-CHECK.
 */
export const questionVersions = controlSchema.table(
  "question_versions",
  {
    questionId: text("question_id")
      .$type<QuestionId>()
      .notNull()
      .references(() => questions.questionId),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<QuestionDefinition>().notNull(),
    status: questionStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    primaryKey({ columns: [t.questionId, t.version] }),
    check("question_versions_version_positive", sql`${t.version} > 0`),
  ],
);
