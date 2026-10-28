/**
 * Every table is declared unqualified, so the connection's `search_path` (`data_<env>, control`) chooses the
 * environment. The generator in `../../environment/sql.ts` emits from this module, so anything not declared
 * here is missing from every environment.
 */

import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export * from "./sessions.js";
export * from "./answers.js";
export * from "./answer-group-instances.js";
export * from "./submissions.js";
export * from "./erasure.js";
export * from "./outbox.js";
export * from "./deliveries.js";
export * from "./webhooks.js";

import * as answerGroupInstancesModule from "./answer-group-instances.js";
import * as answersModule from "./answers.js";
import * as deliveriesModule from "./deliveries.js";
import * as erasureModule from "./erasure.js";
import * as outboxModule from "./outbox.js";
import * as sessionsModule from "./sessions.js";
import * as submissionsModule from "./submissions.js";
import * as webhooksModule from "./webhooks.js";

/** Every data-plane table, in creation order, so referenced tables come first. */
export const DATA_PLANE_TABLES: readonly PgTable[] = [
  sessionsModule.sessions,
  answersModule.answers,
  answerGroupInstancesModule.answerGroupInstances,
  submissionsModule.submissions,
  erasureModule.erasureTombstones,
  outboxModule.outbox,
  webhooksModule.webhooks,
  deliveriesModule.webhookDeliveries,
];

/** Every data-plane table name. */
export const DATA_PLANE_TABLE_NAMES: readonly string[] = DATA_PLANE_TABLES.map((table) =>
  getTableName(table),
);

/**
 * The trigger functions stay single, in `control`: a trigger in `data_test` executes
 * `control.answers_reject_update()`, so a fix to the body is one edit rather than one per
 * environment.
 */
export interface DataPlaneTrigger {
  /** Unique within its schema. */
  readonly name: string;
  /** The data-plane table it is declared on. */
  readonly table: string;
  /** As written into `CREATE TRIGGER`. */
  readonly timing: string;
  /** The function in `control` it executes, with no schema prefix. */
  readonly functionName: string;
  /** One line, copied into the generated SQL. */
  readonly why: string;
}

/** Every trigger the data plane carries. */
export const DATA_PLANE_TRIGGERS: readonly DataPlaneTrigger[] = [
  {
    name: "answers_reject_update",
    table: "answers",
    timing: "BEFORE UPDATE",
    functionName: "answers_reject_update",
    why: "the answer ledger is append-only (I5): every UPDATE is rejected",
  },
  {
    name: "answers_reject_delete",
    table: "answers",
    timing: "BEFORE DELETE",
    functionName: "answers_reject_delete",
    why: "DELETE passes only through the two sanctioned whole-session doors (ADR-17)",
  },
  {
    name: "answer_group_instances_reject_update",
    table: "answer_group_instances",
    timing: "BEFORE UPDATE",
    functionName: "answer_group_instances_reject_update",
    why: "the roster is append-only (I5, ADR-42): every UPDATE is rejected",
  },
  {
    name: "answer_group_instances_reject_delete",
    table: "answer_group_instances",
    timing: "BEFORE DELETE",
    functionName: "answer_group_instances_reject_delete",
    why: "DELETE passes only through the two sanctioned whole-session doors (ADR-17)",
  },
];

/**
 * The name of the `CHECK (environment = '<env>')` on `sessions`, emitted by the generator
 * because its literal is the schema's own name.
 */
export const SESSION_ENVIRONMENT_CHECK = "sessions_environment_matches";
