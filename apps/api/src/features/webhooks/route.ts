/**
 * Route definitions for the webhook-config admin slices (task 024).
 *
 * Every route is declared with `@hono/zod-openapi` `createRoute` (017's
 * convention) and carries its SEC-5 scope intent via `withScopes` -
 * `webhooks:manage` for all of them (inert at launch; annotated so `/api/v1`
 * activation is wiring, not archaeology). The admin group is guarded by the
 * internal service-token gate (SEC-4) and the admin-auth gate
 * (`registerAdminAuth`) before any handler runs; in a public-only process the
 * group is not mounted, so these paths 404, never 403 (ADR-09).
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../openapi.js";
import {
  makeConfirmEndpointProposalHandler,
  makeCreateWebhookHandler,
  makeDeactivateWebhookHandler,
  makeListEndpointProposalsHandler,
  makeListWebhooksHandler,
  makeUpdateWebhookHandler,
  makeWithdrawEndpointProposalHandler,
} from "./handler.js";
import {
  CreatedWebhookResponse,
  CreateWebhookBody,
  DeactivatedWebhookResponse,
  EndpointProposalListResponse,
  EndpointProposalParams,
  EndpointProposalResponse,
  FormIdParam,
  PendingEndpointChangeResponse,
  UpdatedWebhookResponse,
  UpdateWebhookBody,
  WebhookListResponse,
  WebhookParams,
} from "./schema.js";

/**
 * The `202` every configure route carries since task 070 (Q30, Q51).
 *
 * One description, declared once, because the three routes answer the same thing for the
 * same reason: the two-person rule holds for this workspace and this environment, so the
 * change is **stored pending** and has taken effect on nothing until a different
 * `forms.approver` holding `prod` in scope confirms it.
 */
const pendingResponse = {
  202: {
    description:
      "The workspace requires a second approver for production, so the change is stored " +
      "pending and takes effect on nothing until a different account confirms it",
    content: { "application/json": { schema: PendingEndpointChangeResponse } },
  },
};

const tags = ["webhooks"];

export const createWebhookRoute = createRoute({
  method: "post",
  path: "/forms/{id}/webhooks",
  summary: "Configure a webhook for a form; the secret is shown once (admin)",
  tags,
  request: {
    params: FormIdParam,
    body: jsonBody(CreateWebhookBody),
  },
  responses: {
    201: {
      description: "The created webhook; `secret` is shown exactly once here",
      content: { "application/json": { schema: CreatedWebhookResponse } },
    },
    ...pendingResponse,
    // 400: malformed form id. 404: no such form. 422: URL rejected (scheme/SSRF).
    // 409: this endpoint already has a change waiting for a second approver (task 070).
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("webhooks:manage"),
});

export const listWebhooksRoute = createRoute({
  method: "get",
  path: "/forms/{id}/webhooks",
  summary: "List a form's webhooks (secrets masked) (admin)",
  tags,
  request: { params: FormIdParam },
  responses: {
    200: {
      description: "The configured webhooks (secrets never included)",
      content: { "application/json": { schema: WebhookListResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("webhooks:manage"),
});

export const updateWebhookRoute = createRoute({
  method: "put",
  path: "/forms/{id}/webhooks/{webhookId}",
  summary: "Update a webhook (url/active) or rotate its secret; new secret shown once (admin)",
  tags,
  request: {
    params: WebhookParams,
    body: jsonBody(UpdateWebhookBody),
  },
  responses: {
    200: {
      description: "The updated webhook; `secret` present only when this call rotated it",
      content: { "application/json": { schema: UpdatedWebhookResponse } },
    },
    ...pendingResponse,
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("webhooks:manage"),
});

export const deactivateWebhookRoute = createRoute({
  method: "delete",
  path: "/forms/{id}/webhooks/{webhookId}",
  summary: "Soft-deactivate a webhook (stops delivery; row retained) (admin)",
  tags,
  request: { params: WebhookParams },
  responses: {
    200: {
      description: "The deactivated webhook",
      content: { "application/json": { schema: DeactivatedWebhookResponse } },
    },
    ...pendingResponse,
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("webhooks:manage"),
});

// --- the pending `prod` endpoint change (Q30, Q51; task 070) ----------------

export const listEndpointProposalsRoute = createRoute({
  method: "get",
  path: "/forms/{id}/webhooks/proposals",
  summary:
    "List endpoint changes waiting for a second approver, in the selected environment (admin)",
  tags,
  request: { params: FormIdParam },
  responses: {
    200: {
      description:
        "The endpoint changes that are pending, newest first; a proposed URL's query " +
        "string is masked for a caller holding only forms.viewer",
      content: { "application/json": { schema: EndpointProposalListResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("webhooks:manage"),
});

export const confirmEndpointProposalRoute = createRoute({
  method: "post",
  path: "/forms/{id}/webhooks/proposals/{proposalId}/confirm",
  summary: "Confirm a pending endpoint change; refused for the account that proposed it (admin)",
  tags,
  request: { params: EndpointProposalParams },
  responses: {
    200: {
      description: "The confirmed change, now applied to the endpoint",
      content: { "application/json": { schema: EndpointProposalResponse } },
    },
    // 403: the confirming account is the proposing one, or the caller does not hold
    // forms.approver with this environment in scope. 404: no such pending change for this
    // form in this environment. 409: somebody else confirmed or withdrew it first.
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("webhooks:manage"),
});

export const withdrawEndpointProposalRoute = createRoute({
  method: "delete",
  path: "/forms/{id}/webhooks/proposals/{proposalId}",
  summary: "Withdraw a pending endpoint change (admin)",
  tags,
  request: { params: EndpointProposalParams },
  responses: {
    200: {
      description: "The withdrawn change, which was applied to nothing",
      content: { "application/json": { schema: EndpointProposalResponse } },
    },
    ...errorResponses(400, 401, 403, 404, 409),
  },
  ...withScopes("webhooks:manage"),
});

/**
 * Register every webhook-config route on an admin group. The admin-auth gate
 * (`registerAdminAuth`) must precede this in the admin bucket so it runs first.
 */
export const registerWebhooks: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(createWebhookRoute, makeCreateWebhookHandler(deps));
  group.openapi(listWebhooksRoute, makeListWebhooksHandler(deps));
  group.openapi(updateWebhookRoute, makeUpdateWebhookHandler(deps));
  group.openapi(deactivateWebhookRoute, makeDeactivateWebhookHandler(deps));
  group.openapi(listEndpointProposalsRoute, makeListEndpointProposalsHandler(deps));
  group.openapi(confirmEndpointProposalRoute, makeConfirmEndpointProposalHandler(deps));
  group.openapi(withdrawEndpointProposalRoute, makeWithdrawEndpointProposalHandler(deps));
};
