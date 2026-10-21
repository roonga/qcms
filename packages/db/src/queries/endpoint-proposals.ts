import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import {
  type EndpointProposalKind,
  webhookEndpointProposals,
} from "../schema/control/endpoint-proposals.js";
import type { Executor } from "./executor.js";

/**
 * The pending `prod` endpoint change: its writes and its reads (Q30, Q51; task 070).
 *
 * Every statement here runs on the **control** pool, because the proposal is control-plane
 * state (`schema/control/endpoint-proposals.ts` says why) and `qcms_app_control` is the only
 * application role with any privilege on the table. The one step that is not here is the
 * **apply**, which writes `data_<env>.webhooks` on that environment's own pool.
 *
 * # Why the state transitions are conditional updates and not read-then-write
 *
 * {@link confirmEndpointProposal} and {@link withdrawEndpointProposal} both carry their
 * precondition in the `WHERE` clause and answer `undefined` when it did not hold. Two
 * confirmations racing would otherwise both read a pending row, both decide they were first,
 * and both apply - and the second would overwrite a production endpoint with a value its own
 * confirmer never saw. One `UPDATE` with `confirmed_at is null` in its predicate makes the
 * database pick the winner, and the loser gets a 409.
 */

/** One proposal row as the API reads it. */
export interface EndpointProposalRow {
  readonly proposalId: string;
  readonly formId: FormId;
  readonly environment: string;
  readonly webhookId: string;
  readonly kind: EndpointProposalKind;
  readonly url: string | null;
  readonly secretEncrypted: string | null;
  readonly active: boolean | null;
  readonly proposedBy: string;
  readonly proposedAt: Date;
  readonly confirmedBy: string | null;
  readonly confirmedAt: Date | null;
  readonly appliedAt: Date | null;
  readonly withdrawnBy: string | null;
  readonly withdrawnAt: Date | null;
}

/** The columns every read selects, so one shape reaches the API from every query here. */
const COLUMNS = {
  proposalId: webhookEndpointProposals.proposalId,
  formId: webhookEndpointProposals.formId,
  environment: webhookEndpointProposals.environment,
  webhookId: webhookEndpointProposals.webhookId,
  kind: webhookEndpointProposals.kind,
  url: webhookEndpointProposals.url,
  secretEncrypted: webhookEndpointProposals.secretEncrypted,
  active: webhookEndpointProposals.active,
  proposedBy: webhookEndpointProposals.proposedBy,
  proposedAt: webhookEndpointProposals.proposedAt,
  confirmedBy: webhookEndpointProposals.confirmedBy,
  confirmedAt: webhookEndpointProposals.confirmedAt,
  appliedAt: webhookEndpointProposals.appliedAt,
  withdrawnBy: webhookEndpointProposals.withdrawnBy,
  withdrawnAt: webhookEndpointProposals.withdrawnAt,
} as const;

/** Launder the `kind` text column, which the CHECK pins, into the union. */
function row(value: {
  readonly kind: string;
  readonly formId: string;
  readonly [key: string]: unknown;
}): EndpointProposalRow {
  return { ...value, kind: value.kind as EndpointProposalKind } as EndpointProposalRow;
}

/**
 * Store a proposed change pending.
 *
 * **Call inside the caller's transaction, beside its SEC-15 row** (Q61): a proposal that
 * exists without the audit row recording who proposed it is the one failure this control may
 * not have, which is the reasoning task 069 uses for a grant one plane over.
 *
 * The unique index `webhook_endpoint_proposals_one_pending` refuses a second pending change
 * to the same endpoint, and the caller turns that into a 409 rather than a 500.
 */
export async function insertEndpointProposal(
  exec: Executor,
  input: {
    readonly proposalId: string;
    readonly formId: FormId;
    readonly environment: string;
    readonly webhookId: string;
    readonly kind: EndpointProposalKind;
    readonly url?: string | null;
    readonly secretEncrypted?: string | null;
    readonly active?: boolean | null;
    readonly proposedBy: string;
    readonly proposedAt?: Date;
  },
): Promise<EndpointProposalRow> {
  const [inserted] = await exec
    .insert(webhookEndpointProposals)
    .values({
      proposalId: input.proposalId,
      formId: input.formId,
      environment: input.environment,
      webhookId: input.webhookId,
      kind: input.kind,
      url: input.url ?? null,
      secretEncrypted: input.secretEncrypted ?? null,
      active: input.active ?? null,
      proposedBy: input.proposedBy,
      ...(input.proposedAt === undefined ? {} : { proposedAt: input.proposedAt }),
    })
    .returning(COLUMNS);
  return row(inserted!);
}

/** One proposal by id, whatever state it is in, or `undefined`. */
export async function getEndpointProposal(
  exec: Executor,
  proposalId: string,
): Promise<EndpointProposalRow | undefined> {
  const [found] = await exec
    .select(COLUMNS)
    .from(webhookEndpointProposals)
    .where(eq(webhookEndpointProposals.proposalId, proposalId))
    .limit(1);
  return found === undefined ? undefined : row(found);
}

/**
 * The proposals for one form in one environment that **nobody has resolved yet**, newest
 * first, plus the confirmed ones whose apply has not landed.
 *
 * The second half is not tidiness: a confirmation whose apply failed leaves a row saying
 * `confirmed_at` with `applied_at` null, the endpoint is **not** live, and the screen has to
 * show it or the operator reads an endpoint list that is simply missing their change. A
 * withdrawn proposal and a fully applied one are history and are read from the audit.
 */
export async function listOpenEndpointProposals(
  exec: Executor,
  formId: FormId,
  environment: string,
): Promise<readonly EndpointProposalRow[]> {
  const rows = await exec
    .select(COLUMNS)
    .from(webhookEndpointProposals)
    .where(
      and(
        eq(webhookEndpointProposals.formId, formId),
        eq(webhookEndpointProposals.environment, environment),
        isNull(webhookEndpointProposals.withdrawnAt),
        isNull(webhookEndpointProposals.appliedAt),
      ),
    )
    .orderBy(desc(webhookEndpointProposals.proposedAt));
  return rows.map((found) => row(found));
}

/**
 * Whether one endpoint already has a pending change, which is what the propose path checks
 * before it mints an id.
 */
export async function hasPendingEndpointProposal(
  exec: Executor,
  environment: string,
  webhookId: string,
): Promise<boolean> {
  const [found] = await exec
    .select({ proposalId: webhookEndpointProposals.proposalId })
    .from(webhookEndpointProposals)
    .where(
      and(
        eq(webhookEndpointProposals.environment, environment),
        eq(webhookEndpointProposals.webhookId, webhookId),
        isNull(webhookEndpointProposals.confirmedAt),
        isNull(webhookEndpointProposals.withdrawnAt),
      ),
    )
    .limit(1);
  return found !== undefined;
}

/**
 * Claim a pending proposal for one confirming account, or answer `undefined`.
 *
 * `undefined` means the proposal was not pending: already confirmed, already withdrawn, or
 * not there at all. The caller cannot tell those apart from this answer and does not need
 * to - it reads the row to say which, and the three are one 409 to a caller who raced.
 *
 * **The confirming account is never the proposing one.** The predicate says so as well as
 * the handler, and the `webhook_endpoint_proposals_second_account` CHECK says so a third
 * time: this is the one rule the whole mechanism exists for, so it is written at every layer
 * that could enforce it rather than at the one that happens to run first.
 *
 * Claiming happens **before** the apply and in the same transaction as the confirmation's
 * SEC-15 row, which is the conservative order: a failure after this leaves a row that says
 * somebody confirmed and `applied_at` null, with the endpoint not yet live. The other order
 * would leave production personal data flowing to a new URL with nothing recording who
 * agreed to it.
 */
export async function confirmEndpointProposal(
  exec: Executor,
  input: {
    readonly proposalId: string;
    readonly confirmedBy: string;
    readonly confirmedAt?: Date;
  },
): Promise<EndpointProposalRow | undefined> {
  const [updated] = await exec
    .update(webhookEndpointProposals)
    .set({
      confirmedBy: input.confirmedBy,
      confirmedAt: input.confirmedAt ?? sql`now()`,
    })
    .where(
      and(
        eq(webhookEndpointProposals.proposalId, input.proposalId),
        isNull(webhookEndpointProposals.confirmedAt),
        isNull(webhookEndpointProposals.withdrawnAt),
        sql`${webhookEndpointProposals.proposedBy} <> ${input.confirmedBy}`,
      ),
    )
    .returning(COLUMNS);
  return updated === undefined ? undefined : row(updated);
}

/**
 * Stamp a confirmed proposal as applied, once the endpoint write has landed in
 * `data_<env>.webhooks`.
 *
 * Separate from the confirmation because the two commit on **different pools**: the
 * proposal is control-plane state and the endpoint is the environment's, so one transaction
 * cannot hold both. The column is what makes the gap legible rather than silent.
 */
export async function markEndpointProposalApplied(
  exec: Executor,
  input: { readonly proposalId: string; readonly appliedAt?: Date },
): Promise<EndpointProposalRow | undefined> {
  const [updated] = await exec
    .update(webhookEndpointProposals)
    .set({ appliedAt: input.appliedAt ?? sql`now()` })
    .where(
      and(
        eq(webhookEndpointProposals.proposalId, input.proposalId),
        isNull(webhookEndpointProposals.appliedAt),
      ),
    )
    .returning(COLUMNS);
  return updated === undefined ? undefined : row(updated);
}

/**
 * Withdraw a pending proposal, or answer `undefined` when it was not pending.
 *
 * Either account may withdraw: the proposer changing their mind and a second approver
 * refusing the change are the same act on the row, and which it was is in the audit. A
 * confirmed proposal cannot be withdrawn - the change has been agreed, and unpicking it is
 * a new proposal.
 */
export async function withdrawEndpointProposal(
  exec: Executor,
  input: {
    readonly proposalId: string;
    readonly withdrawnBy: string;
    readonly withdrawnAt?: Date;
  },
): Promise<EndpointProposalRow | undefined> {
  const [updated] = await exec
    .update(webhookEndpointProposals)
    .set({
      withdrawnBy: input.withdrawnBy,
      withdrawnAt: input.withdrawnAt ?? sql`now()`,
    })
    .where(
      and(
        eq(webhookEndpointProposals.proposalId, input.proposalId),
        isNull(webhookEndpointProposals.confirmedAt),
        isNull(webhookEndpointProposals.withdrawnAt),
      ),
    )
    .returning(COLUMNS);
  return updated === undefined ? undefined : row(updated);
}
