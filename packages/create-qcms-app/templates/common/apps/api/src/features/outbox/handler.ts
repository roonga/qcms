// Responses carry ids, urls, event types, attempt counts and value-free error codes only
// (SEC-8). Stored headers already have the HMAC masked at write time (SEC-6, SEC-13).

import type { RouteHandler } from "@hono/zod-openapi";
import { parseFormId } from "@roonga/qcms-core";
import {
  getForm,
  listDeadLetterDeliveries,
  listRecentDeliveries,
  redeliveryRefusalFor,
  resetDeliveryForRedelivery,
  type DeliveryView,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { endpointUrlFor } from "../webhooks/mask.js";
import type { deadLettersRoute, deliveriesRoute, redeliverRoute } from "./route.js";
import { isDeliveryId } from "./schema.js";

const fail = {
  deliveryNotFound: (): ApiError =>
    new ApiError("DELIVERY_NOT_FOUND", 404, "No such webhook delivery"),
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  // Deliberately cause-free: erasure and the retention sweep both redact a payload, and
  // the two are indistinguishable from the delivery row, so the code names the state.
  notRedeliverable: (): ApiError =>
    new ApiError(
      "DELIVERY_NOT_REDELIVERABLE",
      409,
      "The response this delivery carries is no longer held, so it will not be re-sent",
    ),
} as const;

const DEFAULT_DELIVERY_LIMIT = 50;
// Caps `?limit` so one request cannot pull the whole history.
const MAX_DELIVERY_LIMIT = 200;

export function makeDeadLettersHandler(deps: Deps): RouteHandler<typeof deadLettersRoute, ApiEnv> {
  return async (c) => {
    const rows = await listDeadLetterDeliveries(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
    );
    return c.json(
      {
        deadLetters: rows.map((r) => ({
          deliveryId: r.deliveryId,
          eventId: r.outboxId,
          eventType: r.eventType,
          webhookId: r.webhookId,
          // The worklist is cross-form and redelivery is form-scoped, so each row has to
          // carry the form needed to act on it.
          formId: r.formId,
          url: r.url,
          attempts: r.attempts,
          lastError: r.lastError,
          deadLetteredAt: r.deadLetteredAt === null ? null : r.deadLetteredAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
      },
      200,
    );
  };
}

// Check order matters: a row can carry several timestamps, so the latest outcome wins.
// `delivered` beats `cancelled` beats `deadLettered`.
function deliveryStatus(row: DeliveryView): "delivered" | "cancelled" | "deadLettered" | "pending" {
  if (row.deliveredAt !== null) return "delivered";
  if (row.cancelledAt !== null) return "cancelled";
  if (row.deadLetteredAt !== null) return "deadLettered";
  return "pending";
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_DELIVERY_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELIVERY_LIMIT;
  return Math.min(parsed, MAX_DELIVERY_LIMIT);
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function makeDeliveriesHandler(deps: Deps): RouteHandler<typeof deliveriesRoute, ApiEnv> {
  return async (c) => {
    const parsed = parseFormId(c.req.valid("param").id);
    if (!parsed.ok) throw fail.invalidId();
    const form = await getForm(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      parsed.value,
    );
    if (form === undefined) throw fail.formNotFound();

    const rows = await listRecentDeliveries(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      parsed.value,
      parseLimit(c.req.valid("query").limit),
    );
    // The URL masking has to reach this list too: it is the same stored URL reaching the
    // same role by a second route.
    const visibility = c.get("grantContext")?.endpointUrl;
    return c.json(
      {
        deliveries: rows.map((r) => ({
          deliveryId: r.deliveryId,
          eventId: r.outboxId,
          eventType: r.eventType,
          webhookId: r.webhookId,
          url: endpointUrlFor(r.url, visibility),
          status: deliveryStatus(r),
          attempts: r.attempts,
          lastError: r.lastError,
          createdAt: r.createdAt.toISOString(),
          deliveredAt: iso(r.deliveredAt),
          deadLetteredAt: iso(r.deadLetteredAt),
          cancelledAt: iso(r.cancelledAt),
          cancelledReason: r.cancelledReason,
          nextAttemptAt: r.nextAttemptAt.toISOString(),
          lastAttemptAt: iso(r.lastAttemptAt),
          lastStatus: r.lastStatus,
          latencyMs: r.lastLatencyMs,
          requestHeaders: r.lastRequestHeaders,
          responseSnippet: r.lastResponseSnippet,
          responseSnippetRedactedAt: iso(r.lastResponseSnippetRedactedAt),
        })),
      },
      200,
    );
  };
}

export function makeRedeliverHandler(deps: Deps): RouteHandler<typeof redeliverRoute, ApiEnv> {
  return async (c) => {
    const { id, deliveryId } = c.req.valid("param");

    // Every not-found outcome is one code so a caller cannot tell "malformed form" from "no
    // such delivery" from "not your form". The form is threaded into both queries below.
    const parsed = parseFormId(id);
    if (!parsed.ok) throw fail.deliveryNotFound();
    const formId = parsed.value;

    // Without this a malformed id reaches Postgres and raises `22P02` as a 500. The check
    // sits here rather than on the param schema because a schema rejection is a 400.
    if (!isDeliveryId(deliveryId)) throw fail.deliveryNotFound();

    // Refuse before resetting (ADR-17): a row the scheduler could never claim is not requeued.
    // Keep this read form-scoped, or 409 versus 404 reveals another form's row.
    if (
      (await redeliveryRefusalFor(
        deps.databases.forRequest(c.get("requestEnvironment")).exec,
        formId,
        deliveryId,
      )) !== undefined
    ) {
      throw fail.notRedeliverable();
    }

    const reset = await resetDeliveryForRedelivery(
      deps.databases.forRequest(c.get("requestEnvironment")).exec,
      formId,
      deliveryId,
      deps.clock.now(),
    );
    if (reset === undefined) throw fail.deliveryNotFound();
    return c.json(
      {
        deliveryId: reset.id,
        status: "pending" as const,
        attempts: 0 as const,
        nextAttemptAt: reset.nextAttemptAt.toISOString(),
      },
      200,
    );
  };
}
