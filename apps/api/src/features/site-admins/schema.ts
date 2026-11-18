import { z } from "@hono/zod-openapi";
import {
  APPROVAL_KINDS,
  APPROVAL_SCOPES,
  APPROVAL_STATUSES,
  type ApprovalRequestRow,
} from "@roonga/qcms-db";

export const ApprovalRequestView = z
  .object({
    requestId: z.string().openapi({ example: "apr_0f3c" }),
    scope: z.enum(APPROVAL_SCOPES),
    workspaceId: z.string().nullable(),
    kind: z.enum(APPROVAL_KINDS),
    target: z.string(),
    payload: z.record(z.string(), z.unknown()),
    requestedBy: z.string(),
    requestedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    status: z.enum(APPROVAL_STATUSES),
    decidedBy: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
  })
  .openapi("ApprovalRequest");

export const HeldResponse = z
  .object({ request: ApprovalRequestView })
  .openapi("ApprovalRequestHeld");

export function requestView(row: ApprovalRequestRow): z.infer<typeof ApprovalRequestView> {
  return {
    requestId: row.requestId,
    scope: row.scope,
    workspaceId: row.workspaceId,
    kind: row.kind,
    target: row.target,
    payload: { ...row.payload },
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    status: row.status,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}
