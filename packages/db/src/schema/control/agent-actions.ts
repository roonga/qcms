import { integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { controlSchema } from "../schemas.js";

/**
 * The agent action audit (SEC-17, Q12), in SEC-15's precedent shape: append-only, no
 * foreign key, `INSERT` without `RETURNING` for application roles, and no column that may
 * carry an answer value, a secret or `LocalizedText` content, `detail` included.
 */

/** The table name, for the grant emitters and the migration that creates it. */
export const AGENT_ACTIONS_TABLE = "agent_actions";

/** The per-step single-use constraint: a replayed step fails here and rolls back. */
export const AGENT_ACTIONS_STEP_UNIQUE = "agent_actions_proposal_step";

/** One row per confirmed agent step, written in the step's own transaction. */
export const agentActions = controlSchema.table(
  AGENT_ACTIONS_TABLE,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The proposal the step belongs to, from the token's `pid`. */
    proposalId: text("proposal_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    stepCount: integer("step_count").notNull(),
    /** `user.id`, or the IdP subject under single sign-on. */
    actor: text("actor").notNull(),
    workspaceId: text("workspace_id").notNull(),
    environment: text("environment"),
    formId: text("form_id"),
    /** The action kind's registry name. */
    kind: text("kind").notNull(),
    /** The screen id the kind's control sits on. */
    screen: text("screen").notNull(),
    proposedAt: timestamp("proposed_at", { withTimezone: true, mode: "date" }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    /**
     * A non-content fact a later step's reference is checked against: a version number, an
     * environment name, a count, a role name. Never an answer, a secret or authored text.
     */
    detail: text("detail"),
  },
  (t) => [unique(AGENT_ACTIONS_STEP_UNIQUE).on(t.proposalId, t.stepIndex)],
);
