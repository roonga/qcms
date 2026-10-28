import { trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

import type { Deps } from "../deps.js";
import { ApiError } from "../errors.js";
import type { ApiEnv } from "../openapi.js";
import type { SliceRegistrar } from "../app.js";

/**
 * On the SEC-13 span allowlist: the value is an operator's own schema name, never
 * derived from a respondent, and carries no answer, token or identity.
 */
export const ENVIRONMENT_ATTRIBUTE = "qcms.environment";

function selectEnvironment(c: Parameters<MiddlewareHandler<ApiEnv>>[0], environment: string): void {
  c.set("requestEnvironment", environment);
  trace.getActiveSpan()?.setAttribute(ENVIRONMENT_ATTRIBUTE, environment);
}

export const REQUEST_ENVIRONMENT_HEADER = "x-qcms-environment";

/**
 * Mounted on the admin group only, so a respondent request has no header to set: there
 * is no anonymous entry to a non-prod environment (SEC-14, ADR-09). An unknown name is
 * refused rather than defaulted, because serving an unknown environment from `prod` is
 * the failure that rule exists to prevent.
 */
export function requestEnvironment(deps: Deps): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const named = c.req.header(REQUEST_ENVIRONMENT_HEADER)?.trim();
    if (named !== undefined && named !== "") {
      if (!deps.databases.names.includes(named)) {
        // Naming the refused value is safe here: it is the operator's own switcher
        // value, not respondent input.
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
 * Reads nothing from the request: a respondent's environment is the group's own,
 * decided at mount time, so they have no way to name one (SEC-14).
 *
 * Not a registrar, because a slice must not be able to choose which environment its
 * routes read.
 */
export function fixedEnvironment(environment: string): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    selectEnvironment(c, environment);
    await next();
  };
}

/**
 * Must stay after the auth gate, so a `401` is the first answer an unauthenticated
 * admin request gets rather than a complaint about an environment name.
 */
export const registerRequestEnvironment: SliceRegistrar = (group, deps) => {
  group.use("*", requestEnvironment(deps));
};
