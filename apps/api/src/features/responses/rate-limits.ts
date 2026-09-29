/**
 * Respondent rate limiters (task 026), built on 017's pluggable store +
 * middleware. One limiter per endpoint class, each keyed by the natural abuse
 * unit and namespaced so classes never share a bucket:
 *
 * - **session-create** - per client address (no session exists yet).
 * - **answers (per session)** - the sustained-rate + burst ceiling on one flow.
 * - **answers (per IP)** - a wide backstop against many-session floods.
 * - **submit (per session)** - the per-session submit ceiling.
 * - **roster (per session, per IP)** - the repeating-group Add and Remove (073,
 *   SEC-16), which is a distinct action that is cheap to repeat and therefore gets its
 *   own class rather than riding the answer write's.
 *
 * Over a class's limit the shared `rateLimit` middleware throws a 429 with
 * `Retry-After` and the `x-ratelimit-*` headers, and leaks no internal state
 * (SECURITY). The middlewares mount on the specific route path in each slice's
 * registrar; the store comes from `deps` (in-memory default, Redis-swappable).
 */

import type { Context, MiddlewareHandler } from "hono";

import { clientAddress } from "../../client-address.js";
import type { Deps } from "../../deps.js";
import { errors } from "../../errors.js";
import { rateLimit } from "../../rate-limit.js";

/**
 * The client address the calling BFF vouched for, or the shared fallback bucket.
 *
 * Delegates to `client-address.ts`, which is where the trust model lives: this
 * used to read the first `x-forwarded-for` entry, i.e. whichever claim the client
 * chose to write. IP remains a soft signal (proxies and NAT share addresses); it
 * is never logged as PII here (SEC-13).
 */
export function clientIp(c: Context): string {
  return clientAddress(c);
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

/** `POST /sessions/{id}/roster` - per session (task 073, SEC-16). */
export function rosterPerSessionLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.rosterPerSession;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:roster-session:${sessionParam(c)}`,
  });
}

/** `POST /sessions/{id}/roster` - per client IP (flood backstop). */
export function rosterPerIpLimiter(deps: Deps): MiddlewareHandler {
  const { windowMs, max } = deps.config.rateLimit.rosterPerIp;
  return rateLimit({
    store: deps.rateLimitStore,
    windowMs,
    max,
    keyFor: (c) => `rl:roster-ip:${clientIp(c)}`,
  });
}

/** The bucket key the per-session answer allowance is spent from. */
function answersSessionKey(sessionId: string): string {
  return `rl:answers-session:${sessionId}`;
}

/**
 * Spend `entries` units of the per-session **answer** allowance, and refuse the whole
 * batch when they do not fit (task 073, Q20, SEC-16).
 *
 * **Why the batch counts entries rather than requests.** `answersPerSessionLimiter`
 * spends one unit per request, which is exactly right while one request carries one
 * answer. The batch endpoint carries a whole step, which at nine passengers and six
 * questions is fifty-four answers, so leaving the limiter as it is would multiply a
 * per-session allowance written for ONE answer by the batch size - and with no
 * installation-wide instance ceiling (Q14) the batch size is whatever `max` the
 * author declared. Saying the limits were "unchanged" would then be a weakening dressed
 * as continuity. **The configured allowance does not move; what is fixed is the unit
 * it is spent in.**
 *
 * **It is the SAME bucket** the single-answer route's middleware spends from, so the
 * allowance is genuinely shared and a caller cannot get a second one by batching.
 *
 * **Refused rather than partially applied.** The spend happens before any entry is
 * written, so a batch that cannot be paid for in full writes nothing. The units are
 * spent either way, which is what a fixed-window counter does and is the honest
 * behaviour: an over-large batch has cost the window's allowance.
 *
 * **Why a loop and not a `cost` argument on the store.** `RateLimitStore` is a
 * documented adopter seam (the in-memory default is Redis-swappable), and adding an
 * optional `cost` to `hit` would leave an existing implementation silently
 * under-counting - a weakened limit that no test would see. Spending one unit at a
 * time works against every implementation of the interface as it stands, and the cost
 * is N increments of a map for a batch the request-size limits already bound.
 */
export async function spendAnswerAllowance(
  deps: Deps,
  sessionId: string,
  entries: number,
): Promise<void> {
  const { windowMs, max } = deps.config.rateLimit.answersPerSession;
  const key = answersSessionKey(sessionId);
  let count = 0;
  for (let spent = 0; spent < entries; spent += 1) {
    ({ count } = await deps.rateLimitStore.hit(key, windowMs));
  }
  if (count > max) throw errors.tooManyRequests();
}
