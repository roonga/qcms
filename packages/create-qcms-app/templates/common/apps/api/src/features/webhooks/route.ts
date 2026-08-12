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
import { errorResponses, withScopes } from "../../openapi.js";
import {
  makeCreateWebhookHandler,
  makeDeactivateWebhookHandler,
  makeListWebhooksHandler,
  makeUpdateWebhookHandler,
} from "./handler.js";
import {
  CreatedWebhookResponse,
  CreateWebhookBody,
  DeactivatedWebhookResponse,
  FormIdParam,
  UpdatedWebhookResponse,
  UpdateWebhookBody,
  WebhookListResponse,
  WebhookParams,
} from "./schema.js";

const tags = ["webhooks"];

export const createWebhookRoute = createRoute({
  method: "post",
  path: "/forms/{id}/webhooks",
  summary: "Configure a webhook for a form; the secret is shown once (admin)",
  tags,
  request: {
    params: FormIdParam,
    body: { required: true, content: { "application/json": { schema: CreateWebhookBody } } },
  },
  responses: {
    201: {
      description: "The created webhook; `secret` is shown exactly once here",
      content: { "application/json": { schema: CreatedWebhookResponse } },
    },
    // 400: malformed form id. 404: no such form. 422: URL rejected (scheme/SSRF).
    ...errorResponses(400, 401, 404, 422),
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
    body: { required: true, content: { "application/json": { schema: UpdateWebhookBody } } },
  },
  responses: {
    200: {
      description: "The updated webhook; `secret` present only when this call rotated it",
      content: { "application/json": { schema: UpdatedWebhookResponse } },
    },
    ...errorResponses(400, 401, 404, 422),
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
    ...errorResponses(400, 401, 404),
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
};
