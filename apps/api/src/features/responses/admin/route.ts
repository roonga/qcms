/**
 * Route definitions for the response listing / export / erasure admin slices
 * (task 023) — the launch-scope **data-out** surface for authors: browse,
 * export, erase.
 *
 * Every route is declared with `@hono/zod-openapi` `createRoute` (017's
 * convention) and carries its SEC-5 scope intent via `withScopes`, kept
 * deliberately narrow and **never bundled**:
 *   - `responses:read`   — list + detail (answer data, admin-only reads)
 *   - `responses:export` — CSV/JSON export (bulk answer egress)
 *   - `responses:erase`  — erasure (destructive) *and* the flag-release (unflag),
 *     the two per-response disposition mutations; grouping unflag here keeps
 *     response-mutating authority out of the read/export scopes. (A dedicated
 *     `responses:moderate` scope is a Phase-4 refinement — see the README.)
 * Scopes are inert at launch (the `/api/v1` surface is reserved, R7); annotating
 * them now makes Phase-4 activation wiring, not archaeology.
 *
 * The admin group is guarded by the internal service-token gate (SEC-4) and the
 * admin-auth gate (`registerAdminAuth`) before any handler runs; in a public-only
 * process the group is not mounted, so these paths 404, never 403 (ADR-09).
 *
 * The **export** route intentionally declares no `200` body schema: it returns a
 * streamed `text/csv` / `application/json` `Response` (memory-bounded, R4 web
 * `ReadableStream`), which a content-typed OpenAPI response would not permit.
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, withScopes } from "../../../openapi.js";
import {
  makeEraseHandler,
  makeExportHandler,
  makeGetResponseHandler,
  makeListErasuresHandler,
  makeListResponsesHandler,
  makeUnflagHandler,
} from "./handler.js";
import {
  EraseBody,
  EraseResponse,
  ErasuresResponse,
  ExportQuery,
  FormIdParam,
  FormResponseParams,
  ListErasuresQuery,
  ListResponsesQuery,
  ResponseDetailResponse,
  ResponseListResponse,
  SessionIdParam,
  UnflagResponse,
} from "./schema.js";

const tags = ["responses"];

export const listResponsesRoute = createRoute({
  method: "get",
  path: "/forms/{id}/responses",
  summary: "List submitted responses for a form (paginated, filterable) (admin)",
  tags,
  request: { params: FormIdParam, query: ListResponsesQuery },
  responses: {
    200: {
      description: "A page of submitted responses (erased sessions excluded)",
      content: { "application/json": { schema: ResponseListResponse } },
    },
    ...errorResponses(400, 401),
  },
  ...withScopes("responses:read"),
});

export const getResponseRoute = createRoute({
  method: "get",
  path: "/forms/{id}/responses/{sessionId}",
  summary: "Read one response: locked answers, audit ledger, content hash (admin)",
  tags,
  request: { params: FormResponseParams },
  responses: {
    200: {
      description: "The response detail with its append-only answer ledger",
      content: { "application/json": { schema: ResponseDetailResponse } },
    },
    // 404: no such non-erased submitted response for this form.
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:read"),
});

export const exportRoute = createRoute({
  method: "get",
  path: "/forms/{id}/export",
  summary: "Export submitted responses as CSV or JSON (streamed) (admin)",
  tags,
  request: { params: FormIdParam, query: ExportQuery },
  responses: {
    // No body schema: the handler streams a raw text/csv or application/json
    // Response (web ReadableStream, memory-bounded). Errors use the envelope.
    200: {
      description: "The export stream (text/csv or application/json; erased sessions excluded)",
    },
    // 400: CSV without a version, or a malformed filter.
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:export"),
});

export const eraseRoute = createRoute({
  method: "post",
  path: "/sessions/{sessionId}/erase",
  summary: "Erase a session's response (ADR-17); returns the tombstone (idempotent) (admin)",
  tags,
  request: {
    params: SessionIdParam,
    body: { required: true, content: { "application/json": { schema: EraseBody } } },
  },
  responses: {
    200: {
      description: "The erasure tombstone (existence without content)",
      content: { "application/json": { schema: EraseResponse } },
    },
    // 404: no such session (and no existing tombstone).
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:erase"),
});

export const listErasuresRoute = createRoute({
  method: "get",
  path: "/erasures",
  summary: "List erasure tombstones (compliance evidence) (admin)",
  tags,
  request: { query: ListErasuresQuery },
  responses: {
    200: {
      description: "The erasure tombstones, newest first",
      content: { "application/json": { schema: ErasuresResponse } },
    },
    ...errorResponses(400, 401),
  },
  ...withScopes("responses:read"),
});

export const unflagRoute = createRoute({
  method: "post",
  path: "/responses/{sessionId}/unflag",
  summary: "Release a withheld (flagged) response's outbox event (admin)",
  tags,
  request: { params: SessionIdParam },
  responses: {
    200: {
      description: "Whether this call released the withheld response.submitted event",
      content: { "application/json": { schema: UnflagResponse } },
    },
    // 404: no submission for this session.
    ...errorResponses(400, 401, 404),
  },
  ...withScopes("responses:erase"),
});

/**
 * Register every response data-out route on an admin group. The admin-auth gate
 * (`registerAdminAuth`) must precede this in the admin bucket so it runs first.
 */
export const registerAdminResponses: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(listResponsesRoute, makeListResponsesHandler(deps));
  group.openapi(getResponseRoute, makeGetResponseHandler(deps));
  group.openapi(exportRoute, makeExportHandler(deps));
  group.openapi(eraseRoute, makeEraseHandler(deps));
  group.openapi(listErasuresRoute, makeListErasuresHandler(deps));
  group.openapi(unflagRoute, makeUnflagHandler(deps));
};
