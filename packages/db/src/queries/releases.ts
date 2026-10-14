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
      ...(input.releasedAt === undefined ? {} : { releasedAt: input.releasedAt }),
    })
    .returning();
  return row!;
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
