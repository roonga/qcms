import { and, desc, eq, sql } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import { formReleases } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * One row of `control.form_releases`. Hand-authored (issue #5), like `FormRow`.
 *
 * `$inferSelect` resolves soundly inside this package and degrades across the emitted
 * `.d.ts` for a table whose columns carry a `$type<>` brand, which `form_releases` does
 * through `FormId`: a consumer then sees an `error` type, `tsc` hides it under
 * `skipLibCheck`, and `typescript-eslint` surfaces it as an unsafe assignment in
 * `apps/api`. The drift guard below keeps this interface in lockstep with the table, so a
 * column added, dropped or retyped in `schema/control/releases.ts` stops compiling here
 * until this is brought back into step.
 */
export interface FormReleaseRow {
  formId: FormId;
  environment: string;
  version: number;
  sequence: number;
  fromEnvironment: string | null;
  releasedBy: string;
  approvedBy: string | null;
  /**
   * Whether this row leaves the form **closed to new sessions in this environment**
   * (Q18, task 066). The newest row for the pair is the answer, exactly as it is for
   * the version.
   */
  closed: boolean;
  releasedAt: Date;
}

// Both directions, so any column change in `schema/control/releases.ts` breaks this
// instantiation until `FormReleaseRow` matches the table again.
export type _FormReleaseRowMatchesTable = AssignableTo<
  FormReleaseRow,
  typeof formReleases.$inferSelect
> &
  AssignableTo<typeof formReleases.$inferSelect, FormReleaseRow>;

/**
 * A release row with the one thing the history needs that the row does not carry: that
 * it moved the environment **backwards** (ADR-40, criterion 4).
 */
export interface FormReleaseHistoryRow extends FormReleaseRow {
  /**
   * The version this release replaced in that environment, or `null` when it was the
   * environment's first release of the form.
   */
  readonly replacedVersion: number | null;
  /**
   * Whether this release is a **rollback**: it released a version older than the one it
   * replaced in that environment.
   *
   * **Derived, never typed** (ADR-40). An administrator rolling back during an incident
   * is doing the one thing a release history has to be legible about, and a flag somebody
   * ticks is a flag that can disagree with the two version numbers sitting beside it.
   * There is no second mechanism and no second code path: rolling back is releasing an
   * earlier version, and this is the reading of what that row means.
   */
  readonly rollback: boolean;
}

/**
 * Record a release of a published version into one environment (ADR-40).
 *
 * **Promotion writes a row and copies nothing.** `formId` and `version` are unchanged by
 * a promotion, which is what keeps the version history shared and the audit continuous
 * (R1, R6, ADR-02, ADR-18); `fromEnvironment` records the path when there was one, and is
 * `undefined` for a first release or a hotfix straight into its target (Q4).
 *
 * `sequence` is assigned by a scalar subquery in the same INSERT, exactly as
 * `insertFormVersion` assigns a version number, so two concurrent releases into one
 * environment cannot both claim the same place in the history: the composite primary key
 * `(form_id, environment, sequence)` is the backstop and the loser retries.
 *
 * **Call this inside the caller's transaction, beside the `form.released` enqueue** (Q49).
 * The event and the record commit or roll back together, so neither is ever observed
 * without the other; the API's release handler is the one caller and
 * `enqueueInEnvironment` is the other half.
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
 * The form's state in one environment, as a screen and the respondent path read it
 * (Q18, task 066): which version is released there and whether intake is closed.
 *
 * Two readings of one row, which is why they are one type. `undefined` from
 * {@link getFormEnvironmentState} means the form has never been released there, which is
 * neither open-and-serving nor closed: nothing is released, so a start refuses with
 * `NO_PUBLISHED_VERSION` and a screen renders the status as `open` because nobody has
 * closed anything.
 */
export interface FormEnvironmentState {
  readonly version: number;
  readonly closed: boolean;
}

/**
 * The form's released version **and** closed reading in one environment (Q18).
 *
 * The respondent path's one read: `start-session` needs both before it spends anything,
 * and asking twice would be two round trips for two columns of one row. Runs on an
 * **environment** pool there, which holds `SELECT` on `control.form_releases` (Q48's
 * six-table read list) and needs no new grant for the closed state, which is the reason
 * Q18 is built as a value of the release state rather than as a table beside it.
 */
export async function getFormEnvironmentState(
  exec: Executor,
  formId: FormId,
  environment: string,
): Promise<FormEnvironmentState | undefined> {
  const row = await getReleasedVersion(exec, formId, environment);
  return row === undefined ? undefined : { version: row.version, closed: row.closed };
}

/**
 * The newest release row per form in one environment, keyed by form id.
 *
 * What the admin's form library reads to render each row's status for the environment
 * the Q6 switcher has selected: one query for the whole list rather than one per form,
 * because the list is the one screen that asks the question N times.
 *
 * `distinct on (form_id)` with a descending `sequence` is the newest row per form, the
 * same reading {@link getReleasedVersion} takes for one form, and it is served by the
 * `form_releases_environment_idx` index whose leading column is the environment.
 */
export async function environmentStatesByForm(
  exec: Executor,
  environment: string,
): Promise<Map<FormId, FormEnvironmentState>> {
  const rows = await exec.execute<{ form_id: FormId; version: number; closed: boolean }>(
    sql`select distinct on (${formReleases.formId})
               ${formReleases.formId} as form_id,
               ${formReleases.version} as version,
               ${formReleases.closed} as closed
          from ${formReleases}
         where ${formReleases.environment} = ${environment}
         order by ${formReleases.formId}, ${formReleases.sequence} desc`,
  );
  return new Map(
    rows.rows.map((row) => [row.form_id, { version: Number(row.version), closed: row.closed }]),
  );
}

/**
 * Close a form to new sessions **in one environment** (Q18, task 066), by appending a
 * release-state row that carries the released version forward with `closed` set.
 *
 * An append rather than an update, because this table is append-only at the database
 * (`form_releases_reject_update`) and because the history is then the audit answer to
 * "who closed `prod` intake, and when" for free.
 *
 * Returns `undefined` when the form has nothing released in that environment. There is
 * no state to close: a start there already refuses with `NO_PUBLISHED_VERSION`, and a
 * row carrying no version is not expressible - `version` is `NOT NULL` and keyed into
 * `control.form_versions`. The caller turns that into a legible refusal.
 *
 * Idempotent in effect and not in rows: closing an already-closed environment appends a
 * second closed row. The caller refuses that case, so the history stays a record of acts
 * that changed something.
 */
export async function closeFormInEnvironment(
  exec: Executor,
  input: { formId: FormId; environment: string; closedBy: string },
): Promise<FormReleaseRow | undefined> {
  return setClosedInEnvironment(exec, input.formId, input.environment, input.closedBy, true);
}

/** Reopen a closed form to new sessions in one environment (Q18). The mirror of close. */
export async function reopenFormInEnvironment(
  exec: Executor,
  input: { formId: FormId; environment: string; reopenedBy: string },
): Promise<FormReleaseRow | undefined> {
  return setClosedInEnvironment(exec, input.formId, input.environment, input.reopenedBy, false);
}

/**
 * The shared half of close and reopen: read the pair's newest row, append its twin with
 * the flag set as asked.
 *
 * **Call it inside a transaction when the refusal matters.** Both callers do: the read
 * and the append have to agree about what was released, or a release landing between
 * them would be closed over with the earlier version.
 */
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
    // No source environment: nothing was promoted. `fromEnvironment` records a path a
    // version took, and intake stopping is not one (Q4's null spelling).
    fromEnvironment: null,
    // The approval belongs to the release it was given for, not to a later close
    // (Q51, task 070). Carrying it forward would make the audit say a close was
    // approved by somebody who approved a release.
    approvedBy: null,
    closed,
  });
}

/**
 * The version released to one environment, or `undefined` when none is.
 *
 * **This replaces "the newest published version" on the respondent path** (ADR-40): what
 * a new session resolves is what is released *here*, so a version released to `test` and
 * not to `prod` is served in `test` and refused in `prod` (criterion 1). A session
 * already open is untouched, because it pins its version at start and nothing re-pins it
 * (ADR-07, invariant I4, Q5).
 *
 * The newest row for the pair is `max(sequence)`, which the primary key serves by a
 * backward index scan. Deliberately **not** `order by released_at`: two releases in one
 * microsecond would be indistinguishable that way, and which version is serving is the
 * one thing this read may not be ambiguous about.
 *
 * Runs on an **environment** pool on the respondent path, which holds `SELECT` on
 * `control.form_releases` (Q48's six-table read list, granted by this table's own
 * migration).
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
 * The release history of one form, newest first, with each rollback marked (criterion 4).
 *
 * Every environment's rows together, because "released version 4 after version 7" is read
 * beside "and `test` is on 8": an incident review asks what happened to this form, not
 * what happened to this form in one place. `environment` narrows it when a screen wants
 * one column.
 *
 * `replacedVersion` is `lag(version)` over the environment's own sequence, so the
 * rollback reading is computed in the one place the predecessor is cheap to reach rather
 * than by the caller re-joining the list to itself.
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
    // Postgres hands a window function's integer back through the driver; the cast keeps
    // the comparison numeric whatever the driver's integer mode is.
    replacedVersion: row.replacedVersion === null ? null : Number(row.replacedVersion),
    rollback: row.replacedVersion !== null && Number(row.replacedVersion) > row.version,
  }));
}

/**
 * Every version of a form that has been released to **any** environment, at any time.
 *
 * The input to the version list's "released anywhere" filter, which is one of the two
 * presentation mitigations finding 2 accepted: every iteration an author tries in `dev`
 * is an immutable published version and R1 keeps it, so a week of iterating leaves a long
 * list. The churn is accepted rather than designed away - promotion is a record and not a
 * copy, and no cheaper mechanism keeps the audit promise - so what this serves is a
 * filter, and **the filter's default shows every version** so nothing is hidden by
 * surprise.
 *
 * "Was released", not "is released": a version released and then rolled away from is
 * still a version that reached an environment, and hiding it would make the filter a
 * worse answer than the unfiltered list.
 */
export async function listReleasedVersions(exec: Executor, formId: FormId): Promise<number[]> {
  const rows = await exec
    .selectDistinct({ version: formReleases.version })
    .from(formReleases)
    .where(eq(formReleases.formId, formId))
    .orderBy(desc(formReleases.version));
  return rows.map((row) => row.version);
}
