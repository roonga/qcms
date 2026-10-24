/**
 * The `reporting` view set, generated per environment and per workspace rather than
 * written into one migration, where a second schema name would need a copy that drifts
 * (ADR-42, `docs/reporting-view.md`).
 *
 * An answer outside a group keeps its `questionId -> value` entry; an answer inside one is
 * carried under one key per group id, holding an ordered array of `{"instance_id":
 * "ins_...", "<questionId>": value, ...}`. A bare `jsonb_object_agg` over `questionId`
 * would silently drop all but one answer per repeating group.
 *
 * The group id comes from `answer_group_instances`, which is total over every instance id
 * a locked answer can name and is data-plane only; that totality is what makes the inner
 * join below safe. The instance list comes from `flowState.visible`, since an instance a
 * respondent added and left blank is still live, so it is "live and shown" rather than
 * "live".
 */

import { sqlLiteral } from "./sql-literal.js";

/** A view in the reporting schema, with its documented column list in order. */
export interface ReportingViewContract {
  readonly name: string;
  readonly columns: readonly string[];
}

/**
 * Each reporting view's documented column list, in ordinal order. A new column is appended
 * rather than inserted, so a consumer selecting `*` keeps the positions it had.
 */
export const reportingViewColumns: readonly ReportingViewContract[] = [
  {
    name: "responses",
    columns: ["session_id", "form_id", "form_version", "submitted_at", "access_mode", "answers"],
  },
  {
    name: "answers_flat",
    columns: [
      "session_id",
      "form_id",
      "form_version",
      "submitted_at",
      "question_id",
      "value",
      "instance_id",
    ],
  },
];

/** The schema names the generated DDL is written against. */
export interface ReportingViewSchemas {
  /** The schema the views are created in (`reporting`, later `reporting_<env>`). */
  readonly reporting: string;
  /**
   * The schema holding `submissions`, `sessions`, `erasure_tombstones` and
   * `answer_group_instances`. Omitted leaves them unqualified, for one data plane on the
   * connection's search path.
   */
  readonly data?: string | undefined;
}

function qualified(schema: string | undefined, table: string): string {
  return schema === undefined ? `"${table}"` : `"${schema}"."${table}"`;
}

/**
 * Row inclusion stays in the view - the submitted-only predicate plus the
 * `erasure_tombstones` anti-join - so no consumer query can read a non-submitted or
 * erased response (ADR-17).
 */
function responsesView(schemas: ReportingViewSchemas): string {
  const submissions = qualified(schemas.data, "submissions");
  const sessions = qualified(schemas.data, "sessions");
  const tombstones = qualified(schemas.data, "erasure_tombstones");
  const roster = qualified(schemas.data, "answer_group_instances");
  return `CREATE VIEW ${qualified(schemas.reporting, "responses")} AS
SELECT
\t"sub"."session_id" AS "session_id",
\t"s"."form_id" AS "form_id",
\t"s"."form_version" AS "form_version",
\t"sub"."submitted_at" AS "submitted_at",
\t"s"."access_mode" AS "access_mode",
\tCOALESCE("agg"."answers", '{}'::jsonb) AS "answers"
FROM ${submissions} "sub"
JOIN ${sessions} "s" ON "s"."session_id" = "sub"."session_id"
LEFT JOIN ${tombstones} "t" ON "t"."session_id" = "sub"."session_id"
LEFT JOIN LATERAL (
\t-- One pass over the locked answers, split by whether the answer names an
\t-- instance, then merged into one object. jsonb_object_agg is safe here
\t-- BECAUSE of the split: the keys it sees are one per ungrouped question plus
\t-- one per group id, and neither can repeat.
\tSELECT jsonb_object_agg("merged"."key", "merged"."value") AS "answers"
\tFROM (
\t\tSELECT
\t\t\t"flat"."item" ->> 'questionId' AS "key",
\t\t\t"flat"."item" -> 'value' AS "value"
\t\tFROM jsonb_array_elements("sub"."locked_answers" -> 'answers') AS "flat"("item")
\t\tWHERE NOT ("flat"."item" ? 'instanceId')
\t\tUNION ALL
\t\tSELECT
\t\t\t"instances"."group_id" AS "key",
\t\t\tjsonb_agg("instances"."instance" ORDER BY "instances"."first_seen") AS "value"
\t\tFROM (
\t\t\tSELECT
\t\t\t\t"roster"."group_id" AS "group_id",
\t\t\t\t"live"."first_seen" AS "first_seen",
\t\t\t\tjsonb_build_object('instance_id', "live"."instance_id")
\t\t\t\t\t|| COALESCE("cells"."cells", '{}'::jsonb) AS "instance"
\t\t\tFROM (
\t\t\t\t-- The LIVE instance set, taken from the submission's own flow state
\t\t\t\t-- rather than from its answers: an instance a respondent added and left
\t\t\t\t-- blank is still live (ADR-42), so deriving the list from \`answers\`
\t\t\t\t-- would drop it and shift every later instance's ordinal by one.
\t\t\t\t-- \`visible\` carries one entry per (visible question, live instance) in
\t\t\t\t-- document order with instances in roster order, which is the order the
\t\t\t\t-- locked set froze.
\t\t\t\tSELECT
\t\t\t\t\t"v"."item" ->> 'instanceId' AS "instance_id",
\t\t\t\t\tmin("v"."ordinality") AS "first_seen"
\t\t\t\tFROM jsonb_array_elements("sub"."locked_answers" -> 'flowState' -> 'visible')
\t\t\t\t\tWITH ORDINALITY AS "v"("item", "ordinality")
\t\t\t\tWHERE "v"."item" ? 'instanceId'
\t\t\t\tGROUP BY "v"."item" ->> 'instanceId'
\t\t\t) "live"
\t\t\tJOIN (
\t\t\t\tSELECT DISTINCT "agi"."instance_id" AS "instance_id", "agi"."group_id" AS "group_id"
\t\t\t\tFROM ${roster} "agi"
\t\t\t\tWHERE "agi"."session_id" = "sub"."session_id"
\t\t\t) "roster" ON "roster"."instance_id" = "live"."instance_id"
\t\t\tLEFT JOIN LATERAL (
\t\t\t\t-- That instance's answered cells. LEFT, because a live instance with no
\t\t\t\t-- answer at all contributes an object carrying only its id, which is
\t\t\t\t-- what makes jsonb_array_length(answers -> '<groupId>') the live count.
\t\t\t\tSELECT jsonb_object_agg("elem"."item" ->> 'questionId', "elem"."item" -> 'value') AS "cells"
\t\t\t\tFROM jsonb_array_elements("sub"."locked_answers" -> 'answers') AS "elem"("item")
\t\t\t\tWHERE "elem"."item" ->> 'instanceId' = "live"."instance_id"
\t\t\t) "cells" ON true
\t\t) "instances"
\t\tGROUP BY "instances"."group_id"
\t) "merged"
) "agg" ON true
WHERE "s"."status" = 'submitted'
\tAND "t"."session_id" IS NULL;`;
}

/**
 * Derived from `responses`, so it inherits that view's row inclusion and there is no
 * second exclusion rule to keep in step.
 *
 * A group array and a multiChoice array are told apart structurally, since both are JSONB
 * arrays under a key: a group's value is an array of objects, a multiChoice value an
 * array of option id strings. `IS DISTINCT FROM` because `-> 0` on a non-array is SQL
 * NULL, and a plain `<>` would make the whole predicate NULL and drop every scalar answer.
 */
function answersFlatView(schemas: ReportingViewSchemas): string {
  return `CREATE VIEW ${qualified(schemas.reporting, "answers_flat")} AS
SELECT
\t"r"."session_id" AS "session_id",
\t"r"."form_id" AS "form_id",
\t"r"."form_version" AS "form_version",
\t"r"."submitted_at" AS "submitted_at",
\t"unpivoted"."question_id" AS "question_id",
\t"unpivoted"."value" AS "value",
\t"unpivoted"."instance_id" AS "instance_id"
FROM ${qualified(schemas.reporting, "responses")} "r"
CROSS JOIN LATERAL (
\t-- Answers outside every group: the key is the questionId and there is no
\t-- instance. A multiChoice selection stays ONE row (the grain is the question,
\t-- not the option), which is what the second predicate protects.
\tSELECT
\t\t"kv"."key" AS "question_id",
\t\tNULL::text AS "instance_id",
\t\t"kv"."value" AS "value"
\tFROM jsonb_each("r"."answers") AS "kv"("key", "value")
\tWHERE jsonb_typeof("kv"."value") <> 'array'
\t\tOR jsonb_typeof("kv"."value" -> 0) IS DISTINCT FROM 'object'
\tUNION ALL
\t-- Answers inside a group: one row per (instance, member question), with the
\t-- group's own array key contributing no row of its own.
\tSELECT
\t\t"cell"."key" AS "question_id",
\t\t"instance"."item" ->> 'instance_id' AS "instance_id",
\t\t"cell"."value" AS "value"
\tFROM jsonb_each("r"."answers") AS "group_key"("key", "value")
\tCROSS JOIN jsonb_array_elements("group_key"."value") AS "instance"("item")
\tCROSS JOIN jsonb_each("instance"."item") AS "cell"("key", "value")
\tWHERE jsonb_typeof("group_key"."value") = 'array'
\t\tAND jsonb_typeof("group_key"."value" -> 0) = 'object'
\t\tAND "cell"."key" <> 'instance_id'
) "unpivoted";`;
}

/**
 * The reporting view set, in dependency order. No `CREATE SCHEMA`: the schema's lifecycle
 * belongs to whoever owns the environment.
 */
export function reportingViewStatements(schemas: ReportingViewSchemas): readonly string[] {
  return [responsesView(schemas), answersFlatView(schemas)];
}

/**
 * Replaces an existing reporting view set. `DROP` rather than `CREATE OR REPLACE`, because
 * replacing a view may not change its column list.
 */
export function replaceReportingViewStatements(schemas: ReportingViewSchemas): readonly string[] {
  return [
    `DROP VIEW IF EXISTS ${qualified(schemas.reporting, "answers_flat")};`,
    `DROP VIEW IF EXISTS ${qualified(schemas.reporting, "responses")};`,
    ...reportingViewStatements(schemas),
  ];
}

/**
 * A migration body, joined with drizzle-kit's own statement separator so a committed
 * migration file is byte-comparable against this generator.
 */
export function reportingViewMigrationSql(schemas: ReportingViewSchemas): string {
  return `${replaceReportingViewStatements(schemas).join("\n--> statement-breakpoint\n")}\n`;
}

/**
 * One workspace's view set inside one environment's reporting schema. Its views select
 * from the unprefixed pair and add nothing but the workspace filter, so the row inclusion
 * stays in one body: a per-workspace view that lost the tombstone anti-join would serve an
 * erased respondent's answers to an analyst.
 */
export interface WorkspaceReportingViews {
  /** `reporting_<env>`. */
  readonly reporting: string;
  /** Names the views. */
  readonly slug: string;
  /** Filters them. */
  readonly workspaceId: string;
  /** The control-plane schema holding `forms`. */
  readonly control: string;
}

/**
 * One workspace's pair, replaced in place so an adopter's BI tool keeps its connection and
 * the reconciliation stays idempotent.
 *
 * `WITH (security_barrier = true)` is the privilege boundary and a plain view is not one:
 * the planner may push a consumer's qual below the view's own filter and evaluate it
 * against the rows the view exists to hide, which a data-dependent error (a non-leakproof
 * `int4div`), a `COST 1` function in `pg_temp`, or a forced plan shape via the `USERSET`
 * `join_collapse_limit` can each report without any privilege. Revoking `TEMP` would not
 * be enough: the division probe needs no function at all.
 *
 * The option is deliberately not on the unfiltered pair, which only `qcms_app_<env>` may
 * read and which is a projection for that role rather than a boundary.
 */
export function workspaceReportingViewStatements(views: WorkspaceReportingViews): string[] {
  const predicate =
    `"w"."form_id" IN (\n` +
    `\tSELECT "form_id" FROM ${qualified(views.control, "forms")}\n` +
    `\tWHERE "workspace_id" = ${sqlLiteral(views.workspaceId)}\n` +
    `)`;
  return reportingViewColumns.map((contract) => {
    const source = qualified(views.reporting, contract.name);
    const target = qualified(views.reporting, `${views.slug}_${contract.name}`);
    const projection = contract.columns
      .map((column) => `\t"w"."${column}" AS "${column}"`)
      .join(",\n");
    return (
      `CREATE OR REPLACE VIEW ${target} WITH (security_barrier = true) AS\n` +
      `SELECT\n${projection}\nFROM ${source} "w"\nWHERE ${predicate};`
    );
  });
}

/** The view names one workspace's set holds in a reporting schema, in order. */
export function workspaceReportingViewNames(slug: string): readonly string[] {
  return reportingViewColumns.map((contract) => `${slug}_${contract.name}`);
}
