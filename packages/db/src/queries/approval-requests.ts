import { and, desc, eq, gt, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";

import {
  APPROVAL_REQUEST_TTL_MS,
  approvalRequests,
  SITE_APPROVAL_KINDS,
  type ApprovalKind,
  type ApprovalScope,
  type ApprovalStatus,
} from "../schema/control/approval-requests.js";
import type { Executor } from "./executor.js";

// Transitions carry their precondition in the `WHERE` clause and answer `undefined` when it
// did not hold, so the database picks the race winner.

export interface ApprovalRequestRow {
  readonly requestId: string;
  readonly scope: ApprovalScope;
  readonly workspaceId: string | null;
  readonly kind: ApprovalKind;
  readonly target: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly status: ApprovalStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
}

const COLUMNS = {
  requestId: approvalRequests.requestId,
  scope: approvalRequests.scope,
  workspaceId: approvalRequests.workspaceId,
  kind: approvalRequests.kind,
  target: approvalRequests.target,
  payload: approvalRequests.payload,
  requestedBy: approvalRequests.requestedBy,
  requestedAt: approvalRequests.requestedAt,
  expiresAt: approvalRequests.expiresAt,
  status: approvalRequests.status,
  decidedBy: approvalRequests.decidedBy,
  decidedAt: approvalRequests.decidedAt,
} as const;

// Laundering the text columns, whose values the CHECKs pin, into their unions.
function row(value: typeof approvalRequests.$inferSelect): ApprovalRequestRow {
  return value as ApprovalRequestRow;
}

/** Thrown on write when a payload does not match its kind's shape. */
export class ApprovalPayloadInvalid extends Error {
  constructor(
    readonly kind: string,
    reason: string,
  ) {
    super(`approval request payload for ${kind}: ${reason}`);
    this.name = "ApprovalPayloadInvalid";
  }
}

function isStringList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");
}

function exactKeys(payload: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(payload).sort();
  return own.length === keys.length && [...keys].sort().every((key, i) => own[i] === key);
}

type PayloadCheck = (value: Record<string, unknown>) => string | undefined;

const noFields: PayloadCheck = (value) => (exactKeys(value, []) ? undefined : "takes no fields");

const PAYLOAD_CHECKS: Readonly<Record<ApprovalKind, PayloadCheck>> = {
  promote: noFields,
  demote: noFields,
  disable: noFields,
  "second-approval-off": noFields,
  reset: (value) => {
    if (!exactKeys(value, ["password", "factor"])) return "takes password and factor";
    if (typeof value.password !== "boolean" || typeof value.factor !== "boolean") {
      return "password and factor are booleans";
    }
    return value.password || value.factor ? undefined : "resets at least one credential";
  },
  // A join binds the group's sets; a group edit also binds the sets it replaces.
  "self-grant": (value) => {
    const edit = exactKeys(value, [
      "roles",
      "environments",
      "previousRoles",
      "previousEnvironments",
    ]);
    if (!edit && !exactKeys(value, ["roles", "environments"])) {
      return "takes roles and environments, and previousRoles and previousEnvironments for an edit";
    }
    const lists = edit
      ? [value.roles, value.environments, value.previousRoles, value.previousEnvironments]
      : [value.roles, value.environments];
    return lists.every(isStringList) ? undefined : "roles and environments are lists of names";
  },
  "draft-publish": (value) => {
    if (!exactKeys(value, ["revision", "contentHash"])) return "takes revision and contentHash";
    if (!Number.isInteger(value.revision) || (value.revision as number) < 0) {
      return "revision is a non-negative integer";
    }
    return typeof value.contentHash === "string" && /^[0-9a-f]{64}$/.test(value.contentHash)
      ? undefined
      : "contentHash is a lower-case hex SHA-256";
  },
  "move-form": (value) => {
    if (!exactKeys(value, ["destinationWorkspaceId"])) return "takes destinationWorkspaceId";
    return typeof value.destinationWorkspaceId === "string" && value.destinationWorkspaceId !== ""
      ? undefined
      : "destinationWorkspaceId is a workspace id";
  },
};

/** The reason a payload fails its kind's shape, or `undefined` when it holds. */
export function refuseApprovalPayload(kind: ApprovalKind, payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return "must be an object";
  }
  return PAYLOAD_CHECKS[kind](payload as Record<string, unknown>);
}

function scopeOf(kind: ApprovalKind): ApprovalScope {
  return (SITE_APPROVAL_KINDS as readonly string[]).includes(kind) ? "site" : "workspace";
}

export function newApprovalRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `apr_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Store a pending request expiring 7 days after `requestedAt`. Refuses a payload that fails
 * its kind's shape with {@link ApprovalPayloadInvalid}, and answers `undefined` when the same
 * requester already holds a pending request of this kind on this target.
 */
export async function insertApprovalRequest(
  exec: Executor,
  input: {
    readonly kind: ApprovalKind;
    readonly workspaceId?: string;
    readonly target: string;
    readonly payload: unknown;
    readonly requestedBy: string;
    readonly requestedAt: Date;
  },
): Promise<ApprovalRequestRow | undefined> {
  const refusal = refuseApprovalPayload(input.kind, input.payload);
  if (refusal !== undefined) throw new ApprovalPayloadInvalid(input.kind, refusal);
  const [inserted] = await exec
    .insert(approvalRequests)
    .values({
      requestId: newApprovalRequestId(),
      scope: scopeOf(input.kind),
      workspaceId: input.workspaceId ?? null,
      kind: input.kind,
      target: input.target,
      payload: input.payload as Record<string, unknown>,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
      expiresAt: new Date(input.requestedAt.getTime() + APPROVAL_REQUEST_TTL_MS),
    })
    .onConflictDoNothing()
    .returning(COLUMNS);
  return inserted === undefined ? undefined : row(inserted);
}

export async function getApprovalRequest(
  exec: Executor,
  requestId: string,
): Promise<ApprovalRequestRow | undefined> {
  const [found] = await exec
    .select(COLUMNS)
    .from(approvalRequests)
    .where(eq(approvalRequests.requestId, requestId))
    .limit(1);
  return found === undefined ? undefined : row(found);
}

/** Requests newest first, filtered by scope, status and workspace where given. */
export async function listApprovalRequests(
  exec: Executor,
  options: {
    readonly scope?: ApprovalScope;
    readonly status?: ApprovalStatus;
    readonly workspaceId?: string;
    readonly target?: string;
    readonly kinds?: readonly ApprovalKind[];
    readonly excludeKinds?: readonly ApprovalKind[];
    readonly limit?: number;
    readonly offset?: number;
  } = {},
): Promise<{ readonly rows: readonly ApprovalRequestRow[]; readonly total: number }> {
  const filters: SQL[] = [];
  if (options.scope !== undefined) filters.push(eq(approvalRequests.scope, options.scope));
  if (options.status !== undefined) filters.push(eq(approvalRequests.status, options.status));
  if (options.workspaceId !== undefined) {
    filters.push(eq(approvalRequests.workspaceId, options.workspaceId));
  }
  if (options.target !== undefined) filters.push(eq(approvalRequests.target, options.target));
  if (options.kinds !== undefined) filters.push(inArray(approvalRequests.kind, [...options.kinds]));
  if (options.excludeKinds !== undefined && options.excludeKinds.length > 0) {
    filters.push(notInArray(approvalRequests.kind, [...options.excludeKinds]));
  }
  const where = filters.length === 0 ? undefined : and(...filters);
  const rows = await exec
    .select(COLUMNS)
    .from(approvalRequests)
    .where(where)
    .orderBy(desc(approvalRequests.requestedAt), desc(approvalRequests.requestId))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);
  const [count] = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(approvalRequests)
    .where(where);
  return { rows: rows.map(row), total: count?.total ?? 0 };
}

/**
 * Decide a pending, unexpired request, or `undefined` when it was not one. Never the
 * requester, and never the target of a site request; the CHECK refuses both as well.
 */
export async function decideApprovalRequest(
  exec: Executor,
  input: {
    readonly requestId: string;
    readonly decision: "approved" | "rejected";
    readonly decidedBy: string;
    readonly decidedAt: Date;
  },
): Promise<ApprovalRequestRow | undefined> {
  const [updated] = await exec
    .update(approvalRequests)
    .set({ status: input.decision, decidedBy: input.decidedBy, decidedAt: input.decidedAt })
    .where(
      and(
        eq(approvalRequests.requestId, input.requestId),
        eq(approvalRequests.status, "pending"),
        gt(approvalRequests.expiresAt, input.decidedAt),
        sql`${approvalRequests.requestedBy} <> ${input.decidedBy}`,
        sql`(${approvalRequests.scope} <> 'site' or ${approvalRequests.target} <> ${input.decidedBy})`,
      ),
    )
    .returning(COLUMNS);
  return updated === undefined ? undefined : row(updated);
}

/** Mark every pending request whose window has passed as expired, returning those rows. */
export async function expireApprovalRequests(
  exec: Executor,
  now: Date,
): Promise<readonly ApprovalRequestRow[]> {
  const rows = await exec
    .update(approvalRequests)
    .set({ status: "expired", decidedAt: now })
    .where(and(eq(approvalRequests.status, "pending"), lte(approvalRequests.expiresAt, now)))
    .returning(COLUMNS);
  return rows.map(row);
}
