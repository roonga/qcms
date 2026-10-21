/**
 * The pending `prod` endpoint change: propose, confirm, withdraw and apply (Q30, Q51;
 * task 070, carrying task 067's criterion 8a).
 *
 * # Why an endpoint change is two acts where a release is one
 *
 * Q51 gives the two-person rule two shapes deliberately. A release names a version that
 * already exists and can be judged in one look, so it is one act. **An endpoint change is a
 * new value somebody has to read before it is live**, so it is proposed, held pending and
 * confirmed by a different account - and until it is confirmed it takes effect on nothing:
 * the live endpoint rows in `data_<env>.webhooks` are untouched, so the deliverer keeps
 * posting to the URL that was already agreed and the proposed URL receives nothing at all.
 *
 * SEC-14's per-environment egress allowlist stays the network backstop underneath, because
 * an endpoint that should not have been set is still an endpoint a firewall can refuse.
 *
 * # The two pools, and why the order is the conservative one
 *
 * The proposal is control-plane state and the endpoint is the environment's, so a
 * confirmation cannot be one transaction (`@roonga/qcms-db`'s
 * `schema/control/endpoint-proposals.ts` says why the proposal lives where it does). Three
 * steps, in this order:
 *
 *   1. **claim**, on the control pool: one conditional `UPDATE` stamps the confirming
 *      account, so two confirmations racing cannot both win, and the SEC-15 row rides the
 *      same transaction (Q61) so a confirmation cannot exist without a record of it;
 *   2. **apply**, on that environment's pool: the endpoint write, idempotent by the
 *      `webhook_id` the proposal minted;
 *   3. **stamp applied**, on the control pool.
 *
 * A failure between 1 and 3 leaves a row saying `confirmed_at` with `applied_at` null, and
 * **the endpoint is not live**. That is the direction this control has to fail in: the
 * alternative order would leave production personal data flowing to a new URL with nothing
 * recording who agreed to it. The resume path is a second confirmation, which
 * {@link resumeEndpointProposal} serves for a row already claimed by a different account
 * than the proposer.
 *
 * # What the audit row carries, and what it does not
 *
 * Every propose, confirm and withdraw writes a SEC-15 row of kind `setting` (Q61), with the
 * environment and the form filled in because the act names both. **The URL is not in it.**
 * The audit is readable by a workspace's `forms.owner`, who is not in the `forms` family at
 * all and whom Q58 never gave an unmasked endpoint URL; putting the proposed URL in a
 * `detail` would route round that ruling through the audit screen. The proposal row carries
 * the URL and the endpoint read applies Q58's masking to it.
 */

import {
  confirmEndpointProposal,
  deactivateWebhook,
  getWebhook,
  hasPendingEndpointProposal,
  insertEndpointProposal,
  insertWebhook,
  markEndpointProposalApplied,
  updateWebhook,
  withdrawEndpointProposal,
  writeAccessAuditRow,
  type EndpointProposalRow,
  type Executor,
} from "@roonga/qcms-db";

import type { FormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";

/** The three configure acts a proposal can carry. */
export type EndpointChangeKind = "create" | "update" | "deactivate";

/** The refusals this mechanism raises. */
export const proposalFailures = {
  /**
   * A second pending change to the same endpoint.
   *
   * A 409 rather than a silent replacement. Two pending changes would make "confirm this
   * one" ambiguous, and the confirmation of the second would overwrite a value its own
   * confirmer had read in a different screen. The unique index refuses it at the database
   * too, and this is what makes the answer a sentence rather than a constraint violation.
   */
  alreadyPending: (): ApiError =>
    new ApiError(
      "ENDPOINT_CHANGE_PENDING",
      409,
      "This endpoint already has a change waiting for a second approver. Confirm or " +
        "withdraw that one first.",
    ),
  /** No such proposal in this form and this environment. */
  notFound: (): ApiError =>
    new ApiError(
      "ENDPOINT_PROPOSAL_NOT_FOUND",
      404,
      "No such pending endpoint change for this form in this environment",
    ),
  /**
   * The confirming account is the proposing one (Q51, criterion 7).
   *
   * A **403**: the request is well formed and what is missing is a second account, which
   * no retry by this one can supply. This is the whole point of the mechanism, so it is
   * refused here, by a predicate in the claiming statement, and by a CHECK on the table.
   */
  selfConfirmation: (): ApiError =>
    new ApiError(
      "PROPOSER_CANNOT_CONFIRM",
      403,
      "You proposed this change, so you cannot confirm it. A different account holding " +
        "forms.approver with prod in scope has to.",
    ),
  /** Somebody else confirmed or withdrew it first. */
  notPending: (): ApiError =>
    new ApiError(
      "ENDPOINT_PROPOSAL_NOT_PENDING",
      409,
      "This endpoint change is no longer waiting: it has been confirmed or withdrawn. " +
        "Read the pending list and try again.",
    ),
} as const;

/** Whether a driver error is a unique-violation (23505), which here is the pending index. */
function isPendingKeyViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

/** The `detail` one of these acts writes to its SEC-15 row. See the header for what is absent. */
function auditDetail(
  act: "propose" | "confirm" | "withdraw",
  proposal: EndpointProposalRow,
  extra?: string,
): string {
  return (
    `setting=webhook.endpoint act=${act} change=${proposal.kind} ` +
    `endpoint=${proposal.webhookId} proposal=${proposal.proposalId}` +
    (extra === undefined ? "" : ` ${extra}`)
  );
}

/**
 * Store a proposed change pending, with its audit row, in one transaction on the control
 * pool.
 *
 * The caller has already validated whatever the act carries - the URL against the SSRF
 * policy, the secret encrypted - because a proposal of a value that would be refused on
 * apply is a proposal that wastes a second approver's attention.
 */
export async function proposeEndpointChange(
  deps: Deps,
  input: {
    readonly proposalId: string;
    readonly formId: FormId;
    readonly environment: string;
    readonly webhookId: string;
    readonly kind: EndpointChangeKind;
    readonly url?: string | undefined;
    readonly secretEncrypted?: string | undefined;
    readonly active?: boolean | undefined;
    readonly proposedBy: string;
    readonly workspaceId: string;
  },
): Promise<EndpointProposalRow> {
  const exec = deps.databases.control;
  // Read before write so the ordinary case is a sentence rather than a constraint
  // violation; the unique index is still what makes two concurrent proposals impossible,
  // and the catch below is what turns the loser into the same 409.
  if (await hasPendingEndpointProposal(exec, input.environment, input.webhookId)) {
    throw proposalFailures.alreadyPending();
  }

  try {
    return await exec.transaction(async (tx) => {
      const proposal = await insertEndpointProposal(tx, {
        proposalId: input.proposalId,
        formId: input.formId,
        environment: input.environment,
        webhookId: input.webhookId,
        kind: input.kind,
        url: input.url ?? null,
        secretEncrypted: input.secretEncrypted ?? null,
        active: input.active ?? null,
        proposedBy: input.proposedBy,
        proposedAt: deps.clock.now(),
      });
      await writeAccessAuditRow(tx, {
        actor: input.proposedBy,
        workspaceId: input.workspaceId,
        // Q61: the environment and the form are filled in because this act names both.
        environment: input.environment,
        formId: input.formId,
        kind: "setting",
        detail: auditDetail("propose", proposal),
        occurredAt: deps.clock.now(),
      });
      return proposal;
    });
  } catch (error) {
    if (isPendingKeyViolation(error)) throw proposalFailures.alreadyPending();
    throw error;
  }
}

/**
 * Confirm a pending change: claim it for the confirming account, apply it, stamp it
 * applied.
 *
 * **The proposal's own environment is what the apply runs in**, and the caller has already
 * refused a mismatch against the environment the request was authorised for. That is the
 * rule PR #1061's review wrote, applied one layer along: a proposal for `prod` confirmed by
 * a request whose switcher said `test` would have been authorised against `test`, where a
 * `forms.editor` suffices.
 */
export async function confirmEndpointChange(
  deps: Deps,
  input: {
    readonly proposal: EndpointProposalRow;
    readonly confirmedBy: string;
    readonly workspaceId: string;
  },
): Promise<EndpointProposalRow> {
  const { proposal } = input;
  if (proposal.proposedBy === input.confirmedBy) throw proposalFailures.selfConfirmation();

  // Step 1: claim, with the audit row in the same transaction. The predicate is what picks
  // the winner of a race; `undefined` means somebody else got there first.
  const claimed = await deps.databases.control.transaction(async (tx) => {
    const row = await confirmEndpointProposal(tx, {
      proposalId: proposal.proposalId,
      confirmedBy: input.confirmedBy,
      confirmedAt: deps.clock.now(),
    });
    if (row === undefined) return undefined;
    await writeAccessAuditRow(tx, {
      actor: input.confirmedBy,
      workspaceId: input.workspaceId,
      environment: row.environment,
      formId: row.formId,
      kind: "setting",
      detail: auditDetail("confirm", row, `proposer=${row.proposedBy}`),
      occurredAt: deps.clock.now(),
    });
    return row;
  });
  if (claimed === undefined) throw proposalFailures.notPending();

  return applyConfirmedProposal(deps, claimed);
}

/**
 * Finish a confirmation whose apply did not land, without recording a second confirmation.
 *
 * The resume path the two-pool order above costs. It is **not** a second confirmation: the
 * confirming account of record stays whoever claimed the row, so the two-person property is
 * untouched, and no new audit row is written because no new act was performed - the act was
 * recorded when it happened and this is the mechanical consequence completing.
 *
 * A caller reaching it still had to pass the same gate as a confirmation (`webhook:
 * configure` in `prod`, which is a `forms.approver`'s cell) and is still refused if they
 * are the proposer, so it is not a way round anything.
 */
export async function resumeEndpointProposal(
  deps: Deps,
  input: { readonly proposal: EndpointProposalRow; readonly confirmedBy: string },
): Promise<EndpointProposalRow> {
  if (input.proposal.proposedBy === input.confirmedBy) throw proposalFailures.selfConfirmation();
  return applyConfirmedProposal(deps, input.proposal);
}

/**
 * Steps 2 and 3: write the endpoint in its own environment, then stamp the proposal
 * applied.
 *
 * Idempotent by `webhook_id`, which is why that id is minted at propose time even for a
 * `create`: a repeated apply writes the same row rather than a second endpoint.
 */
async function applyConfirmedProposal(
  deps: Deps,
  proposal: EndpointProposalRow,
): Promise<EndpointProposalRow> {
  const exec = deps.databases.forRequest(proposal.environment).exec;
  await applyToEndpoint(exec, deps, proposal);
  // `undefined` here means a concurrent resume stamped it first, which is the same end
  // state: the row is applied and the endpoint is live. The proposal as it stands is
  // returned so the caller answers with a consistent body either way.
  const stamped = await markEndpointProposalApplied(deps.databases.control, {
    proposalId: proposal.proposalId,
    appliedAt: deps.clock.now(),
  });
  return stamped ?? proposal;
}

/**
 * The columns one proposal changes on the endpoint row, as an update patch.
 *
 * A null on the proposal means "this act does not name that field" rather than "set it to
 * null", which is why each one is spread conditionally: a proposal that only flips `active`
 * must not blank the URL its confirmer never looked at.
 */
function endpointPatch(
  proposal: EndpointProposalRow,
  now: Date,
): {
  url?: string;
  secretEncrypted?: string;
  active?: boolean;
  deactivatedAt?: Date | null;
  now: Date;
} {
  return {
    ...(proposal.url === null ? {} : { url: proposal.url }),
    ...(proposal.secretEncrypted === null ? {} : { secretEncrypted: proposal.secretEncrypted }),
    ...(proposal.active === null
      ? {}
      : { active: proposal.active, deactivatedAt: proposal.active ? null : now }),
    now,
  };
}

/** The endpoint write one proposal describes, in its own environment's data plane. */
async function applyToEndpoint(
  exec: Executor,
  deps: Deps,
  proposal: EndpointProposalRow,
): Promise<void> {
  const now = deps.clock.now();
  if (proposal.kind === "deactivate") {
    await deactivateWebhook(exec, proposal.formId, proposal.webhookId, now);
    return;
  }
  // A repeated apply of a `create` must not mint a second endpoint, so an existing row
  // wins and the write becomes the update it would have been. The id is minted at propose
  // time precisely so this is decidable (`newProposalId`'s sibling in `handler.ts`).
  const existing =
    proposal.kind === "create"
      ? await getWebhook(exec, proposal.formId, proposal.webhookId)
      : undefined;
  if (proposal.kind === "create" && existing === undefined) {
    // `url` and `secret_encrypted` are `NOT NULL` on the endpoint, and a `create` proposal
    // always carries both: the create route validated the URL and encrypted the secret
    // before it proposed anything.
    await insertWebhook(exec, {
      webhookId: proposal.webhookId,
      formId: proposal.formId,
      url: proposal.url ?? "",
      secretEncrypted: proposal.secretEncrypted ?? "",
      active: proposal.active ?? true,
    });
    return;
  }
  await updateWebhook(exec, proposal.formId, proposal.webhookId, endpointPatch(proposal, now));
}

/** Withdraw a pending change, with its audit row, in one transaction on the control pool. */
export async function withdrawEndpointChange(
  deps: Deps,
  input: {
    readonly proposal: EndpointProposalRow;
    readonly withdrawnBy: string;
    readonly workspaceId: string;
  },
): Promise<EndpointProposalRow> {
  const withdrawn = await deps.databases.control.transaction(async (tx) => {
    const row = await withdrawEndpointProposal(tx, {
      proposalId: input.proposal.proposalId,
      withdrawnBy: input.withdrawnBy,
      withdrawnAt: deps.clock.now(),
    });
    if (row === undefined) return undefined;
    await writeAccessAuditRow(tx, {
      actor: input.withdrawnBy,
      workspaceId: input.workspaceId,
      environment: row.environment,
      formId: row.formId,
      kind: "setting",
      detail: auditDetail("withdraw", row, `proposer=${row.proposedBy}`),
      occurredAt: deps.clock.now(),
    });
    return row;
  });
  if (withdrawn === undefined) throw proposalFailures.notPending();
  return withdrawn;
}

/** A fresh `wep_` proposal id: 16 random hex bytes, like the `whk_` id one table over. */
export function newProposalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `wep_${hex}`;
}
