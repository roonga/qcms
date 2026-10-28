import { enqueueInEnvironment, insertFormRelease } from "@roonga/qcms-db";
import type { Executor, FormReleaseRow } from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

export const FORM_RELEASED = "form.released" as const;

export interface ReleaseInput {
  readonly formId: FormId;
  readonly environment: string;
  readonly version: number;
  readonly releasedBy: string;
  /** Absent for a first release or a hotfix: it records the path and authorises nothing (Q4). */
  readonly fromEnvironment?: string | undefined;
  /**
   * Absent where the two-person rule required no approval. The caller decides it, because
   * deciding it is a refusal as well as a value (`../membership/two-person.ts`).
   */
  readonly approvedBy?: string | undefined;
  /**
   * The caller passes the environment's current value, which is what makes "a release does
   * not reopen a closed environment" a property of the state rather than of a handler.
   */
  readonly closed?: boolean | undefined;
}

/**
 * Must be called inside the caller's transaction on the control pool: the record and its
 * `form.released` event commit or roll back together, so neither is observed alone.
 */
export async function recordRelease(tx: Executor, input: ReleaseInput): Promise<FormReleaseRow> {
  const release = await insertFormRelease(tx, {
    formId: input.formId,
    environment: input.environment,
    version: input.version,
    releasedBy: input.releasedBy,
    fromEnvironment: input.fromEnvironment ?? null,
    approvedBy: input.approvedBy ?? null,
    closed: input.closed ?? false,
  });
  await enqueueInEnvironment(tx, input.environment, {
    eventType: FORM_RELEASED,
    payload: {
      formId: release.formId,
      version: release.version,
      environment: release.environment,
      fromEnvironment: release.fromEnvironment,
      releasedBy: release.releasedBy,
      releasedAt: release.releasedAt.toISOString(),
      approvedBy: release.approvedBy,
      // On the event so a consumer acting on "version 4 is released to prod" can tell
      // that prod is not accepting sessions.
      closed: release.closed,
    },
  });
  return release;
}
