/**
 * Route definition for the submit slice (task 020): `POST
 * /sessions/{id}/submit` - validate every visible-required answer through the
 * kernel, lock the answer set, and write the `response.submitted` outbox event
 * in one transaction (the audit boundary).
 *
 * Declared with `@hono/zod-openapi` `createRoute` (017's mandatory convention)
 * so the generated OpenAPI documents (027) cannot drift. `withScopes` annotates
 * the SEC-5 intent for the reserved `/api/v1` surface; it enforces nothing at
 * launch. Lives on the **public** (respondent-facing) surface behind the
 * internal service-token guard (SEC-4), authed per-session by the session token.
 */

import { createRoute } from "@hono/zod-openapi";

import type { SliceRegistrar } from "../../../app.js";
import type { Deps } from "../../../deps.js";
import { errorResponses, withScopes } from "../../../openapi.js";
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
    body: {
      required: true,
      content: { "application/json": { schema: SubmitBody } },
    },
  },
  responses: {
    200: {
      description: "The submission receipt (also returned idempotently on re-submit)",
      content: { "application/json": { schema: SubmitResponse } },
    },
    // 422: at least one visible-required answer is missing or invalid.
    ...errorResponses(401, 404, 409, 422),
  },
  ...withScopes("responses:read"),
});

/** Register the submit route on a public surface group. */
export const registerSubmit: SliceRegistrar = (group, deps: Deps): void => {
  // Submit is rate-limited per session (task 026): repeated submit attempts on
  // one session are bounded. Scoped to the submit path only.
  group.use("/sessions/:id/submit", submitPerSessionLimiter(deps));
  group.openapi(submitRoute, makeSubmitHandler(deps));
};
