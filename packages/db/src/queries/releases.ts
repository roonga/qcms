import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import { formReleases } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * One row of `control.form_releases`. Hand-authored: `$inferSelect` degrades through the emitted `.d.ts` for
 * a branded table.
 */
export interface FormReleaseRow {
  formId: FormId;
  environment: string;
  version: number;
  sequence: number;
  fromEnvironment: string | null;
  releasedBy: string;
  approvedBy: string | null;
  /** The newest row for the pair is the answer, as it is for the version. */
  closed: boolean;
  releasedAt: Date;
}

export type _FormReleaseRowMatchesTable = AssignableTo<
  FormReleaseRow,
  typeof formReleases.$inferSelect
> &
  AssignableTo<typeof formReleases.$inferSelect, FormReleaseRow>;

/** A release row plus whether it moved the environment backwards. */
export interface FormReleaseHistoryRow extends FormReleaseRow {
  /** `null` when this was the environment's first release of the form. */
  readonly replacedVersion: number | null;
  /** Derived, never stored: a stored flag could disagree with the version numbers. */
  readonly rollback: boolean;
}

/**
 * Record a release of a published version into one environment; a promotion writes a row and copies
 * nothing. `fromEnvironment` is `undefined` for a first release or hotfix. Call inside the caller's
 * transaction, beside the `form.released` enqueue.
 */
export async function insertFormRelease(
  exec: Executor,
  input: {
    formId: FormId;
    environment: string;
    version: number;
    releasedBy: string;
    fromEnvironment?: string | null;
    approvedBy?: string | null;
    closed?: boolean;
    releasedAt?: Date;
  },
): Promise<FormReleaseRow> {
  const [row] = await exec
    .insert(formReleases)
    .values({
      formId: input.formId,
      environment: input.environment,
      version: input.version,
      sequence: sql<number>`(select coalesce(max(${formReleases.sequence}), 0) + 1
        from ${formReleases}
       where ${formReleases.formId} = ${input.formId}
         and ${formReleases.environment} = ${input.environment})`,
      releasedBy: input.releasedBy,
      fromEnvironment: input.fromEnvironment ?? null,
      approvedBy: input.approvedBy ?? null,
      ...(input.closed === undefined ? {} : { closed: input.closed }),
      ...(input.releasedAt === undefined ? {} : { releasedAt: input.releasedAt }),
    })
    .returning();
  return row!;
}

/**
 * Which version is released in one environment and whether intake is closed. `undefined`
 * means never released there, which is neither open nor closed.
 */
export interface FormEnvironmentState {
  readonly version: number;
  readonly closed: boolean;
  /** When the newest row for the pair was written: a release, a close or a reopen. */
  readonly releasedAt: Date;
}

/** The form's released version and closed reading in one environment. */
export async function getFormEnvironmentState(
  exec: Executor,
  formId: FormId,
  environment: string,
): Promise<FormEnvironmentState | undefined> {
  const row = await getReleasedVersion(exec, formId, environment);
  return row === undefined
    ? undefined
    : { version: row.version, closed: row.closed, releasedAt: row.releasedAt };
}

/** {@link getReleasedVersion}'s reading for every form in one environment, in one query. */
export async function environmentStatesByForm(
  exec: Executor,
  environment: string,
  formIds?: readonly FormId[],
): Promise<Map<FormId, FormEnvironmentState>> {
  if (formIds !== undefined && formIds.length === 0) return new Map();
  const narrowed =
    formIds === undefined
      ? sql``
      : sql` and ${formReleases.formId} in (${sql.join(
          formIds.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const rows = await exec.execute<{
    form_id: FormId;
    version: number;
    closed: boolean;
    released_at: Date | string;
  }>(
    sql`select distinct on (${formReleases.formId})
               ${formReleases.formId} as form_id,
               ${formReleases.version} as version,
               ${formReleases.closed} as closed,
               ${formReleases.releasedAt} as released_at
          from ${formReleases}
         where ${formReleases.environment} = ${environment}${narrowed}
         order by ${formReleases.formId}, ${formReleases.sequence} desc`,
  );
  return new Map(
    rows.rows.map((row) => [
      row.form_id,
      {
        version: Number(row.version),
        closed: row.closed,
        releasedAt: row.released_at instanceof Date ? row.released_at : new Date(row.released_at),
      },
    ]),
  );
}

/**
 * When each named form was last released to any environment, in one query.
 *
 * A different question from {@link environmentStatesByForm}, which answers what is
 * serving in one environment.
 */
export async function lastReleaseAtByForm(
  exec: Executor,
  formIds: readonly FormId[],
): Promise<Map<FormId, Date>> {
  if (formIds.length === 0) return new Map();
  const rows = await exec
    .select({
      formId: formReleases.formId,
      lastReleaseAt: sql<Date | string>`max(${formReleases.releasedAt})`.as("last_release_at"),
    })
    .from(formReleases)
    .where(inArray(formReleases.formId, [...formIds]))
    .groupBy(formReleases.formId);
  return new Map(
    rows.map((row) => [
      row.formId,
      row.lastReleaseAt instanceof Date ? row.lastReleaseAt : new Date(row.lastReleaseAt),
    ]),
  );
}

/**
 * Close a form to new sessions in one environment, by appending a release-state row that
 * carries the released version forward with `closed` set.
 *
 * Returns `undefined` when the form has nothing released there. The caller must also
 * refuse closing an already-closed environment, which would otherwise append a second row.
 */
export async function closeFormInEnvironment(
  exec: Executor,
  input: { formId: FormId; environment: string; closedBy: string },
): Promise<FormReleaseRow | undefined> {
  return setClosedInEnvironment(exec, input.formId, input.environment, input.closedBy, true);
}

/** Reopen a closed form to new sessions in one environment. */
export async function reopenFormInEnvironment(
  exec: Executor,
  input: { formId: FormId; environment: string; reopenedBy: string },
): Promise<FormReleaseRow | undefined> {
  return setClosedInEnvironment(exec, input.formId, input.environment, input.reopenedBy, false);
}

// Call inside a transaction: a release landing between the read and the append would be
// closed over with the earlier version.
async function setClosedInEnvironment(
  exec: Executor,
  formId: FormId,
  environment: string,
  actor: string,
  closed: boolean,
): Promise<FormReleaseRow | undefined> {
  const current = await getReleasedVersion(exec, formId, environment);
  if (current === undefined) return undefined;
  return insertFormRelease(exec, {
    formId,
    environment,
    version: current.version,
    releasedBy: actor,
    fromEnvironment: null,
    // Carrying the approval forward would make the audit say a close was approved by
    // somebody who only approved a release.
    approvedBy: null,
    closed,
  });
}

/**
 * The version released to one environment, which a new session resolves instead of the newest published
 * one. Ordered by `sequence`, not `released_at`: two releases in one microsecond would be indistinguishable.
 */
export async function getReleasedVersion(
  exec: Executor,
  formId: FormId,
  environment: string,
): Promise<FormReleaseRow | undefined> {
  const [row] = await exec
    .select()
    .from(formReleases)
    .where(and(eq(formReleases.formId, formId), eq(formReleases.environment, environment)))
    .orderBy(desc(formReleases.sequence))
    .limit(1);
  return row;
}

/**
 * The release history of one form, newest first, with each rollback marked. Every
 * environment's rows unless `environment` narrows it.
 */
export async function listFormReleases(
  exec: Executor,
  formId: FormId,
  environment?: string,
): Promise<FormReleaseHistoryRow[]> {
  const replaced = sql<number | null>`lag(${formReleases.version}) over (
    partition by ${formReleases.environment} order by ${formReleases.sequence})`;
  const rows = await exec
    .select({
      formId: formReleases.formId,
      environment: formReleases.environment,
      version: formReleases.version,
      sequence: formReleases.sequence,
      fromEnvironment: formReleases.fromEnvironment,
      releasedBy: formReleases.releasedBy,
      approvedBy: formReleases.approvedBy,
      closed: formReleases.closed,
      releasedAt: formReleases.releasedAt,
      replacedVersion: replaced.as("replaced_version"),
    })
    .from(formReleases)
    .where(
      environment === undefined
        ? eq(formReleases.formId, formId)
        : and(eq(formReleases.formId, formId), eq(formReleases.environment, environment)),
    )
    .orderBy(desc(formReleases.releasedAt), desc(formReleases.sequence));

  return rows.map((row) => ({
    ...row,
    // The cast keeps the comparison numeric whatever the driver's integer mode is.
    replacedVersion: row.replacedVersion === null ? null : Number(row.replacedVersion),
    rollback: row.replacedVersion !== null && Number(row.replacedVersion) > row.version,
  }));
}

/**
 * Every version of a form ever released to any environment. Was released, not is
 * released: a version rolled away from still reached an environment.
 */
export async function listReleasedVersions(exec: Executor, formId: FormId): Promise<number[]> {
  const rows = await exec
    .selectDistinct({ version: formReleases.version })
    .from(formReleases)
    .where(eq(formReleases.formId, formId))
    .orderBy(desc(formReleases.version));
  return rows.map((row) => row.version);
}
