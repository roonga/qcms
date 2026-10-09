import { desc, eq, type SQL, sql } from "drizzle-orm";

import type { FormId, SessionId } from "@roonga/qcms-core";

import { erasureTombstones, reportingSchemaName } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AccessMode } from "./sessions.js";

/**
 * Reporting-view reads (task 023): the data-out vocabulary the admin response
 * slices call. These read the erasure-safe `responses` view, so **in-progress,
 * expired, and erased sessions are excluded by construction** - the tombstone
 * anti-join lives in the view, and no read here can bypass it. Shape-preserving
 * reads only (R5): filtering, ordering, and pagination, no business logic.
 *
 * ## The view set is per environment, and is the one thing here named by schema
 *
 * Under ADR-40 (Q10) the single `reporting` schema becomes **`reporting_<env>`**, one
 * per environment, each holding the same two view names - so a BI tool connects to one
 * environment's schema and its queries are otherwise unchanged. That schema is on **no
 * search path**, so unlike every data-plane table below it has to be named, which is
 * why each of these helpers takes the environment.
 *
 * `submissions` beside it stays **unqualified**: it is a data-plane table and the
 * connection's `search_path` is what chooses the environment's copy. The two are
 * consistent only because the environment the caller passes is the environment the pool
 * connects to, which criterion 6's per-environment integration test is what pins.
 *
 * The role grant is **Q52**: each `qcms_app_<env>` holds `USAGE` on its own
 * `reporting_<env>` and `SELECT` on that schema's views, and nothing at all on any
 * other environment's. The per-workspace split and the read-only consumer roles of Q26
 * are task 067's.
 *
 * The view is SQL-only (no Drizzle table object), so these helpers issue raw
 * `sql` fragments through the caller's {@link Executor} and hand-author explicit
 * row interfaces for the results (a raw `execute<T>` has no table to infer from).
 * Every value is interpolated (parameterized), never string-concatenated, and
 * every column is aliased to camelCase so the returned rows are ready for the API
 * layer to consume directly.
 */

/**
 * One row of `reporting.responses` - the erasure-safe response projection. A
 * `type` (not an `interface`) so it satisfies the Drizzle `execute<T>` row
 * constraint (`T extends Record<string, unknown>`, which named interfaces do not
 * meet - they lack an implicit index signature).
 */
export type ReportingResponseRow = {
  readonly sessionId: SessionId;
  readonly formId: FormId;
  readonly formVersion: number;
  readonly submittedAt: Date;
  readonly accessMode: AccessMode;
  /** The locked answer set, keyed by `questionId`, values in canonical encoding. */
  readonly answers: Record<string, unknown>;
};

/** A list row: a reporting row plus its anti-abuse flag (020), for the admin list. */
export type ResponseListRow = ReportingResponseRow & {
  /** `null` = clean submission; a non-null reason = flagged and withheld (020). */
  readonly flaggedReason: string | null;
};

/** A detail row: a list row plus the content hash (the audit anchor, 009). */
export type ResponseDetailRow = ResponseListRow & {
  readonly contentHash: string;
};

/** Filters shared by the list and export reads. */
export interface ResponseFilter {
  readonly formId: FormId;
  /** Restrict to one pinned form version. */
  readonly version?: number;
  /** Inclusive lower bound on `submittedAt`. */
  readonly from?: Date;
  /** Inclusive upper bound on `submittedAt`. */
  readonly to?: Date;
}

/**
 * Normalize a `timestamptz` read back from a raw `execute` to a `Date`. Drizzle's
 * query builder applies `mode: "date"` column mapping, but a raw `sql` read
 * returns the driver's value (a string), so reporting rows are normalized here -
 * the helpers' public types promise a `Date`.
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Normalize the `submittedAt` of a reporting row read via raw `execute`. */
function normalizeRow<T extends { submittedAt: Date }>(row: T): T {
  return { ...row, submittedAt: toDate(row.submittedAt) };
}

/** Build the shared `where` fragment for a {@link ResponseFilter} over alias `r`. */
function responseWhere(filter: ResponseFilter, flagged?: boolean): SQL {
  const conds: SQL[] = [sql`r.form_id = ${filter.formId}`];
  if (filter.version !== undefined) conds.push(sql`r.form_version = ${filter.version}`);
  if (filter.from !== undefined) conds.push(sql`r.submitted_at >= ${filter.from}`);
  if (filter.to !== undefined) conds.push(sql`r.submitted_at <= ${filter.to}`);
  if (flagged === true) conds.push(sql`sub.flagged_reason is not null`);
  if (flagged === false) conds.push(sql`sub.flagged_reason is null`);
  return sql.join(conds, sql` and `);
}

/**
 * `reporting_test` as a SQL identifier, for the one schema these reads must name.
 *
 * `sql.identifier` rather than interpolation, so the name is quoted by the driver and a
 * value that somehow reached here could not become SQL. Environment names are already
 * refused unless they match `^[a-z][a-z0-9]*$` by the operator command, which is the
 * control; this is the backstop under it.
 */
function reportingSchema(environment: string): SQL {
  return sql`${sql.identifier(reportingSchemaName(environment))}.${sql.identifier("responses")}`;
}

/**
 * A page of responses for the admin list, newest first, with the total matching
 * count for pagination. Joins `submissions` for the flag reason; because the
 * base is `reporting.responses`, erased and non-submitted sessions are already
 * excluded, so the join only adds `flagged_reason`.
 */
export async function listResponses(
  exec: Executor,
  environment: string,
  filter: ResponseFilter & { flagged?: boolean; limit: number; offset: number },
): Promise<{ rows: ResponseListRow[]; total: number }> {
  const where = responseWhere(filter, filter.flagged);
  const page = await exec.execute<ResponseListRow>(sql`
    select r.session_id as "sessionId", r.form_id as "formId", r.form_version as "formVersion",
           r.submitted_at as "submittedAt", r.access_mode as "accessMode", r.answers as "answers",
           sub.flagged_reason as "flaggedReason"
    from ${reportingSchema(environment)} r
    join submissions sub on sub.session_id = r.session_id
    where ${where}
    order by r.submitted_at desc, r.session_id desc
    limit ${filter.limit} offset ${filter.offset}
  `);
  const counted = await exec.execute<{ total: number }>(sql`
    select count(*)::int as "total"
    from ${reportingSchema(environment)} r
    join submissions sub on sub.session_id = r.session_id
    where ${where}
  `);
  return { rows: page.rows.map(normalizeRow), total: counted.rows[0]?.total ?? 0 };
}

/**
 * One response's full detail, or `undefined` when the session is not a
 * non-erased submitted response for this form. Reading through
 * `reporting.responses` is the erasure guarantee: an erased session is absent
 * from the view (tombstone anti-join), so this returns `undefined` and the
 * caller 404s - detail cannot bypass the exclusion.
 */
export async function getResponse(
  exec: Executor,
  environment: string,
  formId: FormId,
  sessionId: SessionId,
): Promise<ResponseDetailRow | undefined> {
  const res = await exec.execute<ResponseDetailRow>(sql`
    select r.session_id as "sessionId", r.form_id as "formId", r.form_version as "formVersion",
           r.submitted_at as "submittedAt", r.access_mode as "accessMode", r.answers as "answers",
           sub.flagged_reason as "flaggedReason", sub.content_hash as "contentHash"
    from ${reportingSchema(environment)} r
    join submissions sub on sub.session_id = r.session_id
    where r.form_id = ${formId} and r.session_id = ${sessionId}
    limit 1
  `);
  const row = res.rows[0];
  return row === undefined ? undefined : normalizeRow(row);
}

/**
 * A keyset page of reporting rows for export streaming, ordered by `session_id`
 * ascending and starting strictly after `afterSessionId`. Bounded by `limit`, so
 * a caller streaming a large export holds only one page in memory at a time
 * (never the whole table). Reads `reporting.responses` directly - erased and
 * non-submitted sessions are excluded by the view, so an export never leaks an
 * erased response. JSON export emits these rows verbatim; CSV projects them to
 * the requested version's columns.
 */
export async function fetchResponsePage(
  exec: Executor,
  environment: string,
  filter: ResponseFilter & { afterSessionId?: SessionId; limit: number },
): Promise<ReportingResponseRow[]> {
  const conds: SQL[] = [sql`r.form_id = ${filter.formId}`];
  if (filter.version !== undefined) conds.push(sql`r.form_version = ${filter.version}`);
  if (filter.from !== undefined) conds.push(sql`r.submitted_at >= ${filter.from}`);
  if (filter.to !== undefined) conds.push(sql`r.submitted_at <= ${filter.to}`);
  if (filter.afterSessionId !== undefined) conds.push(sql`r.session_id > ${filter.afterSessionId}`);
  const where = sql.join(conds, sql` and `);
  const res = await exec.execute<ReportingResponseRow>(sql`
    select r.session_id as "sessionId", r.form_id as "formId", r.form_version as "formVersion",
           r.submitted_at as "submittedAt", r.access_mode as "accessMode", r.answers as "answers"
    from ${reportingSchema(environment)} r
    where ${where}
    order by r.session_id asc
    limit ${filter.limit}
  `);
  return res.rows.map(normalizeRow);
}

/** A tombstone row - existence of an erased response without its content (I11). */
export interface TombstoneRow {
  readonly sessionId: SessionId;
  readonly formId: FormId;
  readonly formVersion: number;
  readonly erasedAt: Date;
  readonly reason: string;
}

/**
 * The erasure tombstones (compliance evidence), newest first, optionally scoped
 * to one form. Reads the `erasure_tombstones` table directly - tombstones are
 * the audit record of erasure and are never themselves excluded.
 */
export async function listTombstones(
  exec: Executor,
  opts: { formId?: FormId; limit?: number; offset?: number } = {},
): Promise<TombstoneRow[]> {
  const rows = await exec
    .select({
      sessionId: erasureTombstones.sessionId,
      formId: erasureTombstones.formId,
      formVersion: erasureTombstones.formVersion,
      erasedAt: erasureTombstones.erasedAt,
      reason: erasureTombstones.reason,
    })
    .from(erasureTombstones)
    .where(opts.formId === undefined ? undefined : eq(erasureTombstones.formId, opts.formId))
    .orderBy(desc(erasureTombstones.erasedAt), desc(erasureTombstones.sessionId))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
  return rows;
}

/**
 * Release a submission's anti-abuse flag - set `flagged_reason` to `NULL` - and
 * report whether *this* call performed the transition. The clear is conditional
 * (`... and flagged_reason is not null`), so the row lock lets exactly one caller
 * win the flip: `true` means this call released a genuinely-flagged submission
 * and the caller must now enqueue the withheld `response.submitted` event (020),
 * inside the same transaction; `false` means the submission was already clean (or
 * a concurrent unflag won) and no event is due - the idempotency the unflag route
 * relies on. Shape-preserving write (R5); the caller owns the transaction and the
 * event (R3).
 */
export async function clearSubmissionFlag(exec: Executor, sessionId: SessionId): Promise<boolean> {
  const res = await exec.execute<{ sessionId: SessionId }>(sql`
    update submissions
       set flagged_reason = null
     where session_id = ${sessionId} and flagged_reason is not null
    returning session_id as "sessionId"
  `);
  return res.rows.length > 0;
}
