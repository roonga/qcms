import { and, desc, eq, sql } from "drizzle-orm";

import { accessAudit, type AccessAuditKind } from "../schema/control/access-audit.js";
import type { Executor } from "./executor.js";

/**
 * The SEC-15 access audit's reads and its one write (task 069).
 *
 * # One helper, two roles, and why that decides the write's shape
 *
 * {@link writeAccessAuditRow} is called on **both** pools, and that is the whole reason
 * the insert carries **no `RETURNING`**:
 *
 *   - A response read, export or erasure runs on the **environment** pool and its audit
 *     row rides the same transaction, because an audit row written on a second connection
 *     would be a second transaction and a read that succeeded while its audit write failed
 *     would leave no record of itself (Q40). `qcms_app_<env>` holds `INSERT` on this table
 *     and **nothing else on it**, so a `RETURNING`, being a read, is refused for it.
 *   - A grant, a revoke and a setting change run on the **control** pool, because
 *     membership and grants live in `control` (Q56). `qcms_app_control` holds `SELECT`
 *     here as well as `INSERT`, so a `RETURNING` would *succeed* for it.
 *
 * So the rule belongs to the helper rather than to either role, and it is asserted as the
 * environment role: asserting it as the control role would prove nothing. For the
 * control-pool path the assertion is from this source - the statement below is the only
 * write to this table in the package, and it names no `returning`.
 *
 * # What the caller establishes and the writing role cannot
 *
 * `actor` and `workspaceId` are values an environment role cannot verify: it holds no
 * `SELECT` on `user` or `member`, and membership was resolved on the control pool before
 * the read. That is the no-foreign-key precedent working as intended rather than a gap,
 * and the API is where both values are established, before the write.
 */

/** One row to append. The seven SEC-15 fields; `occurredAt` is the column's default. */
export interface AccessAuditEntry {
  /** The administrator's account, or the IdP subject under single sign-on. */
  readonly actor: string;
  /** The workspace the act was performed in, or whose form owns the data read. */
  readonly workspaceId: string;
  /**
   * The environment whose data was read. **Omitted on a grant, a revoke or a setting row
   * unless the act names one** (Q61).
   */
  readonly environment?: string | undefined;
  /** The form. Omitted on a grant, a revoke or a setting row unless the act names one. */
  readonly formId?: string | undefined;
  readonly kind: AccessAuditKind;
  /**
   * The scope of a grant or a revoke, or a setting's name and its new value. Omitted on
   * a read, an export and an erasure.
   *
   * **No answer value, no respondent identifier and no `LocalizedText` content** reaches
   * it, which is the rule the rest of the row already keeps.
   */
  readonly detail?: string | undefined;
  /** When, for a caller holding an injected clock. Defaults to the column's `now()`. */
  readonly occurredAt?: Date | undefined;
}

/** One row as it is read back. */
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

/**
 * Append one audit row.
 *
 * **No `RETURNING`**, for the reason in the module header. The helper answers nothing, so
 * there is nothing a caller could come to depend on that would quietly reintroduce one.
 */
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

/** The columns {@link AccessAuditRow} carries, as one Drizzle projection. */
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
 * One workspace's audit, newest first.
 *
 * Scoped to a workspace rather than offered installation-wide, because that is the
 * readership SEC-15 names: a workspace's **owners** and the installation administrator,
 * and nobody else. An installation-wide read would be a different surface with a
 * different reader, and the API would have to narrow it again on every call.
 *
 * Runs on the **control** pool: `qcms_app_control` is the role holding `SELECT` here.
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

/**
 * How many rows one workspace's audit holds, by kind.
 *
 * The shape criterion 8 and criterion 19 assert by **count**: "every read, export and
 * erasure writes one row, and no path reads or exports without one" is a statement about
 * counts before and after, so the count is a read the tests share rather than each one
 * writing its own aggregate.
 */
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
