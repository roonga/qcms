/**
 * The release transaction: the record and its event, together (ADR-40, Q49).
 *
 * # Why this is a module and not a line in a handler
 *
 * Two routes release a version - `POST /forms/{id}/releases` here, and
 * `POST /forms/{id}/publish-and-release` in the forms slice, which is finding 2's
 * combined action. Both have to write **the row and the event in one transaction**, and a
 * second copy of that pairing is a second place for one of the two halves to go missing.
 * So the pairing is one function, and the transaction boundary stays the caller's (R5).
 *
 * # The event
 *
 * Q49: publishing queues nothing and releasing queues `form.released`, into **that
 * environment's** `outbox`, in the same transaction as the release record, so neither is
 * ever observed without the other. Task 064 removed the publish enqueue (Q60) and shipped
 * the helper; this task is its first caller.
 *
 * Three facts about that write are each load-bearing:
 *
 *   - **It runs on the control pool.** The release record lives in `control` and one
 *     transaction is one connection, so the connection is the control pool, whose
 *     `search_path` is `control` alone. That is why `enqueueInEnvironment` names the
 *     schema: an unqualified `outbox` resolves to nothing there.
 *   - **It has no `RETURNING`.** `qcms_app_control` holds `INSERT` on each
 *     `data_<env>.outbox` and no other privilege of any kind in any data schema, and
 *     `INSERT ... RETURNING` is a read. Widening that grant is not available: an outbox
 *     payload carries respondent answers, and an authoring credential that can read them
 *     is the property the three-role split exists to remove.
 *   - **It is queued and not delivered** (Q55). The deliverer fans out
 *     `response.submitted` only, so no subscriber sees anything. Whether form events ever
 *     reach endpoints is a separate, later feature with its own payload contract, and
 *     nothing here designs it.
 */

import { enqueueInEnvironment, insertFormRelease } from "@roonga/qcms-db";
import type { Executor, FormReleaseRow } from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

/**
 * The event type a release queues (Q49). `form.published` is retired and was removed by
 * task 064; nothing queues it anywhere.
 */
export const FORM_RELEASED = "form.released" as const;

/** What a release needs beyond the transaction it is written in. */
export interface ReleaseInput {
  readonly formId: FormId;
  readonly environment: string;
  readonly version: number;
  /** The administrator who released it: the admin principal's own user id. */
  readonly releasedBy: string;
  /** Where it was promoted from, absent for a first release or a hotfix (Q4). */
  readonly fromEnvironment?: string | undefined;
  /**
   * The approving account, where the two-person rule required one (Q51, task 070), and
   * **absent where it did not** - which is every release outside `prod` and every release
   * in a workspace whose `requireSecondApprover` switch is off.
   *
   * The caller decides it, because deciding it is a refusal as well as a value
   * (`../membership/two-person.ts`): a release the rule refuses never reaches this
   * function. What rides the transaction here is only the recording, so an approval cannot
   * be observed without the release it approved, nor the release without its approval.
   */
  readonly approvedBy?: string | undefined;
  /**
   * Whether this row leaves the environment **closed** to new sessions (Q18, task 066).
   *
   * The caller reads the environment's current value and passes it, which is what makes
   * "a release does not reopen a closed environment" a property of the state rather than
   * of a handler's good manners: closing `prod` is a deliberate operational act, and
   * releasing a version there is not a request to resume intake. Absent means open,
   * which is right for a form's first release into an environment.
   */
  readonly closed?: boolean | undefined;
}

/**
 * Write the release record and queue `form.released` beside it.
 *
 * **Must be called inside the caller's transaction on the control pool.** The two writes
 * commit or roll back together, which is criterion 8: exactly one `form.released` row
 * into the released environment's `outbox`, never observed without its record.
 *
 * The payload carries the form, the version, the environment and who released it, plus
 * the time and the source environment, because an event that says less than the row it
 * accompanies is an event a consumer has to come back and ask about.
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
      // The approving account where the two-person rule required one (Q51, task 070), and
      // null where it did not. On the event for the reason `releasedBy` is: a consumer
      // reading "version 4 is released to prod" and acting on it should not have to come
      // back and ask who agreed to it.
      approvedBy: release.approvedBy,
      // The intake state the release leaves behind (Q18). On the event because a
      // consumer reading "version 4 is released to prod" and acting on it would
      // otherwise have no way to know prod is not accepting sessions.
      closed: release.closed,
    },
  });
  return release;
}
