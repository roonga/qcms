/**
 * Route definitions for the outbox delivery-operations admin slices (task 025) —
 * the operator surface for webhook dead-letters: inspect and manually redeliver.
 * 035 renders this.
 *
 * Every route is declared with `@hono/zod-openapi` `createRoute` (017's
 * convention) and carries its SEC-5 scope via `withScopes`. The launch scope
 * taxonomy has **no dedicated operations scope**; these delivery-ops actions are
 * the closest fit to `webhooks:manage` (the same authority that configures the
 * webhooks whose deliveries are being operated), so they annotate with it. A
 * `webhooks:operate` (or `outbox:manage`) split is a Phase-4 refinement. Scopes
 * are inert at launch (the `/api/v1` surface is reserved, R7).
 *
 * The admin group is guarded by the internal service-token gate (SEC-4) and the
 * admin-auth gate (`registerAdminAuth`) before any handler runs; in a public-only
 * process the group is not mounted, so these paths 404, never 403 (ADR-09).
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, withScopes } from "../../openapi.js";
import { makeDeadLettersHandler, makeRedeliverHandler } from "./handler.js";
import { DeadLettersResponse, DeliveryIdParam, RedeliverResponse } from "./schema.js";

const tags = ["outbox"];

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
  path: "/outbox/{id}/redeliver",
  summary: "Reset a dead-lettered delivery for immediate redelivery (admin)",
  tags,
  request: { params: DeliveryIdParam },
  responses: {
    200: {
      description: "The delivery, reset to due-now; the next pass re-attempts it",
      content: { "application/json": { schema: RedeliverResponse } },
    },
    // 404: no such delivery.
    ...errorResponses(401, 404),
  },
  ...withScopes("webhooks:manage"),
});

/**
 * Register the outbox delivery-ops routes on an admin group. The admin-auth gate
 * (`registerAdminAuth`) must precede this in the admin bucket so it runs first.
 */
export const registerOutboxOps: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(deadLettersRoute, makeDeadLettersHandler(deps));
  group.openapi(redeliverRoute, makeRedeliverHandler(deps));
};
