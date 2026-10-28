// The scope taxonomy has no operations scope, so these delivery-ops routes annotate with
// `webhooks:manage`: the same authority that configures the webhooks being operated.

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, withScopes } from "../../openapi.js";
import { makeDeadLettersHandler, makeDeliveriesHandler, makeRedeliverHandler } from "./handler.js";
import {
  DeadLettersResponse,
  DeliveriesQuery,
  DeliveriesResponse,
  FormDeliveryParams,
  FormIdParam,
  RedeliverResponse,
} from "./schema.js";

const tags = ["outbox"];

export const deliveriesRoute = createRoute({
  method: "get",
  path: "/forms/{id}/deliveries",
  summary: "List a form's recent webhook deliveries with last-attempt detail (admin)",
  tags,
  request: { params: FormIdParam, query: DeliveriesQuery },
  responses: {
    200: {
      description: "The form's recent deliveries, newest first",
      content: { "application/json": { schema: DeliveriesResponse } },
    },
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("webhooks:manage"),
});

export const deadLettersRoute = createRoute({
  method: "get",
  path: "/outbox/dead-letters",
  summary: "List dead-lettered webhook deliveries with attempt history (admin)",
  tags,
  responses: {
    200: {
      description: "The dead-lettered deliveries, newest first",
      content: { "application/json": { schema: DeadLettersResponse } },
    },
    ...errorResponses(401),
  },
  ...withScopes("webhooks:manage"),
});

export const redeliverRoute = createRoute({
  method: "post",
  path: "/forms/{id}/deliveries/{deliveryId}/redeliver",
  summary: "Reset a dead-lettered delivery for immediate redelivery (admin)",
  tags,
  request: { params: FormDeliveryParams },
  responses: {
    200: {
      description: "The delivery, reset to due-now; the next pass re-attempts it",
      content: { "application/json": { schema: RedeliverResponse } },
    },
    ...errorResponses(400, 401, 404, 409),
  },
  ...withScopes("webhooks:manage"),
});

// `registerAdminAuth` must be registered on the admin bucket before this, so the auth
// gate runs ahead of these handlers.
export const registerOutboxOps: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(deadLettersRoute, makeDeadLettersHandler(deps));
  group.openapi(deliveriesRoute, makeDeliveriesHandler(deps));
  group.openapi(redeliverRoute, makeRedeliverHandler(deps));
};
