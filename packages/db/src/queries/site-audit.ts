import { desc, eq, sql } from "drizzle-orm";

import type { AccessAuditKind } from "../schema/control/access-audit.js";
import { siteAudit, type SiteAuditKind } from "../schema/control/site-audit.js";
import { writeAccessAuditRow } from "./access-audit.js";
import type { Executor } from "./executor.js";

/** One site audit row to append. `occurredAt` defaults to the column's `now()`. */
export interface SiteAuditEntry {
  /** The Site administrator's account, or the IdP subject under single sign-on. */
  readonly actor: string;
  /** The account, workspace or request the act was on. */
  readonly subject?: string | undefined;
  /** Set where the act affects one workspace, which is where a mirrored row goes. */
  readonly workspaceId?: string | undefined;
  readonly kind: SiteAuditKind;
  /** Must carry no credential, answer value or `LocalizedText` content. */
  readonly detail?: string | undefined;
  readonly occurredAt?: Date | undefined;
}

/** One site audit row as it is read back. */
export interface SiteAuditRow {
  readonly id: string;
  readonly actor: string;
  readonly subject: string | null;
  readonly workspaceId: string | null;
  readonly kind: string;
  readonly occurredAt: Date;
  readonly detail: string | null;
}

/** Append one site audit row. */
export async function writeSiteAuditRow(exec: Executor, entry: SiteAuditEntry): Promise<void> {
  await exec.insert(siteAudit).values({
    actor: entry.actor,
    subject: entry.subject ?? null,
    workspaceId: entry.workspaceId ?? null,
    kind: entry.kind,
    ...(entry.occurredAt === undefined ? {} : { occurredAt: entry.occurredAt }),
    detail: entry.detail ?? null,
  });
}

/** The workspace-audit kind a mirrored site act takes. */
const MIRROR_KIND: Readonly<Record<SiteAuditKind, AccessAuditKind>> = {
  account: "account",
  administrator: "administrator",
  approval: "approval",
  library: "setting",
};

// The workspace audit has no `subject` column, so the mirrored row carries it in `detail`.
function mirrorDetail(entry: SiteAuditEntry): string | undefined {
  if (entry.subject === undefined) return entry.detail;
  const subject = `subject=${entry.subject}`;
  if (entry.detail === undefined) return subject;
  return `${subject} ${entry.detail}`;
}

/**
 * Append the site row, then the mirrored workspace-audit row for each workspace the act
 * affects. Pass the caller's own transaction, so the site row and its mirrors land together.
 */
export async function writeSiteAuditWithMirror(
  exec: Executor,
  entry: SiteAuditEntry,
  mirrorTo: readonly string[],
): Promise<void> {
  await writeSiteAuditRow(exec, entry);
  const detail = mirrorDetail(entry);
  for (const workspaceId of mirrorTo) {
    await writeAccessAuditRow(exec, {
      actor: entry.actor,
      workspaceId,
      kind: MIRROR_KIND[entry.kind],
      ...(detail === undefined ? {} : { detail }),
      ...(entry.occurredAt === undefined ? {} : { occurredAt: entry.occurredAt }),
    });
  }
}

const siteAuditColumns = {
  id: siteAudit.id,
  actor: siteAudit.actor,
  subject: siteAudit.subject,
  workspaceId: siteAudit.workspaceId,
  kind: siteAudit.kind,
  occurredAt: siteAudit.occurredAt,
  detail: siteAudit.detail,
} as const;

/** Read the site audit, newest first. Only a Site administrator may call the route that reads it. */
export async function listSiteAudit(
  exec: Executor,
  options: { readonly limit?: number; readonly offset?: number; readonly kind?: string } = {},
): Promise<{ readonly rows: readonly SiteAuditRow[]; readonly total: number }> {
  const where = options.kind === undefined ? undefined : eq(siteAudit.kind, options.kind);

  const rows = await exec
    .select(siteAuditColumns)
    .from(siteAudit)
    .where(where)
    .orderBy(desc(siteAudit.occurredAt), desc(siteAudit.id))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  const counted = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(siteAudit)
    .where(where);

  return { rows, total: counted[0]?.total ?? 0 };
}
