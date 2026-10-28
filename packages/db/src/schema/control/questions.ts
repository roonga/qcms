import { sql } from "drizzle-orm";
import { check, integer, jsonb, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import type { QuestionDefinition, QuestionId } from "@roonga/qcms-core";

import { authOrganization } from "./auth.js";
import { questionStatus } from "./enums.js";

import { controlSchema } from "../schemas.js";

/**
 * Question library identity. A `questionId` is stable forever and never reused with a different meaning (R6).
 * Ownership is on this row, never a version, so a question moves workspaces with one `UPDATE`. Whether a new
 * pin is allowed is a publish-time rule in `apps/api/src/features/workspaces/rules.ts`: a constraint would
 * have to see a draft.
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
 * Versioned question definitions. `definition` is opaque domain JSONB that Postgres stores
 * and indexes but never interprets. Once `status = 'published'` it is frozen by
 * `question_versions_freeze_published` (I1).
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
