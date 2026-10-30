import { desc, eq, type SQL, sql } from "drizzle-orm";

import type { FormId, SessionId } from "@roonga/qcms-core";

import { erasureTombstones, reportingSchemaName } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AccessMode } from "./sessions.js";

// Reads of the erasure-safe `responses` view; `reporting_<env>` is named but `submissions` stays unqualified,
// so they agree only because the environment is the pool's own. Interpolate every value, never
// string-concatenate.

/**
 * One row of the erasure-safe response projection. A `type` rather than an `interface`
 * to satisfy Drizzle's `execute<T>` row constraint.
 */
export type ReportingResponseRow = {
  readonly sessionId: SessionId;
  readonly formId: FormId;
  readonly formVersion: number;
  readonly submittedAt: Date;
  readonly accessMode: AccessMode;
  /** The locked answer set, keyed by `questionId`. */
  readonly answers: Record<string, unknown>;
};

/** A reporting row plus its anti-abuse flag, for the admin list. */
export type ResponseListRow = ReportingResponseRow & {
  /** `null` is a clean submission; a reason means flagged and withheld. */
  readonly flaggedReason: string | null;
};

/** A list row plus the content hash, the audit anchor. */
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

// A raw `sql` read bypasses Drizzle's column mapping and returns the driver's string,
// but these helpers promise a `Date`.
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeRow<T extends { submittedAt: Date }>(row: T): T {
  return { ...row, submittedAt: toDate(row.submittedAt) };
}

function responseWhere(filter: ResponseFilter, flagged?: boolean): SQL {
  const conds: SQL[] = [sql`r.form_id = ${filter.formId}`];
  if (filter.version !== undefined) conds.push(sql`r.form_version = ${filter.version}`);
  if (filter.from !== undefined) conds.push(sql`r.submitted_at >= ${filter.from}`);
  if (filter.to !== undefined) conds.push(sql`r.submitted_at <= ${filter.to}`);
  if (flagged === true) conds.push(sql`sub.flagged_reason is not null`);
  if (flagged === false) conds.push(sql`sub.flagged_reason is null`);
  return sql.join(conds, sql` and `);
}

// `sql.identifier` rather than interpolation, so a value reaching here cannot become
// SQL; the operator command's `^[a-z][a-z0-9]*$` check is the primary control.
function reportingSchema(environment: string): SQL {
  return sql`${sql.identifier(reportingSchemaName(environment))}.${sql.identifier("responses")}`;
}

/** A page of responses for the admin list, newest first, with the total matching count. */
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
 * One response's full detail, or `undefined` when the session is not a non-erased
 * submitted response for this form.
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
 * A keyset page of reporting rows for export streaming, starting strictly after
 * `afterSessionId`, so a large export holds one page in memory at a time.
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

/** How many responses one form has in one environment, submitted and still open. */
export interface ResponseCounts {
  /** Submitted and not erased: the rows the response list would show. */
  readonly submitted: number;
  /** Started and neither submitted, expired nor erased. */
  readonly inProgress: number;
}

/**
 * {@link ResponseCounts} for several forms in one environment, in two grouped queries.
 *
 * `submitted` comes from the erasure-safe `responses` view, so an erased response is not
 * counted; `inProgress` is counted from `sessions`, which has no such view. It authorises
 * nothing and writes no audit row: the caller establishes `response: read` per form.
 */
export async function responseCountsByForm(
  exec: Executor,
  environment: string,
  formIds: readonly FormId[],
): Promise<Map<FormId, ResponseCounts>> {
  if (formIds.length === 0) return new Map();
  const ids = sql.join(
    formIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const submitted = await exec.execute<{ formId: FormId; count: number }>(sql`
    select r.form_id as "formId", count(*)::int as "count"
    from ${reportingSchema(environment)} r
    where r.form_id in (${ids})
    group by r.form_id
  `);
  const open = await exec.execute<{ formId: FormId; count: number }>(sql`
    select s.form_id as "formId", count(*)::int as "count"
    from sessions s
    where s.form_id in (${ids}) and s.status in ('created', 'in_progress')
    group by s.form_id
  `);

  const counts = new Map<FormId, ResponseCounts>();
  for (const id of formIds) counts.set(id, { submitted: 0, inProgress: 0 });
  for (const row of submitted.rows) {
    const existing = counts.get(row.formId);
    if (existing !== undefined) counts.set(row.formId, { ...existing, submitted: row.count });
  }
  for (const row of open.rows) {
    const existing = counts.get(row.formId);
    if (existing !== undefined) counts.set(row.formId, { ...existing, inProgress: row.count });
  }
  return counts;
}

/** A tombstone row: the existence of an erased response without its content. */
export interface TombstoneRow {
  readonly sessionId: SessionId;
  readonly formId: FormId;
  readonly formVersion: number;
  readonly erasedAt: Date;
  readonly reason: string;
}

/** The erasure tombstones, newest first, optionally scoped to one form. */
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
 * Response metadata, with no answer column selected and no answer table joined, so the
 * row type carries no field an answer value could arrive in (SEC-17).
 */
export type ResponseMetadataRow = {
  readonly sessionId: SessionId;
  readonly formId: FormId;
  readonly formVersion: number;
  /** Absent once the session row has been swept, while the submission remains. */
  readonly startedAt: Date | null;
  readonly submittedAt: Date;
  readonly accessMode: AccessMode;
  readonly flagged: boolean;
  readonly flaggedReason: string | null;
};

function normalizeMetadata(row: ResponseMetadataRow): ResponseMetadataRow {
  return {
    ...row,
    submittedAt: toDate(row.submittedAt),
    startedAt: row.startedAt === null ? null : toDate(row.startedAt),
  };
}

const METADATA_COLUMNS = sql`
  r.session_id as "sessionId", r.form_id as "formId", r.form_version as "formVersion",
  r.submitted_at as "submittedAt", r.access_mode as "accessMode",
  s.created_at as "startedAt",
  sub.flagged_reason is not null as "flagged", sub.flagged_reason as "flaggedReason"
`;

/** {@link listResponses}' page, metadata only. */
export async function listResponseMetadata(
  exec: Executor,
  environment: string,
  filter: ResponseFilter & { flagged?: boolean; limit: number; offset: number },
): Promise<{ rows: ResponseMetadataRow[]; total: number }> {
  const where = responseWhere(filter, filter.flagged);
  const page = await exec.execute<ResponseMetadataRow>(sql`
    select ${METADATA_COLUMNS}
    from ${reportingSchema(environment)} r
    join submissions sub on sub.session_id = r.session_id
    left join sessions s on s.session_id = r.session_id
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
  return { rows: page.rows.map(normalizeMetadata), total: counted.rows[0]?.total ?? 0 };
}

/** {@link getResponse}'s row, metadata only. */
export async function getResponseMetadata(
  exec: Executor,
  environment: string,
  formId: FormId,
  sessionId: SessionId,
): Promise<ResponseMetadataRow | undefined> {
  const res = await exec.execute<ResponseMetadataRow>(sql`
    select ${METADATA_COLUMNS}
    from ${reportingSchema(environment)} r
    join submissions sub on sub.session_id = r.session_id
    left join sessions s on s.session_id = r.session_id
    where r.form_id = ${formId} and r.session_id = ${sessionId}
    limit 1
  `);
  const row = res.rows[0];
  return row === undefined ? undefined : normalizeMetadata(row);
}

/**
 * Release a submission's anti-abuse flag, reporting whether this call performed the
 * transition; the conditional clear lets exactly one caller win the flip.
 *
 * On `true` the caller must enqueue the withheld `response.submitted` event in the same
 * transaction.
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
