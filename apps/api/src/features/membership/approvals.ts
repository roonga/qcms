import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import {
  APPROVAL_STATUSES,
  decideApprovalRequest,
  findUsersByIds,
  getAccessGroup,
  getApprovalRequest,
  holdsAccessGroup,
  isAccessGroupNameTaken,
  listActiveAdministratorsFor,
  listApprovalRequests,
  lockWorkspaceMembership,
  type AccessGroupRow,
  type ApprovalRequestRow,
  type Executor,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { errorResponses, withScopes, type ApiEnv } from "../../openapi.js";
import { parseFormId } from "@roonga/qcms-core";

import { ApprovalRequestView, HeldResponse, requestView } from "../site-admins/schema.js";
import { applyFormMove, moveLapse } from "../workspaces/move.js";
import { requireOpenWorkspace } from "../workspaces/resolve.js";
import {
  applyGrant,
  applyGroupEdit,
  applySecondApprovalSetting,
  fail as membershipFail,
  validateGroup,
} from "./handler.js";
import { WorkspaceIdParam } from "./schema.js";
import {
  heldRequestFailures,
  lapseHeldRequest,
  refuseHeldDecision,
  writeHeldRequestAudit,
} from "./two-person.js";

const tags = ["membership"];

const PAGE_SIZE = 50;

/** The kinds a workspace's Requests row lists: a held draft publish is decided on its form. */
const ON_THE_FORM = ["draft-publish"] as const;

export const workspaceRequestFailures = {
  onTheForm: (): ApiError =>
    new ApiError(
      "REQUEST_DECIDED_ON_THE_FORM",
      409,
      "A held publish is approved on its form by another person holding Publish forms for prod",
    ),
  notDecidedYet: (): ApiError =>
    new ApiError(
      "REQUEST_KIND_NOT_DECIDED_HERE",
      409,
      "This kind of request cannot be decided here yet",
    ),
  approverNotAdministrator: (): ApiError =>
    new ApiError(
      "APPROVER_NOT_ADMINISTRATOR",
      403,
      "Only an active Workspace administrator of this workspace, or a Site administrator, " +
        "approves this request",
    ),
  requesterNotAdministrator: (): ApiError =>
    new ApiError(
      "REQUESTER_NOT_ADMINISTRATOR",
      409,
      "The person who asked is no longer a Workspace administrator of this workspace or a " +
        "Site administrator, so nothing is applied",
    ),
  formGone: (): ApiError =>
    new ApiError(
      "FORM_NOT_FOUND",
      409,
      "The form this request names no longer exists, so nothing is applied",
    ),
  groupGone: (): ApiError =>
    new ApiError(
      "ACCESS_GROUP_NOT_FOUND",
      409,
      "The access group this request names no longer exists, so nothing is applied",
    ),
  groupChanged: (): ApiError =>
    new ApiError(
      "ACCESS_GROUP_CHANGED",
      409,
      "The access group's roles or environments changed after this was requested, so it " +
        "would grant something nobody approved. Nothing is applied, and this request has " +
        "ended; ask again.",
    ),
  nameTakenSince: (name: string): ApiError =>
    new ApiError(
      "ACCESS_GROUP_NAME_TAKEN",
      409,
      `Another access group in this workspace is now called "${name}", the name this edit ` +
        `asked for. Nothing is applied, and this request has ended; ask again with another ` +
        `name.`,
    ),
} as const;

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function within(held: readonly string[], bound: readonly string[]): boolean {
  return held.every((item) => bound.includes(item));
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function groupOf(tx: Executor, workspaceId: string, teamId: string): Promise<AccessGroupRow> {
  const group = await getAccessGroup(tx, teamId);
  if (group === undefined || group.workspaceId !== workspaceId) {
    throw workspaceRequestFailures.groupGone();
  }
  return group;
}

/**
 * The refusal a self-grant can no longer avoid, or `undefined` when it still applies: a group
 * that gained or no longer carries what the request bound, or a requested name taken since.
 * Such a request can never be applied as it was made, so its approver ends it instead.
 */
async function selfGrantLapse(
  tx: Executor,
  request: ApprovalRequestRow,
): Promise<ApiError | undefined> {
  const workspaceId = request.workspaceId as string;
  const group = await groupOf(tx, workspaceId, request.target);
  if (!("previousRoles" in request.payload)) {
    return !within(group.roles, stringList(request.payload.roles)) ||
      !within(group.environments, stringList(request.payload.environments))
      ? workspaceRequestFailures.groupChanged()
      : undefined;
  }
  if (
    !sameSet(group.roles, stringList(request.payload.previousRoles)) ||
    !sameSet(group.environments, stringList(request.payload.previousEnvironments))
  ) {
    return workspaceRequestFailures.groupChanged();
  }
  const name = stringOf(request.payload.name) ?? group.name;
  if (name !== group.name && (await isAccessGroupNameTaken(tx, workspaceId, name, group.teamId))) {
    return workspaceRequestFailures.nameTakenSince(name);
  }
  return undefined;
}

// A join grants the group as it is at approval. An edit applies the sets and the name it
// bound, and only onto the group it was made against.
async function applySelfGrant(
  tx: Executor,
  deps: Deps,
  request: ApprovalRequestRow,
  approval: string,
): Promise<void> {
  const workspaceId = request.workspaceId as string;
  const group = await groupOf(tx, workspaceId, request.target);
  const roles = stringList(request.payload.roles);
  const environments = stringList(request.payload.environments);
  const requester = request.requestedBy;

  if ("previousRoles" in request.payload) {
    // `selfGrantLapse` refused a taken name under this same membership lock, so no rename
    // can have raced in since.
    const name = stringOf(request.payload.name) ?? group.name;
    const checked = await validateGroup(tx, { name, roles, environments });
    await applyGroupEdit(tx, deps, {
      workspaceId,
      existing: group,
      name,
      roles: checked.roles,
      environments: checked.environments,
      actorId: requester,
      approval,
    });
    return;
  }

  if (await holdsAccessGroup(tx, group.teamId, requester)) throw membershipFail.alreadyHolds();
  const [subject] = await findUsersByIds(tx, [requester]);
  if (subject === undefined) throw workspaceRequestFailures.requesterNotAdministrator();
  await applyGrant(tx, deps, { workspaceId, group, subject, actorId: requester, approval });
}

async function workspaceRequestOf(
  tx: Executor,
  workspaceId: string,
  requestId: string,
): Promise<ApprovalRequestRow> {
  const request = await getApprovalRequest(tx, requestId);
  if (
    request === undefined ||
    request.scope !== "workspace" ||
    request.workspaceId !== workspaceId
  ) {
    throw heldRequestFailures.notFound();
  }
  if ((ON_THE_FORM as readonly string[]).includes(request.kind)) {
    throw workspaceRequestFailures.onTheForm();
  }
  return request;
}

const DECIDED_HERE = ["self-grant", "second-approval-off", "move-form"] as const;

function destinationOf(request: ApprovalRequestRow): string {
  return stringOf(request.payload.destinationWorkspaceId) ?? "";
}

/** The refusal this request can no longer avoid, or `undefined` when it still applies. */
async function heldLapse(
  tx: Executor,
  request: ApprovalRequestRow,
  workspaceId: string,
): Promise<ApiError | undefined> {
  if (request.kind === "self-grant") return selfGrantLapse(tx, request);
  if (request.kind === "move-form") {
    return moveLapse(tx, {
      moverId: request.requestedBy,
      sourceWorkspaceId: workspaceId,
      destinationWorkspaceId: destinationOf(request),
    });
  }
  return undefined;
}

async function applyHeldRequest(
  tx: Executor,
  deps: Deps,
  input: {
    readonly request: ApprovalRequestRow;
    readonly workspace: { readonly id: string; readonly requireSecondApprover: boolean };
    readonly approval: string;
  },
): Promise<void> {
  const { request, workspace } = input;
  if (request.kind === "second-approval-off") {
    if (workspace.requireSecondApprover) {
      await applySecondApprovalSetting(tx, deps, {
        workspaceId: workspace.id,
        value: false,
        actorId: request.requestedBy,
        approval: input.approval,
      });
    }
    return;
  }
  if (request.kind === "move-form") {
    const parsed = parseFormId(request.target);
    if (!parsed.ok) throw workspaceRequestFailures.formGone();
    await applyFormMove(tx, deps, {
      formId: parsed.value,
      sourceWorkspaceId: workspace.id,
      destinationWorkspaceId: destinationOf(request),
      // The mover is the actor of the move; the approver is named in the audit marker.
      actorId: request.requestedBy,
      approval: input.approval,
    });
    return;
  }
  await applySelfGrant(tx, deps, request, input.approval);
}

/**
 * Approve and apply a held switch-off, self-grant or move in one transaction under the
 * workspace's membership lock. The approver must still administer the workspace or the site,
 * and the requester must still hold what the act needs; a request whose ground has moved
 * ends as `lapsed` instead, applying nothing.
 */
export async function approveWorkspaceRequest(
  deps: Deps,
  input: { readonly workspaceId: string; readonly requestId: string; readonly approverId: string },
): Promise<ApprovalRequestRow> {
  const applied = await deps.databases.control.transaction(async (tx) => {
    await lockWorkspaceMembership(tx, input.workspaceId);
    const request = await workspaceRequestOf(tx, input.workspaceId, input.requestId);
    if (!(DECIDED_HERE as readonly string[]).includes(request.kind)) {
      throw workspaceRequestFailures.notDecidedYet();
    }
    const at = deps.clock.now();
    refuseHeldDecision(request, input.approverId, at);

    const administrators = await listActiveAdministratorsFor(tx, input.workspaceId);
    if (!administrators.includes(input.approverId)) {
      throw workspaceRequestFailures.approverNotAdministrator();
    }
    // A move asks what the move needs of its mover, Edit forms in both workspaces, rather
    // than that they administer this one: anybody holding it may ask for one.
    if (request.kind !== "move-form" && !administrators.includes(request.requestedBy)) {
      throw workspaceRequestFailures.requesterNotAdministrator();
    }
    const workspace = await requireOpenWorkspace(tx, input.workspaceId);

    const lapse = await heldLapse(tx, request, input.workspaceId);
    if (lapse !== undefined) {
      await lapseHeldRequest(tx, {
        request,
        actor: input.approverId,
        at,
        ...(request.kind === "move-form" ? { formId: request.target } : {}),
      });
      return lapse;
    }

    const decided = await decideApprovalRequest(tx, {
      requestId: request.requestId,
      decision: "approved",
      decidedBy: input.approverId,
      decidedAt: at,
    });
    if (decided === undefined) throw heldRequestFailures.notPending();

    await applyHeldRequest(tx, deps, {
      request,
      workspace: { id: input.workspaceId, requireSecondApprover: workspace.requireSecondApprover },
      approval: `request=${request.requestId} approver=${input.approverId}`,
    });
    await writeHeldRequestAudit(tx, {
      request: decided,
      act: "approve",
      actor: input.approverId,
      at,
      ...(request.kind === "move-form" ? { formId: request.target } : {}),
    });
    return decided;
  });
  if (applied instanceof ApiError) throw applied;
  return applied;
}

export async function rejectWorkspaceRequest(
  deps: Deps,
  input: { readonly workspaceId: string; readonly requestId: string; readonly deciderId: string },
): Promise<ApprovalRequestRow> {
  return deps.databases.control.transaction(async (tx) => {
    const request = await workspaceRequestOf(tx, input.workspaceId, input.requestId);
    const at = deps.clock.now();
    refuseHeldDecision(request, input.deciderId, at);
    const decided = await decideApprovalRequest(tx, {
      requestId: request.requestId,
      decision: "rejected",
      decidedBy: input.deciderId,
      decidedAt: at,
    });
    if (decided === undefined) throw heldRequestFailures.notPending();
    await writeHeldRequestAudit(tx, {
      request: decided,
      act: "reject",
      actor: input.deciderId,
      at,
      ...(request.kind === "move-form" ? { formId: request.target } : {}),
    });
    return decided;
  });
}

const RequestParams = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .openapi({ param: { name: "id", in: "path" }, example: "org_0a1b2c" }),
  requestId: z
    .string()
    .min(1)
    .max(100)
    .openapi({ param: { name: "requestId", in: "path" }, example: "apr_0f3c" }),
});

const WorkspaceRequestQuery = z.object({
  status: z
    .enum(APPROVAL_STATUSES)
    .optional()
    .openapi({ param: { name: "status", in: "query" } }),
  page: z
    .string()
    .regex(/^[1-9]\d{0,3}$/)
    .optional()
    .openapi({ param: { name: "page", in: "query" } }),
});

const WorkspaceRequestList = z
  .object({
    workspaceId: z.string(),
    requests: z.array(ApprovalRequestView),
    page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .openapi("WorkspaceApprovalRequestList");

export const listWorkspaceRequestsRoute = createRoute({
  method: "get",
  path: "/workspaces/{id}/approval-requests",
  summary: "The workspace's approval requests (admin)",
  description:
    "The Requests row: turning second approval off, self-grants and moves held for an " +
    "approver, newest first, fifty to a page. A held publish to prod is approved on its " +
    "form and is not listed here. A request an approver could not apply carries status " +
    "`lapsed`, not `rejected`, with that approver as `decidedBy`.",
  tags,
  request: { params: WorkspaceIdParam, query: WorkspaceRequestQuery },
  responses: {
    200: {
      description: "One page of requests",
      content: { "application/json": { schema: WorkspaceRequestList } },
    },
    ...errorResponses(400, 401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const approveWorkspaceRequestRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/approval-requests/{requestId}/approve",
  summary: "Approve and apply a workspace request (admin)",
  description:
    "By a Workspace administrator of the workspace, or a Site administrator, who is not the " +
    "requester. Refused after 7 days and once decided. Re-checked as it is applied: a " +
    "switch-off's or self-grant's requester must still be a Workspace administrator of the " +
    "workspace or a Site administrator, a move's mover must still hold Edit forms in both " +
    "workspaces with the destination unarchived, and a self-grant applies only the roles, " +
    "environments and name it bound. A request whose ground has moved since it was made " +
    "applies nothing and ends as `lapsed`, so the requester can ask again.",
  tags,
  request: { params: RequestParams },
  responses: {
    200: {
      description: "Approved and applied",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const rejectWorkspaceRequestRoute = createRoute({
  method: "post",
  path: "/workspaces/{id}/approval-requests/{requestId}/reject",
  summary: "Reject a workspace request (admin)",
  description: "Nothing is applied. Refused for the requester, after 7 days, and once decided.",
  tags,
  request: { params: RequestParams },
  responses: {
    200: {
      description: "Rejected",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

function principalOf(c: { get: (key: "adminPrincipal") => unknown }): { readonly userId: string } {
  const principal = c.get("adminPrincipal") as { readonly userId: string } | undefined;
  if (principal === undefined) throw membershipFail.noPrincipal();
  return principal;
}

export function makeListWorkspaceRequestsHandler(
  deps: Deps,
): RouteHandler<typeof listWorkspaceRequestsRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const query = c.req.valid("query");
    const page = query.page === undefined ? 1 : Number(query.page);
    const { rows, total } = await listApprovalRequests(deps.databases.control, {
      scope: "workspace",
      workspaceId,
      excludeKinds: ON_THE_FORM,
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    return c.json({ workspaceId, requests: rows.map(requestView), page, total }, 200);
  };
}

export function makeApproveWorkspaceRequestHandler(
  deps: Deps,
): RouteHandler<typeof approveWorkspaceRequestRoute, ApiEnv> {
  return async (c) => {
    const { id, requestId } = c.req.valid("param");
    const approved = await approveWorkspaceRequest(deps, {
      workspaceId: id,
      requestId,
      approverId: principalOf(c).userId,
    });
    return c.json({ request: requestView(approved) }, 200);
  };
}

export function makeRejectWorkspaceRequestHandler(
  deps: Deps,
): RouteHandler<typeof rejectWorkspaceRequestRoute, ApiEnv> {
  return async (c) => {
    const { id, requestId } = c.req.valid("param");
    const rejected = await rejectWorkspaceRequest(deps, {
      workspaceId: id,
      requestId,
      deciderId: principalOf(c).userId,
    });
    return c.json({ request: requestView(rejected) }, 200);
  };
}
