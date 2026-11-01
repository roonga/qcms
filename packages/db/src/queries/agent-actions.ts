import { and, asc, desc, eq, sql } from "drizzle-orm";

import { agentActions } from "../schema/control/agent-actions.js";
import type { Executor } from "./executor.js";

// The write must carry no `RETURNING`: it runs on the environment pools too, where
// `qcms_app_<env>` holds `INSERT` and no `SELECT`.

/** One SEC-17 agent step row to append, written in the step's own transaction. */
export interface AgentActionEntry {
  readonly proposalId: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly actor: string;
  readonly workspaceId: string;
  readonly environment?: string | undefined;
  readonly formId?: string | undefined;
  readonly kind: string;
  readonly screen: string;
  readonly proposedAt: Date;
  readonly confirmedAt?: Date | undefined;
  /** Must carry no answer value, secret or `LocalizedText` content. */
  readonly detail?: string | undefined;
}

/** One agent step row as it is read back. */
export interface AgentActionRow {
  readonly id: string;
  readonly proposalId: string;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly actor: string;
  readonly workspaceId: string;
  readonly environment: string | null;
  readonly formId: string | null;
  readonly kind: string;
  readonly screen: string;
  readonly proposedAt: Date;
  readonly confirmedAt: Date;
  readonly detail: string | null;
}

/** Append one agent step row. Never add `RETURNING`: see the note above. */
export async function writeAgentActionRow(exec: Executor, entry: AgentActionEntry): Promise<void> {
  await exec.insert(agentActions).values({
    proposalId: entry.proposalId,
    stepIndex: entry.stepIndex,
    stepCount: entry.stepCount,
    actor: entry.actor,
    workspaceId: entry.workspaceId,
    environment: entry.environment ?? null,
    formId: entry.formId ?? null,
    kind: entry.kind,
    screen: entry.screen,
    proposedAt: entry.proposedAt,
    ...(entry.confirmedAt === undefined ? {} : { confirmedAt: entry.confirmedAt }),
    detail: entry.detail ?? null,
  });
}

const actionColumns = {
  id: agentActions.id,
  proposalId: agentActions.proposalId,
  stepIndex: agentActions.stepIndex,
  stepCount: agentActions.stepCount,
  actor: agentActions.actor,
  workspaceId: agentActions.workspaceId,
  environment: agentActions.environment,
  formId: agentActions.formId,
  kind: agentActions.kind,
  screen: agentActions.screen,
  proposedAt: agentActions.proposedAt,
  confirmedAt: agentActions.confirmedAt,
  detail: agentActions.detail,
} as const;

/**
 * Every step already recorded for one proposal, in order. The provenance middleware reads
 * it to check that steps `0` to `i-1` ran and to resolve a reference's recorded value.
 */
export async function listProposalSteps(
  exec: Executor,
  proposalId: string,
): Promise<readonly AgentActionRow[]> {
  return exec
    .select(actionColumns)
    .from(agentActions)
    .where(eq(agentActions.proposalId, proposalId))
    .orderBy(asc(agentActions.stepIndex));
}

/**
 * One workspace's agent audit, newest first, read exactly as the access audit is read
 * (workspace owners and the installation administrator).
 */
export async function listAgentActions(
  exec: Executor,
  workspaceId: string,
  options: { readonly limit?: number; readonly offset?: number; readonly kind?: string } = {},
): Promise<{ readonly rows: readonly AgentActionRow[]; readonly total: number }> {
  const where =
    options.kind === undefined
      ? eq(agentActions.workspaceId, workspaceId)
      : and(eq(agentActions.workspaceId, workspaceId), eq(agentActions.kind, options.kind));

  const rows = await exec
    .select(actionColumns)
    .from(agentActions)
    .where(where)
    .orderBy(desc(agentActions.confirmedAt), desc(agentActions.id))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  const counted = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(agentActions)
    .where(where);

  return { rows, total: counted[0]?.total ?? 0 };
}
