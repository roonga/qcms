import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import type { QuestionDefinition, QuestionId } from "@qcms/core";

import { questionStatus } from "./enums.js";

/**
 * Question library identity. A `questionId` is stable forever and never reused
 * with a different meaning (R6); the human-facing `slug` is unique.
 */
export const questions = pgTable("questions", {
  questionId: text("question_id").$type<QuestionId>().primaryKey(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/**
 * Versioned question definitions. `definition` is opaque domain JSONB (§2.2 of
 * `DOMAIN_SCHEMA.md`) that Postgres stores and indexes but never interprets.
 *
 * Immutability (I1): once `status = 'published'`, `definition` is frozen — a
 * BEFORE UPDATE trigger (`question_versions_freeze_published`, migration 0001)
 * rejects any change to it. See `packages/db/README.md` for the rationale
 * behind trigger-over-CHECK.
 */
export const questionVersions = pgTable(
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
