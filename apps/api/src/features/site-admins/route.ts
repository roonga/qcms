import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import {
  APPROVAL_SCOPES,
  APPROVAL_STATUSES,
  getApprovalRequest,
  listApprovalRequests,
  type ApprovalRequestRow,
} from "@roonga/qcms-db";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { errorResponses, withScopes, type ApiEnv } from "../../openapi.js";
import { accountView, principalOf } from "../accounts/handler.js";
import { accountOf } from "../accounts/lifecycle-acts.js";
import { AccountIdParam, AccountView, SignInLinkDeliveryView } from "../accounts/schema.js";
import { requireStepUp } from "../auth/step-up.js";
import { ApprovalRequestView, HeldResponse, requestView } from "./schema.js";
import {
  approveSiteRequest,
  rejectSiteRequest,
  requestOrApplySiteAct,
  requireSiteActStepUp,
  siteFail,
} from "./acts.js";

const tags = ["site-administrators"];

const RoleChangedResponse = z.object({ account: AccountView }).openapi("SiteAdministratorChanged");

const ApprovalListQuery = z.object({
  scope: z
    .enum(APPROVAL_SCOPES)
    .optional()
    .openapi({ param: { name: "scope", in: "query" } }),
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

const ApprovalListResponse = z
  .object({
    requests: z.array(ApprovalRequestView),
    page: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .openapi("ApprovalRequestList");

const RequestIdParam = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .openapi({ param: { name: "id", in: "path" }, example: "apr_0f3c" }),
});

const ApprovedResponse = z
  .object({ request: ApprovalRequestView, delivery: SignInLinkDeliveryView.optional() })
  .openapi("ApprovalRequestApproved");

const PAGE_SIZE = 50;

export const promoteRoute = createRoute({
  method: "post",
  path: "/accounts/{id}/promote",
  summary: "Make an account a Site administrator (Site administrator, step-up)",
  description:
    "Needs a step-up on this session. With one active, claimed Site administrator it applies " +
    "at once; with two or more it is held as a site approval request until another one " +
    "approves it. Refused for an unclaimed or disabled account and for your own.",
  tags,
  request: { params: AccountIdParam },
  responses: {
    200: {
      description: "Promoted on step-up alone",
      content: { "application/json": { schema: RoleChangedResponse } },
    },
    202: {
      description: "Held as a site approval request until another Site administrator approves it",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const demoteRoute = createRoute({
  method: "post",
  path: "/accounts/{id}/demote",
  summary: "Take the Site administrator role away (Site administrator, step-up)",
  description:
    "Needs a step-up on this session. Held as a site approval request while an active, " +
    "claimed Site administrator other than you and the target exists; otherwise, with " +
    "exactly two, it applies on step-up alone and the audit row says so. The last active " +
    "Site administrator is never demoted, and the target never approves its own demotion.",
  tags,
  request: { params: AccountIdParam },
  responses: {
    200: {
      description: "Demoted on step-up alone",
      content: { "application/json": { schema: RoleChangedResponse } },
    },
    202: {
      description: "Held as a site approval request until another Site administrator approves it",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const listApprovalRequestsRoute = createRoute({
  method: "get",
  path: "/approval-requests",
  summary: "Site and workspace approval requests (Site administrator)",
  description: "Newest first, fifty to a page, filterable by scope and status.",
  tags,
  request: { query: ApprovalListQuery },
  responses: {
    200: {
      description: "One page of requests",
      content: { "application/json": { schema: ApprovalListResponse } },
    },
    ...errorResponses(400, 401, 403),
  },
  ...withScopes("forms:read"),
});

export const getApprovalRequestRoute = createRoute({
  method: "get",
  path: "/approval-requests/{id}",
  summary: "One approval request (Site administrator)",
  tags,
  request: { params: RequestIdParam },
  responses: {
    200: {
      description: "The request",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(401, 403, 404),
  },
  ...withScopes("forms:read"),
});

export const approveRequestRoute = createRoute({
  method: "post",
  path: "/approval-requests/{id}/approve",
  summary: "Approve and apply a site request (Site administrator, step-up)",
  description:
    "Needs a step-up on this session. Refused for the requester, for the target of a " +
    "demotion, disable or reset, after 7 days, and once decided. Re-checked as it is " +
    "applied: the requester must still be an active Site administrator and the act's own " +
    "refusals must still pass, or nothing is applied.",
  tags,
  request: { params: RequestIdParam },
  responses: {
    200: {
      description: "Approved and applied",
      content: { "application/json": { schema: ApprovedResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

export const rejectRequestRoute = createRoute({
  method: "post",
  path: "/approval-requests/{id}/reject",
  summary: "Reject a site request (Site administrator)",
  description:
    "Nothing is applied. Refused for the requester, for the target, after 7 days, and once decided.",
  tags,
  request: { params: RequestIdParam },
  responses: {
    200: {
      description: "Rejected",
      content: { "application/json": { schema: HeldResponse } },
    },
    ...errorResponses(401, 403, 404, 409),
  },
  ...withScopes("forms:write"),
});

async function requestOf(deps: Deps, id: string): Promise<ApprovalRequestRow> {
  const row = await getApprovalRequest(deps.databases.control, id);
  if (row === undefined) throw siteFail.requestNotFound();
  return row;
}

const badPage = (): ApiError => new ApiError("INVALID_QUERY", 400, "page must be 1 to 9999");

export const registerSiteAdministrators: SliceRegistrar = (group, deps) => {
  const changeRole =
    (kind: "promote" | "demote"): RouteHandler<typeof promoteRoute, ApiEnv> =>
    async (c) => {
      const actor = principalOf(c);
      const { id } = c.req.valid("param");
      await requireSiteActStepUp(deps, c, kind, id, actor.userId);
      const outcome = await requestOrApplySiteAct(deps, {
        kind,
        target: id,
        requester: actor.userId,
        payload: {},
      });
      if (outcome.held !== undefined) return c.json({ request: requestView(outcome.held) }, 202);
      return c.json({ account: accountView(await accountOf(deps.databases.control, id)) }, 200);
    };
  group.openapi(promoteRoute, changeRole("promote"));
  group.openapi(demoteRoute, changeRole("demote"));

  group.openapi(listApprovalRequestsRoute, async (c) => {
    const query = c.req.valid("query");
    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isInteger(page) || page < 1) throw badPage();
    const { rows, total } = await listApprovalRequests(deps.databases.control, {
      ...(query.scope === undefined ? {} : { scope: query.scope }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    return c.json({ requests: rows.map(requestView), page, total }, 200);
  });

  group.openapi(getApprovalRequestRoute, async (c) => {
    const { id } = c.req.valid("param");
    return c.json({ request: requestView(await requestOf(deps, id)) }, 200);
  });

  group.openapi(approveRequestRoute, async (c) => {
    const actor = principalOf(c);
    const { id } = c.req.valid("param");
    const request = await requestOf(deps, id);
    if (request.scope !== "site") throw siteFail.notHere();
    if (request.requestedBy === actor.userId) throw siteFail.ownRequest();
    if (request.target === actor.userId) throw siteFail.targetDecides();
    await requireStepUp(deps, c);
    const approved = await approveSiteRequest(deps, request, actor.userId);
    return c.json(
      {
        request: requestView(approved.request),
        ...(approved.delivery === undefined ? {} : { delivery: approved.delivery }),
      },
      200,
    );
  });

  group.openapi(rejectRequestRoute, async (c) => {
    const actor = principalOf(c);
    const { id } = c.req.valid("param");
    const rejected = await rejectSiteRequest(deps, await requestOf(deps, id), actor.userId);
    return c.json({ request: requestView(rejected) }, 200);
  });
};
