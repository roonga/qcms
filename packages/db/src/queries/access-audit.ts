import { and, desc, eq, sql } from "drizzle-orm";

import { accessAudit, type AccessAuditKind } from "../schema/control/access-audit.js";
import type { Executor } from "./executor.js";

// The write must carry no `RETURNING`: it runs on the environment pool too, where
// `qcms_app_<env>` holds `INSERT` and no `SELECT`.

/** One SEC-15 audit row to append. `occurredAt` defaults to the column's `now()`. */
export interface AccessAuditEntry {
  /** The administrator's account, or the IdP subject under single sign-on. */
  readonly actor: string;
  /** The workspace the act was performed in, or whose form owns the data read. */
  readonly workspaceId: string;
  readonly environment?: string | undefined;
  readonly formId?: string | undefined;
  readonly kind: AccessAuditKind;
  /** Must carry no answer value, respondent identifier or `LocalizedText` content. */
  readonly detail?: string | undefined;
  readonly occurredAt?: Date | undefined;
}

/** One audit row as it is read back. */
export interface AccessAuditRow {
  readonly id: string;
  readonly actor: string;
  readonly workspaceId: string;
  readonly environment: string | null;
  readonly formId: string | null;
  readonly kind: string;
  readonly occurredAt: Date;
  readonly detail: string | null;
}

/** Append one audit row. Never add `RETURNING`: see the note above. */
export async function writeAccessAuditRow(exec: Executor, entry: AccessAuditEntry): Promise<void> {
  await exec.insert(accessAudit).values({
    actor: entry.actor,
    workspaceId: entry.workspaceId,
    environment: entry.environment ?? null,
    formId: entry.formId ?? null,
    kind: entry.kind,
    ...(entry.occurredAt === undefined ? {} : { occurredAt: entry.occurredAt }),
    detail: entry.detail ?? null,
  });
}

const auditColumns = {
  id: accessAudit.id,
  actor: accessAudit.actor,
  workspaceId: accessAudit.workspaceId,
  environment: accessAudit.environment,
  formId: accessAudit.formId,
  kind: accessAudit.kind,
  occurredAt: accessAudit.occurredAt,
  detail: accessAudit.detail,
} as const;

/**
 * One workspace's audit, newest first. Workspace-scoped by SEC-15, and runs on the
 * control pool, the only one with `SELECT` here.
 */
export async function listAccessAudit(
  exec: Executor,
  workspaceId: string,
  options: { readonly limit?: number; readonly offset?: number; readonly kind?: string } = {},
): Promise<{ readonly rows: readonly AccessAuditRow[]; readonly total: number }> {
  const where =
    options.kind === undefined
      ? eq(accessAudit.workspaceId, workspaceId)
      : and(eq(accessAudit.workspaceId, workspaceId), eq(accessAudit.kind, options.kind));

  const rows = await exec
    .select(auditColumns)
    .from(accessAudit)
    .where(where)
    .orderBy(desc(accessAudit.occurredAt), desc(accessAudit.id))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  const counted = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(accessAudit)
    .where(where);

  return { rows, total: counted[0]?.total ?? 0 };
}

/** How many rows one workspace's audit holds, by kind. */
export async function countAccessAuditByKind(
  exec: Executor,
  workspaceId: string,
): Promise<Readonly<Record<string, number>>> {
  const rows = await exec
    .select({ kind: accessAudit.kind, total: sql<number>`count(*)::int` })
    .from(accessAudit)
    .where(eq(accessAudit.workspaceId, workspaceId))
    .groupBy(accessAudit.kind);
  return Object.fromEntries(rows.map((row) => [row.kind, row.total]));
}
