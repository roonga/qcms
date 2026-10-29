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

// `registerAdminAuth` must precede this in the admin bucket so its gate runs first.
export const registerWebhooks: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(createWebhookRoute, makeCreateWebhookHandler(deps));
  group.openapi(listWebhooksRoute, makeListWebhooksHandler(deps));
  group.openapi(updateWebhookRoute, makeUpdateWebhookHandler(deps));
  group.openapi(deactivateWebhookRoute, makeDeactivateWebhookHandler(deps));
  group.openapi(listEndpointProposalsRoute, makeListEndpointProposalsHandler(deps));
  group.openapi(confirmEndpointProposalRoute, makeConfirmEndpointProposalHandler(deps));
  group.openapi(withdrawEndpointProposalRoute, makeWithdrawEndpointProposalHandler(deps));
};
