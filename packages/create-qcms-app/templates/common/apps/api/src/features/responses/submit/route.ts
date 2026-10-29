import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, jsonBody, withScopes } from "../../../openapi.js";
import { submitPerSessionLimiter } from "../rate-limits.js";
import { makeSubmitHandler } from "./handler.js";
import { SessionParams, SubmitBody, SubmitResponse } from "./schema.js";

export const submitRoute = createRoute({
  method: "post",
  path: "/sessions/{id}/submit",
  summary:
    "Submit the session: validate visible-required answers, lock the set, emit the outbox event (session-token authed)",
  tags: ["responses"],
  request: {
    params: SessionParams,
    // The one open body in this API: it has no sink, and the no-JS path forwards every
    // posted field the compiled document did not tag as an answer control.
    body: jsonBody(SubmitBody, {
      openBecause:
        "This body has no sink - the handler reads one key, the stored submission and " +
        "the outbox payload come from the answer ledger, and the body is never logged - " +
        "and the no-JS path forwards every posted form field the compiled document did " +
        "not tag as an answer control, so an undeclared key must reach the handler " +
        "rather than be refused (Code Owner, 2026-09-24, issue #893).",
    }),
  },
  responses: {
    200: {
      description: "The submission receipt (also returned idempotently on re-submit)",
      content: { "application/json": { schema: SubmitResponse } },
    },
    ...errorResponses(400, 401, 404, 409, 422),
  },
  ...withScopes("responses:write"),
});

export const registerSubmit: SliceRegistrar = (group, deps: Deps): void => {
  group.use("/sessions/:id/submit", submitPerSessionLimiter(deps));
  group.openapi(submitRoute, makeSubmitHandler(deps));
};
