// The proposal is control-plane state and the endpoint is the environment's, so a
// confirmation cannot be one transaction. Claim on control (audit row in the same
// transaction), apply on the environment, then stamp applied: a failure part way leaves a
// confirmed proposal whose endpoint is not live, which is the direction this has to fail
// in.

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

export type EndpointChangeKind = "create" | "update" | "deactivate";

export const proposalFailures = {
  // Refused rather than silently replaced: two pending changes would let a confirmer
  // approve a value they read on a different screen.
  alreadyPending: (): ApiError =>
    new ApiError(
      "ENDPOINT_CHANGE_PENDING",
      409,
      "This endpoint already has a change waiting for a second approver. Confirm or " +
        "withdraw that one first.",
    ),
  notFound: (): ApiError =>
    new ApiError(
      "ENDPOINT_PROPOSAL_NOT_FOUND",
      404,
      "No such pending endpoint change for this form in this environment",
    ),
  // Also refused by a predicate in the claiming statement and by a CHECK on the table.
  selfConfirmation: (): ApiError =>
    new ApiError(
      "PROPOSER_CANNOT_CONFIRM",
      403,
      "You proposed this change, so you cannot confirm it. A different account holding " +
        "forms.approver with prod in scope has to.",
    ),
  notPending: (): ApiError =>
    new ApiError(
      "ENDPOINT_PROPOSAL_NOT_PENDING",
      409,
      "This endpoint change is no longer waiting: it has been confirmed or withdrawn. " +
        "Read the pending list and try again.",
    ),
} as const;

// Unique-violation (23505). Both keys that reach it are races this module settles rather
// than reports.
function isPendingKeyViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

// No URL in the audit detail: a workspace's `forms.owner` can read the audit and Q58 never
// gave them an unmasked endpoint URL.
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

// The caller has already validated the URL against the SSRF policy and encrypted the
// secret, so a stored proposal cannot be refused on apply.
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
  // Advisory only: the unique index is what makes two concurrent proposals impossible, and
  // the catch below turns the loser into the same 409.
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

// The apply runs in the proposal's own environment, and the caller must already have
// refused a mismatch: a `prod` proposal confirmed through a `test` request would have been
// authorised against `test`, where a `forms.editor` suffices.
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

  // The statement's predicate picks the winner of a race; `undefined` means somebody else
  // got there first.
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

// Finishes an apply that did not land. Not a second confirmation: the confirming account
// of record stays whoever claimed the row, so no new audit row is written.
export async function resumeEndpointProposal(
  deps: Deps,
  input: { readonly proposal: EndpointProposalRow; readonly confirmedBy: string },
): Promise<EndpointProposalRow> {
  if (input.proposal.proposedBy === input.confirmedBy) throw proposalFailures.selfConfirmation();
  return applyConfirmedProposal(deps, input.proposal);
}

// Idempotent by `webhook_id`, which is why that id is minted at propose time even for a
// `create`: a repeated apply writes the same row rather than a second endpoint.
async function applyConfirmedProposal(
  deps: Deps,
  proposal: EndpointProposalRow,
): Promise<EndpointProposalRow> {
  const exec = deps.databases.forRequest(proposal.environment).exec;
  await applyToEndpoint(exec, deps, proposal);
  // `undefined` means a concurrent resume stamped it first, which is the same end state.
  const stamped = await markEndpointProposalApplied(deps.databases.control, {
    proposalId: proposal.proposalId,
    appliedAt: deps.clock.now(),
  });
  return stamped ?? proposal;
}

// A null on the proposal means the act does not name that field, not "set it to null": a
// proposal that only flips `active` must not blank the URL its confirmer never looked at.
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
  // wins and the write becomes the update it would have been.
  const existing =
    proposal.kind === "create"
      ? await getWebhook(exec, proposal.formId, proposal.webhookId)
      : undefined;
  if (proposal.kind === "create" && existing === undefined) {
    // A primary-key violation here is an idempotent success: two resumes of the same
    // unapplied `create` can both read `undefined` above, and the loser's row is the one
    // this proposal describes anyway, so it falls through to the update.
    try {
      await insertWebhook(exec, {
        webhookId: proposal.webhookId,
        formId: proposal.formId,
        url: proposal.url ?? "",
        secretEncrypted: proposal.secretEncrypted ?? "",
        active: proposal.active ?? true,
      });
      return;
    } catch (error) {
      if (!isPendingKeyViolation(error)) throw error;
    }
  }
  await updateWebhook(exec, proposal.formId, proposal.webhookId, endpointPatch(proposal, now));
}

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

export function newProposalId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `wep_${hex}`;
}
