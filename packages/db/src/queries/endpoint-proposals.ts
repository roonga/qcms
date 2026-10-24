import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import {
  type EndpointProposalKind,
  webhookEndpointProposals,
} from "../schema/control/endpoint-proposals.js";
import type { Executor } from "./executor.js";

// State transitions carry their precondition in the `WHERE` clause and answer
// `undefined` when it did not hold, so the database picks the winner of a race. A
// read-then-write would let two confirmations both apply, the second overwriting a
// production endpoint with a value its confirmer never saw.

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

// Laundering the `kind` text column, whose values the CHECK already pins, into the union.
function row(value: {
  readonly kind: string;
  readonly formId: string;
  readonly [key: string]: unknown;
}): EndpointProposalRow {
  return { ...value, kind: value.kind as EndpointProposalKind } as EndpointProposalRow;
}

/**
 * Store a proposed change pending. Call inside the caller's transaction, beside its
 * SEC-15 row: a proposal without the audit row recording who proposed it is the one
 * failure this control may not have.
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
 * Unresolved proposals for one form in one environment, newest first. Confirmed ones
 * whose apply has not landed are included, because their endpoint is not live yet.
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
 * Whether one endpoint already has an open change: not yet applied and not withdrawn.
 * Asking only about pending ones would let a second proposal be applied beside a
 * confirmed one that can still be resumed.
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
        isNull(webhookEndpointProposals.appliedAt),
        isNull(webhookEndpointProposals.withdrawnAt),
      ),
    )
    .limit(1);
  return found !== undefined;
}

/**
 * Claim a pending proposal for one confirming account, or `undefined` when it was not
 * pending. The confirming account may never be the proposing one.
 *
 * Claim before the apply, in the same transaction as the confirmation's SEC-15 row: the
 * other order would leave production data flowing to a new URL with nothing recording who
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
 * Stamp a confirmed proposal as applied, once the endpoint write has landed. Separate
 * from the confirmation because the two commit on different pools.
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
 * Withdraw an open proposal, or answer `undefined` when there was nothing open to
 * withdraw. Either account may withdraw.
 *
 * A confirmed proposal is withdrawable because `applied_at is null` means nothing went
 * live, and the `one_open` index would otherwise let a persistently failing apply block
 * every new proposal for that endpoint. An applied one is not: reversing a live change
 * needs its own second approver.
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
        isNull(webhookEndpointProposals.appliedAt),
        isNull(webhookEndpointProposals.withdrawnAt),
      ),
    )
    .returning(COLUMNS);
  return updated === undefined ? undefined : row(updated);
}
