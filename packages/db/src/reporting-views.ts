/**
 * The `reporting` view set as a **generator** rather than as a literal migration
 * body (task 075, ADR-42, ADR-10, `docs/reporting-view.md`).
 *
 * ## Why a generator
 *
 * Under ADR-40 the data plane is a schema per environment and the view set goes
 * with it (`reporting_<env>`), and after task 068 there is a view set per
 * workspace as well. A view whose SQL is a literal string inside one migration
 * cannot be created a second time under a second schema name without copying it,
 * and a copy is what drifts. So the DDL is a function of its schema names, the
 * migration body is this function's output, and {@link reportingViewColumns} is
 * the one list `docs/reporting-view.md`'s drift test compares the live catalogue
 * against. Tasks 064 and 067 call the same function with their own names.
 *
 * ## What changed in 075, and why it had to
 *
 * `reporting.responses.answers` was built with
 * `jsonb_object_agg(item ->> 'questionId', item -> 'value')`. Two locked answers
 * for one `questionId` is exactly what a repeating group produces (ADR-42), and
 * `jsonb_object_agg` **silently keeps one of them** - no error, no warning. That
 * is the data-loss window this task closes, and it is why 075 sits before the
 * two remaining presentations in the build order.
 *
 * The shape ruled for it (Q18, Code Owner, 2026-09-29):
 *
 * - every answer **outside** a group keeps its `questionId -> value` entry, so a
 *   form with no group produces a **byte-identical** `answers` object;
 * - every answer **inside** a group is carried under **one key per group id**,
 *   holding an ordered array of `{"instance_id": "ins_...", "<questionId>": value, ...}`;
 * - `reporting.answers_flat` gains a nullable `instance_id` and its grain becomes
 *   `(session, questionId, instanceId)`. Appending a column is a **minor**
 *   `@roonga/qcms-db` release under the documented stability promise.
 *
 * ## Where the group id comes from, and why it is the roster and not the definition
 *
 * A `LockedAnswer` is `{questionId, instanceId?, value}` (task 071): it names the
 * instance and **not** the group. Two tables could supply the missing half, and
 * the choice matters because losing an answer here is the thing this change
 * exists to stop:
 *
 * - **`answer_group_instances`** (chosen). A mint wrote one row per instance id
 *   for this session, so `instance_id -> group_id` is total over every instance
 *   id a locked answer can name, and it is a single indexed lookup on the
 *   session. It is also **data-plane only**, which keeps `reporting_<env>`
 *   reading `data_<env>` and nothing else when task 064 splits the schemas.
 * - `form_versions.definition`, walked for `items[].groupId`. Equally total, but
 *   it puts a control-plane join inside a per-environment view and re-walks a
 *   JSONB definition once per exported row.
 *
 * Totality is what makes the inner join below safe: `prepareSubmission` sets
 * `instanceId` only for a question the evaluator expanded from a group, and an
 * instance id exists only because a mint recorded it. Erasure and the retention
 * purge delete the roster rows and the submission in one transaction, so the two
 * cannot fall out of step in one direction either.
 *
 * ## Ordering
 *
 * The locked answer array is already in document order for questions and roster
 * order for instances (ADR-42, section 5.3 of the plan), and `canonicalJson`
 * preserves array order. So instance order is recovered from the array's own
 * `WITH ORDINALITY` position - first appearance of each instance id - rather than
 * from a second read of the roster, which would be a second source of truth for
 * an order the submission already froze.
 */

/** A view in the reporting schema, with its documented column list in order. */
export interface ReportingViewContract {
  readonly name: string;
  readonly columns: readonly string[];
}

/**
 * The documented column list of each reporting view, in ordinal order.
 *
 * `instance_id` is **appended** to `answers_flat` rather than inserted beside
 * `question_id`: column order is not part of the stability promise, but
 * "appended" is the shape the promise calls a minor change, and a consumer
 * selecting `*` keeps the positions it had.
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
   * `answer_group_instances` (later `data_<env>`). Omitted leaves them
   * unqualified, which is what the launch schema does: one data plane on the
   * connection's search path.
   */
  readonly data?: string | undefined;
}

/** `"reporting"."responses"`, or `"responses"` when no schema is given. */
function qualified(schema: string | undefined, table: string): string {
  return schema === undefined ? `"${table}"` : `"${schema}"."${table}"`;
}

/**
 * `CREATE VIEW "<reporting>"."responses"`: one row per submitted, non-erased
 * session, answers in a single JSONB object.
 *
 * Row inclusion is unchanged and stays **in the view**: `sessions.status =
 * 'submitted'` plus the `erasure_tombstones` anti-join, so no consumer query can
 * read a non-submitted or erased response (ADR-17, `docs/reporting-view.md`).
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
\t\t\t\tmin("repeated"."ordinality") AS "first_seen",
\t\t\t\tjsonb_build_object('instance_id', "repeated"."instance_id")
\t\t\t\t\t|| jsonb_object_agg("repeated"."question_id", "repeated"."value") AS "instance"
\t\t\tFROM (
\t\t\t\tSELECT
\t\t\t\t\t"elem"."item" ->> 'questionId' AS "question_id",
\t\t\t\t\t"elem"."item" ->> 'instanceId' AS "instance_id",
\t\t\t\t\t"elem"."item" -> 'value' AS "value",
\t\t\t\t\t"elem"."ordinality" AS "ordinality"
\t\t\t\tFROM jsonb_array_elements("sub"."locked_answers" -> 'answers')
\t\t\t\t\tWITH ORDINALITY AS "elem"("item", "ordinality")
\t\t\t\tWHERE "elem"."item" ? 'instanceId'
\t\t\t) "repeated"
\t\t\tJOIN (
\t\t\t\tSELECT DISTINCT "agi"."instance_id" AS "instance_id", "agi"."group_id" AS "group_id"
\t\t\t\tFROM ${roster} "agi"
\t\t\t\tWHERE "agi"."session_id" = "sub"."session_id"
\t\t\t) "roster" ON "roster"."instance_id" = "repeated"."instance_id"
\t\t\tGROUP BY "roster"."group_id", "repeated"."instance_id"
\t\t) "instances"
\t\tGROUP BY "instances"."group_id"
\t) "merged"
) "agg" ON true
WHERE "s"."status" = 'submitted'
\tAND "t"."session_id" IS NULL;`;
}

/**
 * `CREATE VIEW "<reporting>"."answers_flat"`: the long projection, one row per
 * `(submitted session, questionId, instanceId)`.
 *
 * Still derived from `reporting.responses`, so it inherits that view's row
 * inclusion exactly and there is no second exclusion rule to keep in step.
 *
 * **Telling a group array from a multiChoice array.** Both are JSONB arrays under
 * a key, so the split is structural rather than by key spelling: a group's value
 * is an array of **objects**, while a multiChoice value is an array of option id
 * **strings**. `jsonb_typeof(value -> 0) IS DISTINCT FROM 'object'` is written
 * with `IS DISTINCT FROM` because `-> 0` on a non-array is SQL NULL, and a plain
 * `<>` there would make the whole predicate NULL and drop every scalar answer.
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
 * The statements that create the reporting view set, in dependency order
 * (`answers_flat` reads `responses`).
 *
 * `CREATE SCHEMA` is deliberately **not** here: migration 0003 created the
 * launch schema and task 064's baseline creates one per environment, so the
 * schema's lifecycle belongs to whoever owns the environment rather than to the
 * view bodies.
 */
export function reportingViewStatements(schemas: ReportingViewSchemas): readonly string[] {
  return [responsesView(schemas), answersFlatView(schemas)];
}

/**
 * The statements that **replace** an existing reporting view set with the current
 * one: drop the dependent view first, then recreate both.
 *
 * `DROP` rather than `CREATE OR REPLACE`, because replacing a view may not change
 * its column list and `answers_flat` gains one. `IF EXISTS` so the same body can
 * run against a schema that has no view set yet.
 */
export function replaceReportingViewStatements(schemas: ReportingViewSchemas): readonly string[] {
  return [
    `DROP VIEW IF EXISTS ${qualified(schemas.reporting, "answers_flat")};`,
    `DROP VIEW IF EXISTS ${qualified(schemas.reporting, "responses")};`,
    ...reportingViewStatements(schemas),
  ];
}

/**
 * A migration body: the replacement statements joined with drizzle-kit's own
 * statement separator, so a committed migration file is byte-comparable against
 * this generator (`reporting-views.test.ts` asserts exactly that, which is what
 * keeps the generator and the applied SQL one thing).
 */
export function reportingViewMigrationSql(schemas: ReportingViewSchemas): string {
  return `${replaceReportingViewStatements(schemas).join("\n--> statement-breakpoint\n")}\n`;
}
