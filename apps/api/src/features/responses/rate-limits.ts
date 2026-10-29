import type { Context, MiddlewareHandler } from "hono";

import { clientAddress } from "../../client-address.js";
import type { Deps } from "../../deps.js";
import { errors } from "../../errors.js";
import { rateLimit } from "../../rate-limit.js";

export function clientIp(c: Context): string {
  return clientAddress(c);
}

function sessionParam(c: Context): string {
  return c.req.param("id") ?? "unknown-session";
}

export function sessionCreateLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.sessionCreate;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:session-create:${clientIp(c)}`,
  });
}

export function answersPerSessionLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.answersPerSession;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:answers-session:${sessionParam(c)}`,
  });
}

export function answersPerIpLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.answersPerIp;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:answers-ip:${clientIp(c)}`,
  });
}

export function submitPerSessionLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.submitPerSession;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:submit-session:${sessionParam(c)}`,
  });
}

export function rosterPerSessionLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.rosterPerSession;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:roster-session:${sessionParam(c)}`,
  });
}

export function rosterPerIpLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.rosterPerIp;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:roster-ip:${clientIp(c)}`,
  });
}

function answersSessionKey(sessionId: string): string {
  return `rl:answers-session:${sessionId}`;
}

/**
 * Spends one unit per entry from the same bucket the single-answer route uses, so
 * batching cannot buy a second allowance; spent before any write, so an unaffordable
 * batch writes nothing. One unit at a time because `RateLimitStore.hit` has no cost
 * argument and adding one would leave adopter implementations under-counting.
 */
export async function spendAnswerAllowance(
  deps: Deps,
  sessionId: string,
  entries: number,
  stepBound: number,
): Promise<void> {
  const { windowMs, max } = deps.config.rateLimit.answersPerSession;
  // The step's own bound is a floor on the ceiling: otherwise a step larger than `max`
  // is permanently un-continuable, since every retry re-posts the same set into the same
  // fixed window. The bound is the author's declaration, so a caller cannot inflate it.
  const ceiling = Math.max(max, stepBound);
  if (entries > stepBound) throw errors.tooManyRequests();
  const key = answersSessionKey(sessionId);
  let count = 0;
  for (let spent = 0; spent < entries; spent += 1) {
    ({ count } = await deps.rateLimitStore.hit(key, windowMs));
  }
  if (count > ceiling) throw errors.tooManyRequests();
}
