/**
 * The token authenticates the channel, never the user: end-user authorization always
 * comes from the forwarded user credential (SEC-4). The accepted list exists so a
 * token can be rotated without downtime: accept old and new, then drop old.
 */

import type { MiddlewareHandler } from "hono";

import type { Deps } from "../deps.js";
import { errors } from "../errors.js";
import type { ApiEnv } from "../openapi.js";

const INTERNAL_TOKEN_HEADER = "x-qcms-internal-token";

function constantTimeEqual(a: string, b: string): boolean {
  // Fold length into the accumulator so unequal lengths still run a full pass.
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

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
