// The answer to a response-only caller having no way to find its own forms:
// `GET /admin/forms` is `form: read`, and widening that cell is not the fix. Who may call
// this is the one `anyOf` row in `features/membership/route-policy.ts`.

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
    "Bounded search, workspace and intake filters, stable sorting and cursor pagination. " +
    "A caller reaches it holding any one of `form: read`, `response: read`, " +
    "`response: erase` or `response: dispose`, and each row carries only the fields the " +
    "cells they hold for that form and environment would authorise elsewhere: release " +
    "state needs `form: read`, and response counts need `response: read` for that exact " +
    "form and environment. A count writes no access-audit row, because an aggregate is " +
    "not a read of anybody's answers. No caller is served a draft, a draft flag, a " +
    "latest version or a publication time. The environment is an explicit query " +
    "parameter with no default, and a caller holding nothing in it is served an empty " +
    "page rather than a refusal.",
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
