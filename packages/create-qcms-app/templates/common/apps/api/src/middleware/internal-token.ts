/**
 * Internal service-token middleware (task 017, SEC-4).
 *
 * Every internal-surface request must carry the deployment's internal service
 * token in `x-qcms-internal-token`. Both BFFs attach it on every call; a request
 * without it, or with a value not on the accepted list, is rejected 401. The
 * accepted list (`QCMS_INTERNAL_TOKEN`, comma-separated) exists for zero-downtime
 * rotation: sign new, accept old+new, drop old.
 *
 * The token authenticates the **channel**, never the user - end-user
 * authorization always comes from the forwarded user credential (admin session
 * or session token), handled by later auth middleware (021+/031). Comparison is
 * constant-time over the whole list so neither a match nor a length leaks via
 * timing.
 */

import type { MiddlewareHandler } from "hono";

import type { Deps } from "../deps.js";
import { errors } from "../errors.js";
import type { ApiEnv } from "../openapi.js";

const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

/** Constant-time string equality (no early exit on the first differing byte). */
function constantTimeEqual(a: string, b: string): boolean {
  // Fold length into the accumulator so unequal lengths still run a full pass.
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** True iff `provided` matches any accepted token; scans the whole list. */
function isAccepted(provided: string, accepted: readonly string[]): boolean {
  let ok = false;
  for (const candidate of accepted) {
    // OR the result (no short-circuit) so timing doesn't reveal the match index.
    ok = constantTimeEqual(provided, candidate) || ok;
  }
  return ok;
}

export function internalToken(deps: Deps): MiddlewareHandler<ApiEnv> {
  const accepted = deps.config.keys.internal;
  return async (c, next) => {
    const provided = c.req.header(INTERNAL_TOKEN_HEADER);
    if (provided === undefined || provided === "" || !isAccepted(provided, accepted)) {
      throw errors.unauthorized("Missing or invalid internal service token");
    }
    await next();
  };
}
