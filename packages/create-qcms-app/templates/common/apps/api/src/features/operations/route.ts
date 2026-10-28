/**
 * The Operations discovery route (decision 3 / Q87, Code Owner 2026-10-29).
 *
 * One route, and it is the answer to G02: a caller holding only `responses.*` grants
 * cannot use `GET /admin/forms`, which is `form: read`, so before this existed a
 * response-only account had no way to find the form whose responses it was granted. The
 * fix is **not** to widen that list's cell: it is a second, narrower list whose row is the
 * union of the operational cells and whose every field is gated by the cell that would
 * authorise reading it elsewhere.
 *
 * Who may call it is `features/membership/route-policy.ts`' one `anyOf` row, and the grant
 * middleware enforces it before this handler runs.
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../app.js";
import type { Deps } from "../../deps.js";
import { errorResponses, withScopes } from "../../openapi.js";
import { makeOperationsFormsHandler } from "./handler.js";
import { OperationsFormsQuery, OperationsFormsResponse } from "./schema.js";

export const operationsFormsRoute = createRoute({
  method: "get",
  path: "/operations/forms",
  summary: "The forms a caller may operate in one environment (admin)",
  description:
    "The operations forms table: bounded search, workspace and intake filters, stable " +
    "sorting and cursor pagination. A caller reaches it holding any one of `form: read`, " +
    "`response: read`, `response: erase` or `response: dispose`, and each row carries " +
    "only the fields the cells they hold for that form and environment would authorise " +
    "elsewhere: release state needs `form: read`, and response counts need " +
    "`response: read` for that exact form and environment. A count writes no " +
    "access-audit row, because an aggregate is not a read of anybody's answers. No " +
    "caller is served a draft, a draft flag, a latest version or a publication time. " +
    "The environment is an explicit query parameter and has no default, and a caller " +
    "holding nothing in it is served an empty page rather than a refusal.",
  tags: ["operations"],
  request: { query: OperationsFormsQuery },
  responses: {
    200: {
      description: "The page of forms, the matching total and the next cursor",
      content: { "application/json": { schema: OperationsFormsResponse } },
    },
    // 400: an unserved environment, a bad cursor or a limit out of range.
    ...errorResponses(400, 401, 403),
  },
  ...withScopes("forms:read"),
});

export const registerOperations: SliceRegistrar = (group, deps: Deps): void => {
  group.openapi(operationsFormsRoute, makeOperationsFormsHandler(deps));
};
