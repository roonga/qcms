/**
 * Rate-limiting store (task 017).
 *
 * The composition root defines the *interface* and ships an in-memory default;
 * Redis (or any shared store) is an adopter swap that implements the same
 * `RateLimitStore` — documented in `apps/api/CONTRIBUTING.md`, not a dependency
 * here. Per-group limits are wired by later tasks (026); 017 provides the store
 * and a middleware factory, and does not apply a global limit.
 *
 * The store is a fixed-window counter: `hit(key, windowMs)` increments the
 * count for the current window and returns the running count plus when the
 * window resets. Fetch-pure — no `node:*`; the clock is injected.
 */

import type { Clock } from "./clock.js";
import { errors } from "./errors.js";

export interface RateLimitResult {
  /** Requests seen for `key` in the current window, including this one. */
  readonly count: number;
  /** Epoch ms at which the current window resets. */
  readonly resetAt: number;
}

export interface RateLimitStore {
  /** Record a hit for `key` in a `windowMs` fixed window and return the tally. */
  hit(key: string, windowMs: number): Promise<RateLimitResult>;
  /** Forget a key (test/administrative reset). */
  reset(key: string): Promise<void>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window store — the single-process default. State is a `Map`;
 * expired buckets are lazily reset on next hit and periodically nothing else
 * touches them (a single process, bounded key space per window). Multi-instance
 * deployments swap in a shared store (Redis) implementing this interface.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly clock: Clock) {}

  hit(key: string, windowMs: number): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    const existing = this.buckets.get(key);
    if (existing === undefined || now >= existing.resetAt) {
      const bucket: Bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
      return Promise.resolve({ count: bucket.count, resetAt: bucket.resetAt });
    }
    existing.count += 1;
    return Promise.resolve({ count: existing.count, resetAt: existing.resetAt });
  }

  reset(key: string): Promise<void> {
    this.buckets.delete(key);
    return Promise.resolve();
  }
}

import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  readonly store: RateLimitStore;
  readonly windowMs: number;
  readonly max: number;
  /** Derives the bucket key from the request (default: client IP-ish header). */
  readonly keyFor?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

/**
 * Middleware factory enforcing `max` hits per `windowMs` per key. Over the
 * limit throws a 429 `ApiError` (the error envelope renders it). Not applied
 * globally by `createApp`; slices opt in per group (026).
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const keyFor =
    options.keyFor ??
    ((c) =>
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "anonymous");

  return async (c, next) => {
    const key = keyFor(c);
    const { count, resetAt } = await options.store.hit(key, options.windowMs);
    const remaining = Math.max(0, options.max - count);
    c.header("x-ratelimit-limit", String(options.max));
    c.header("x-ratelimit-remaining", String(remaining));
    c.header("x-ratelimit-reset", String(Math.ceil(resetAt / 1000)));
    if (count > options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      c.header("retry-after", String(retryAfterSec));
      throw errors.tooManyRequests();
    }
    await next();
  };
}
