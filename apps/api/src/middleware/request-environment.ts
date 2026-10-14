/**
 * The environment an **admin** request is served from: the Q6 switcher's value (ADR-40,
 * task 065).
 *
 * # What this replaces
 *
 * Until task 065 every request resolved to the `prod` pool, because neither of the two
 * real sources existed (Q53). ADR-40 names them: the `/<env>/` route group on the
 * respondent side (Q21, task 066) and **one global switcher in the admin shell** on the
 * authoring side (Q6, this task). This is that second source, and it is why the
 * respondent half of Q53 still stands: nothing here is mounted on the public group.
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
 * `registrars.ts` installs it in the admin bucket beside the admin-auth gate, so
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

import type { MiddlewareHandler } from "hono";

import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";
import type { ApiEnv } from "../openapi.js";
import type { SliceRegistrar } from "../app.js";

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
      c.set("requestEnvironment", named);
    }
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
