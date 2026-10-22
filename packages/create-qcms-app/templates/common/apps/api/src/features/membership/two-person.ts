/**
 * The two-person rule for production (ADR-41's release rule, Q13, Q30, Q34, Q38, Q51;
 * task 070).
 *
 * # One switch, two mechanisms
 *
 * **One per-workspace switch governs both acts** (Q30), which is why this is one module
 * and not two: a release to `prod` and a change to a `prod` webhook endpoint are the two
 * acts in this design that can put production personal data somewhere new, and
 * `requireSecondApprover` on the workspace row (Q32, task 068) is the single thing that
 * turns the rule on for both. It is **off by default** (Q13), including on the workspace a
 * fresh database is seeded with: an installation with one administrator cannot satisfy the
 * rule at all, so defaulting it on would mean a bootstrapped deployment could not release
 * to `prod` until a second account existed.
 *
 * The two mechanisms the switch drives are **different shapes and the difference is
 * deliberate** (Q51):
 *
 *   - **A release is one act.** The version named already exists and can be judged in one
 *     look, so a `forms.approver` holding `prod` in scope who is *not* the account that
 *     published it releases it, and the approval is recorded on the release row.
 *     {@link approvalForRelease} is that check, and it answers the account to record.
 *   - **An endpoint change is two acts.** The proposed URL is a new value somebody has to
 *     read before it is live, so it is proposed, held pending and confirmed by a different
 *     account (`features/webhooks/propose.ts`, `control.webhook_endpoint_proposals`).
 *
 * They are not collapsed into one mechanism for symmetry: that is the question issue #998
 * raised and the Code Owner answered the other way.
 *
 * # It gates `prod` alone
 *
 * A release to `dev` or `test` is self-service for an editor holding that environment in
 * scope (finding 5), and a `dev` endpoint change is not gated either, because a `dev`
 * endpoint routes test data to a test consumer and gating it would cost a test cycle and
 * protect nothing. Extending it to another environment is out of scope **by decision**, not
 * by omission.
 *
 * # Two accounts, not two kinds of person
 *
 * One person may hold `forms.editor` and `forms.approver` together, so every check here is
 * on **accounts**: the account that published the version against the account releasing it,
 * and the proposing account against the confirming one. Which roles those accounts hold is
 * the middleware's question and was answered before any handler ran - a `prod` release and
 * a `prod` endpoint change already need `forms.approver` with `prod` in scope, a
 * `forms.owner` does not qualify (Q34), and a `forms.viewer` reaches neither (Q38).
 *
 * # Why the switch is read on the control pool
 *
 * It lives on `control.organization`, which **no environment role holds any privilege on**
 * (Q40). So the read is the control pool's, before any environment-pool work, exactly as
 * the membership resolution the middleware already made is.
 */

import { getWorkspace } from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";

import { ApiError } from "../../errors.js";
import { PRODUCTION_ENVIRONMENT } from "./policy.js";

/**
 * Whether the two-person rule applies to an act in one workspace and one environment.
 *
 * Both conditions, in this order, and the order is the cheap one first: the environment is
 * a string already in hand, and the workspace read only happens for an act in `prod`. A
 * workspace that is not there answers **true** rather than false - a missing workspace is
 * not a reason to skip a production control - and the handler's own `WORKSPACE_NOT_FOUND`
 * would have refused the request before this is asked in any mounted order.
 */
export async function twoPersonRuleApplies(
  exec: Executor,
  input: { readonly workspaceId: string | undefined; readonly environment: string | undefined },
): Promise<boolean> {
  if (input.environment !== PRODUCTION_ENVIRONMENT) return false;
  if (input.workspaceId === undefined) return true;
  const workspace = await getWorkspace(exec, input.workspaceId);
  return workspace === undefined ? true : workspace.requireSecondApprover;
}

/** The refusals this rule raises, as the envelope codes the admin app keys off. */
export const twoPersonFailures = {
  /**
   * The releasing account is the account that published the version (Q51, criterion 1).
   *
   * A **403** rather than a 409: the request is well formed and the version is releasable,
   * and what is missing is authority this account cannot acquire by retrying. The message
   * says what would make it work, which is another approver rather than another attempt.
   */
  selfApproval: (version: number): ApiError =>
    new ApiError(
      "APPROVER_IS_AUTHOR",
      403,
      `This workspace requires a second approver for production, and you published ` +
        `version ${version}. A different account holding forms.approver with prod in scope ` +
        `has to release it.`,
    ),
  /**
   * The version carries no publishing account, so the rule cannot be checked.
   *
   * Only reachable for a version published before task 070 added `published_by`, and only
   * while the switch is on. **Refused rather than allowed**, which is the conservative
   * reading: the check compares two accounts and one of them is unknown, so "a different
   * account released it" is not something this deployment can claim. Publishing a new
   * version clears it, because every publish from this task onward records its author.
   */
  unknownAuthor: (version: number): ApiError =>
    new ApiError(
      "APPROVER_UNKNOWN_AUTHOR",
      409,
      `Version ${version} was published before this deployment recorded publishing ` +
        `accounts, so the second-approver rule cannot be checked against it. Publish a new ` +
        `version and release that, or turn the workspace's second-approver setting off.`,
    ),
} as const;

/**
 * Refuse a `prod` release by the account that published the version, and answer the
 * approval to record on the release row.
 *
 * The answer is **the account to write into `form_releases.approved_by`**, or `undefined`
 * when no approval was required - which is how criterion 3 stays true by construction: with
 * the switch off, nothing is compared, nothing is written, and the row is byte-for-byte the
 * row task 065 wrote. An implementation that asked for an approver and then accepted the
 * same account would have changed the default's behaviour while appearing to keep it, which
 * is the trap the work order names.
 *
 * `author` is the version's `published_by`: the account that **published** it, not whoever
 * last edited the draft (Q51), so a draft several editors touched has exactly one author.
 */
export async function approvalForRelease(
  exec: Executor,
  input: {
    readonly workspaceId: string | undefined;
    readonly environment: string;
    readonly version: number;
    readonly author: string | null;
    readonly releasedBy: string;
  },
): Promise<string | undefined> {
  const applies = await twoPersonRuleApplies(exec, {
    workspaceId: input.workspaceId,
    environment: input.environment,
  });
  if (!applies) return undefined;
  if (input.author === null) throw twoPersonFailures.unknownAuthor(input.version);
  if (input.author === input.releasedBy) throw twoPersonFailures.selfApproval(input.version);
  return input.releasedBy;
}
