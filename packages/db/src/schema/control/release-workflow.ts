import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { environments } from "./environments.js";

import { controlSchema } from "../schemas.js";

/** The revisions table name, for the grant emitter and the migration that creates it. */
export const RELEASE_WORKFLOW_REVISIONS_TABLE = "release_workflow_revisions";

/** The rules table name, for the grant emitter and the migration that creates it. */
export const RELEASE_WORKFLOW_RULES_TABLE = "release_workflow_rules";

/**
 * One installation-wide release-workflow revision (Q85). Append-only: a change writes a
 * new revision rather than editing one, so a release refused last week stays explainable.
 * No row is seeded, and no revision means the derived default behaviour.
 */
export const releaseWorkflowRevisions = controlSchema.table(
  RELEASE_WORKFLOW_REVISIONS_TABLE,
  {
    revision: integer("revision").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /** No foreign key, so a later account deletion cannot cascade or block the record. */
    createdBy: text("created_by").notNull(),
    /** Display text alone; no decision ever reads it. */
    note: text("note"),
  },
  (t) => [check("release_workflow_revisions_positive", sql`${t.revision} > 0`)],
);

/**
 * One revision's rule for one destination environment. `prod`'s role split and the
 * workspace two-person rule hold whatever these columns say.
 */
export const releaseWorkflowRules = controlSchema.table(
  RELEASE_WORKFLOW_RULES_TABLE,
  {
    revision: integer("revision").notNull(),
    environment: text("environment").notNull(),
    /** A committed release of the same version in any one of these satisfies the rule. */
    requiresPriorReleaseIn: text("requires_prior_release_in").array().notNull(),
    allowsDraftPublish: boolean("allows_draft_publish").notNull(),
    allowsInBatch: boolean("allows_in_batch").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revision, t.environment] }),
    foreignKey({
      name: "release_workflow_rules_revision_fk",
      columns: [t.revision],
      foreignColumns: [releaseWorkflowRevisions.revision],
    }),
    foreignKey({
      name: "release_workflow_rules_environment_fk",
      columns: [t.environment],
      foreignColumns: [environments.name],
    }),
  ],
);
