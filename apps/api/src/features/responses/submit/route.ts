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
    // The one request body in this API that stays OPEN (#893). Two reasons, and
    // either alone would be enough. Functionally, the no-JS path forwards every
    // posted form field the compiled document did not tag as an answer control
    // (`extras` in `apps/portal/lib/server/step-form.ts`), and the honeypot field
    // name is deployment configuration, so a closed body would refuse a
    // legitimate submit the moment an operator renamed it. And as a matter of
    // anti-abuse, refusing an unknown key here would build the oracle this slice
    // exists to deny: `{"website":"x"}` answering 200 while `{"nickname":"x"}`
    // answers 400 tells a bot which field is the trap in two requests.
    body: jsonBody(SubmitBody, {
      openBecause:
        "The honeypot field name is deployment-configured and the no-JS path forwards " +
        "untagged form fields, so an unknown key must reach the handler rather than be " +
        "refused - and a refusal would tell a bot which field is the honeypot.",
    }),
  },
  responses: {
    200: {
      description: "The submission receipt (also returned idempotently on re-submit)",
      content: { "application/json": { schema: SubmitResponse } },
    },
    // 400: the route schema refuses a malformed session id or body shape before the
    // handler runs. 422: at least one visible-required answer is missing or invalid.
    ...errorResponses(400, 401, 404, 409, 422),
  },
  // A respondent *write* endpoint (locks the answer set): SEC-5
  // `responses:write`, not the `responses:read` it borrowed before the scope
  // existed (issue #15, reconciling the endpoint #7 did not name).
  ...withScopes("responses:write"),
});

/** Register the submit route on a public surface group. */
export const registerSubmit: SliceRegistrar = (group, deps: Deps): void => {
  // Submit is rate-limited per session (task 026): repeated submit attempts on
  // one session are bounded. Scoped to the submit path only.
  group.use("/sessions/:id/submit", submitPerSessionLimiter(deps));
  group.openapi(submitRoute, makeSubmitHandler(deps));
};
