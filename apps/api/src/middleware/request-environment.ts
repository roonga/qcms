/**
 * The environment a request is served from: **both** of the two sources ADR-40 names
 * (Q2), one per export.
 *
 * # The two sources, and why there is no third
 *
 * Until task 065 every request resolved to the `prod` pool, because neither source
 * existed (Q53). ADR-40 names them: the **`/<env>/` route group** on the respondent side
 * (Q21, task 066) and **one global switcher in the admin shell** on the authoring side
 * (Q6, task 065). {@link fixedEnvironment} is the first and {@link requestEnvironment} is
 * the second, and both land their answer in the same context key, so every handler reads
 * one thing.
 *
 * They differ in exactly what a client can influence, which is the security half.
 * {@link requestEnvironment} reads a header, validates it against the live set and
 * refuses an unknown name - an authenticated administrator chose it. {@link
 * fixedEnvironment} reads **nothing**: the environment is the group's own, decided when
 * the process mounted it, so a respondent has no way to name one. That is what keeps
 * "test is reachable through secure links only" (ADR-40, SEC-14) a routing fact.
 *
 * # Why a header, and why only on the admin group
 *
 * A header rather than a query parameter on each route, because the switcher sets the
 * environment for **every** screen: a parameter would have to be added to every admin
 * route's contract and then remembered on each new one, and a route that forgot it would
 * quietly read `prod` while the operator was looking at a banner that said `test`. One
 * middleware, mounted once, cannot be forgotten by a route that does not exist yet.
 *
 * And **only** on the admin group, which is the security half. A respondent request has
 * no header to set, because this middleware is not in front of it:
 * `registrars.ts` installs it in the admin bucket beside the admin-auth gate, and
 * `app.ts` puts {@link fixedEnvironment} in front of each respondent group instead, so
 * "there is no anonymous entry to a non-prod environment" (SEC-14, ADR-09) stays a
 * property of what is mounted rather than a check a handler could skip.
 *
 * # An unknown name is refused, never defaulted
 *
 * `Databases.for` throws on an environment this process holds no pool for, and a throw
 * from inside a handler is a 500. So the name is validated here against the live set and
 * refused with a 400, for the reason Q19 refuses a default when minting a link: a
 * request whose environment is unknown is a request whose environment is unknown, and
 * serving it from `prod` is the failure that rule exists to prevent. An **absent** header
 * is a different case and is not an error: it means the client named nothing, and the
 * fallback is the interim `prod` of Q53.
 */

import { trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";
import type { ApiEnv } from "../openapi.js";
import type { SliceRegistrar } from "../app.js";

/**
 * The span attribute carrying the environment a request was served from (SEC-13's
 * allowlist, criterion 6 of task 067).
 *
 * # Why a trace needs it, and why it is safe
 *
 * One process serves every environment (Q2), so without this a trace from a `test`
 * respondent and a trace from a production one are indistinguishable in a backend: the
 * route, the status and the timings are identical and the only thing that differs is which
 * pool the span's database child ran on, which the `db.namespace` attribute reports as a
 * schema name rather than as an environment. An operator asking "is production slow"
 * cannot answer it from a trace that does not say.
 *
 * It **names no respondent**, which is the other half of the criterion. The value is an
 * operator's own name for a schema, out of `control.environments`, matching
 * `^[a-z][a-z0-9]*$` and validated against the live set before it reaches here. It is not
 * derived from a respondent, it is the same handful of strings for every request in a
 * deployment, and it carries no answer, no token and no identity - so it is an attribute
 * on the allowlist rather than a value the allowlist exists to drop.
 *
 * Set here, in the two middlewares that decide the environment, rather than in each
 * handler: `@opentelemetry/api` is a no-op when no SDK is registered, so the call costs
 * nothing when tracing is off, and a handler that has to remember a span attribute is a
 * handler that can forget one.
 */
export const ENVIRONMENT_ATTRIBUTE = "qcms.environment";

/** Stash the request's environment and record it on the active span (SEC-13). */
function selectEnvironment(
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  environment: string,
): void {
  c.set("requestEnvironment", environment);
  trace.getActiveSpan()?.setAttribute(ENVIRONMENT_ATTRIBUTE, environment);
}

/**
 * The header the admin shell's switcher sends on every API call (Q6).
 *
 * Lower-case, `x-qcms-` prefixed, like `x-qcms-internal-token` and
 * `x-qcms-admin-session`. The admin sets it in the one place it assembles request
 * headers (`apps/admin/lib/server/api.ts`), which is the R2 property that makes "every
 * screen" one edit rather than one per screen.
 */
export const REQUEST_ENVIRONMENT_HEADER = "x-qcms-environment";

/**
 * Read, validate and stash the request's environment.
 *
 * Validation is against `databases.names`, the set this process holds a pool for, which
 * boot has already reconciled with `control.environments` (criterion 6a of task 064). So
 * a name that passes here is a name every downstream `forRequest` call can resolve.
 */
export function requestEnvironment(deps: Deps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const named = c.req.header(REQUEST_ENVIRONMENT_HEADER)?.trim();
    if (named !== undefined && named !== "") {
      if (!deps.databases.names.includes(named)) {
        // The name is the operator's own switcher value, not respondent input, and this
        // deployment's environment set is not a secret from an authenticated
        // administrator - so the refusal says which name it refused.
        throw new ApiError(
          "UNKNOWN_ENVIRONMENT",
          400,
          `This deployment serves no environment named ${named}`,
        );
      }
      selectEnvironment(c, named);
    }
    await next();
  };
}

/**
 * The environment one **respondent** group serves, decided at mount time (Q21).
 *
 * `app.ts` installs this on each respondent group: `prod`'s, at the unprefixed
 * addresses, and one per mounted non-prod environment at `/<env>`. It reads nothing from
 * the request, which is the point - the address a respondent used is the whole of how
 * their environment is chosen, and the server-side link row is what decides whether that
 * address was the right one for their token (Q21: "the path names it, the row decides
 * it").
 *
 * Not a registrar, because it is not a slice's: a slice declares routes and must not be
 * able to choose which environment they read. `createApp` is the only caller.
 */
export function fixedEnvironment(environment: string): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    selectEnvironment(c, environment);
    await next();
  };
}

/**
 * The admin-group registrar, wired by `registrars.ts` directly after the auth gate.
 *
 * After the gate rather than before it so an unauthenticated request is refused by the
 * gate rather than by an environment name it had no business sending, which keeps the
 * `401` the first answer any unauthenticated admin request gets.
 */
export const registerRequestEnvironment: SliceRegistrar = (group, deps) => {
  group.use("*", requestEnvironment(deps));
};
