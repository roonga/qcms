/**
 * The **data plane** (ADR-40): one copy per environment, in `data_<env>`.
 *
 * Sessions, the append-only answer ledger, submissions, erasure tombstones, the
 * transactional outbox, webhooks and their deliveries. Every table here is declared
 * **unqualified**, so the connection's `search_path` (`data_<env>, control`) chooses
 * which environment's copy a query helper reaches. That is criterion 3's resolution
 * half: no helper in `@roonga/qcms-db` can name an environment it was not handed a pool
 * for, because no helper names a schema at all.
 *
 * **This module is what the per-environment generator emits from** (`../../environment/sql.ts`).
 * The tables, their columns, their guards and their foreign keys are read off the
 * Drizzle objects below rather than written out a second time in SQL, so adding a
 * column or an index here reaches every environment - the two the baseline creates and
 * every one the environment command creates later - without a second edit. The one
 * thing Drizzle has no notion of is a **trigger**, so those are declared here too, as
 * data rather than as prose.
 *
 * The other half of the split is `../control/index.ts`, and their table-name sets must
 * stay **disjoint**: see that module's header.
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

/**
 * Every data-plane table, **in creation order**: a table's foreign keys are emitted
 * after every table exists, but `CREATE TABLE` still runs in this order and a reader
 * of the generated SQL should see the referenced tables first.
 */
export const DATA_PLANE_TABLES: readonly PgTable[] = [
  sessionsModule.sessions,
  answersModule.answers,
  // Task 072's roster (ADR-42). A data-plane table like the rest, so it multiplies per
  // environment and its four guards and its foreign key join the per-environment set.
  answerGroupInstancesModule.answerGroupInstances,
  submissionsModule.submissions,
  erasureModule.erasureTombstones,
  outboxModule.outbox,
  webhooksModule.webhooks,
  deliveriesModule.webhookDeliveries,
];

/** Every data-plane table name, derived from the declarations above. */
export const DATA_PLANE_TABLE_NAMES: readonly string[] = DATA_PLANE_TABLES.map((table) =>
  getTableName(table),
);

/**
 * A trigger on a data-plane table.
 *
 * **The trigger functions stay single, in `control`.** A trigger in `data_test`
 * executes `control.answers_reject_update()`, so N triggers share one body and a fix
 * to the body is one edit rather than one per environment. Only the trigger itself
 * multiplies.
 */
export interface DataPlaneTrigger {
  /** The trigger's name, unique within its schema. */
  readonly name: string;
  /** The data-plane table it is declared on. */
  readonly table: string;
  /** `BEFORE UPDATE` or `BEFORE DELETE`, as written into `CREATE TRIGGER`. */
  readonly timing: string;
  /** The function in `control` the trigger executes, with no schema prefix. */
  readonly functionName: string;
  /** One line saying what the trigger is for, copied into the generated SQL. */
  readonly why: string;
}

/**
 * Every trigger the data plane carries, which is the answer ledger's two (I5, R3,
 * ADR-17). Drizzle declares no trigger, so this list is the declaration; the
 * per-environment generator emits one `CREATE TRIGGER` per entry per environment and
 * the guard count includes them.
 */
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
    // The SAME door as the answer ledger's, honoured by the same two sanctioned
    // whole-session paths: the roster joins them rather than opening a third (ADR-17).
    why: "DELETE passes only through the two sanctioned whole-session doors (ADR-17)",
  },
];

/**
 * The name of the Q46 `CHECK (environment = '<env>')` on `sessions`.
 *
 * It is the one guard whose **text differs per environment**, so it cannot be declared
 * on the Drizzle table the way the other guards are: the literal is the schema's own
 * name. The generator emits it and the guard count includes it.
 */
export const SESSION_ENVIRONMENT_CHECK = "sessions_environment_matches";
