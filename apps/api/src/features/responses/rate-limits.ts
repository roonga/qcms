/**
 * Respondent rate limiters (task 026), built on 017's pluggable store +
 * middleware. One limiter per endpoint class, each keyed by the natural abuse
 * unit and namespaced so classes never share a bucket:
 *
 * - **session-create** - per client IP (no session exists yet).
 * - **answers (per session)** - the sustained-rate + burst ceiling on one flow.
 * - **answers (per IP)** - a wide backstop against many-session floods.
 * - **submit (per session)** - the per-session submit ceiling.
 *
 * Over a class's limit the shared `rateLimit` middleware throws a 429 with
 * `Retry-After` and the `x-ratelimit-*` headers, and leaks no internal state
 * (SECURITY). The middlewares mount on the specific route path in each slice's
 * registrar; the store comes from `deps` (in-memory default, Redis-swappable).
 */

import type { Context, MiddlewareHandler } from "hono";

import type { Deps } from "../../deps.js";
import { rateLimit } from "../../rate-limit.js";

/**
 * The client IP as seen through the portal BFF / ingress. Mirrors the
 * `rateLimit` default: first `x-forwarded-for` hop, then `x-real-ip`, then a
 * fixed sentinel so a header-less caller still shares one bucket (fail-safe:
 * one anonymous bucket, never per-request unlimited). IP is a soft signal
 * (proxies/NAT share addresses); it is never logged as PII here.
 */
export function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown-ip"
  );
}

/** The session id from the `/sessions/{id}/…` path param (the per-session key). */
function sessionParam(c: Context): string {
  return c.req.param("id") ?? "unknown-session";
}

/** `POST /sessions` - per client IP. */
export function sessionCreateLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.sessionCreate;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:session-create:${clientIp(c)}`,
  });
}

/** `POST /sessions/{id}/answers` - per session (sustained + burst). */
export function answersPerSessionLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.answersPerSession;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:answers-session:${sessionParam(c)}`,
  });
}

/** `POST /sessions/{id}/answers` - per client IP (flood backstop). */
export function answersPerIpLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.answersPerIp;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:answers-ip:${clientIp(c)}`,
  });
}

/** `POST /sessions/{id}/submit` - per session. */
export function submitPerSessionLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.submitPerSession;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:submit-session:${sessionParam(c)}`,
  });
}
