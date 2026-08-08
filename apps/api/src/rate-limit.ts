/**
 * Rate-limiting store (task 017).
 *
 * The composition root defines the *interface* and ships an in-memory default;
 * Redis (or any shared store) is an adopter swap that implements the same
 * `RateLimitStore` - documented in `apps/api/CONTRIBUTING.md`, not a dependency
 * here. Per-group limits are wired by later tasks (026); 017 provides the store
 * and a middleware factory, and does not apply a global limit.
 *
 * The store is a fixed-window counter: `hit(key, windowMs)` increments the
 * count for the current window and returns the running count plus when the
 * window resets. Fetch-pure - no `node:*`; the clock is injected.
 */

import { clientAddress } from "./client-address.js";
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
 * Default capacity of {@link InMemoryRateLimitStore}. At the ~165 bytes per
 * entry measured on issue #376 this is roughly 16 MB of retained heap in the
 * worst case, which any container that can run the API at all has room for.
 */
const DEFAULT_MAX_KEYS = 100_000;

/**
 * Entries inspected from the cold end of the map on each new-window insertion,
 * looking for expired buckets to drop. A small constant, so a hit stays O(1):
 * this is the housekeeping that keeps a quiet deployment near its live key
 * count, while {@link DEFAULT_MAX_KEYS} is what makes the bound unconditional.
 */
const SWEEP_SCAN = 8;

/**
 * In-memory fixed-window store - the single-process default. Multi-instance
 * deployments swap in a shared store (Redis, with real per-key TTLs)
 * implementing this interface.
 *
 * ## What it guarantees about memory (issue #376)
 *
 * **The map never holds more than `maxKeys` entries.** That bound does not
 * depend on the traffic: every insertion first drops any expired buckets it
 * finds in the {@link SWEEP_SCAN} coldest entries, and then, if the map is
 * still full, evicts the least recently hit entry. So retained heap is
 * O(`maxKeys`) however many distinct keys the process ever sees, and a single
 * request from a never-seen-again client address can no longer add a permanent
 * entry. The doc comment here used to claim a "bounded key space per window",
 * which was only true while the address-keyed limiters had two possible keys;
 * once issue #341 gave each client address its own bucket the claim was false,
 * and unbounded growth was reachable from one unauthenticated request.
 *
 * ## Why eviction is LRU rather than "oldest window first"
 *
 * Evicting a live bucket forgives its count, so the order has to put the
 * buckets that are actively limiting somebody last. Recency does that: a
 * respondent being throttled right now keeps touching their key, which keeps it
 * at the warm end, while the one-shot keys a distinct-address flood creates go
 * cold immediately and are evicted first. Under such a flood the store still
 * degrades - a key evicted before its window elapses starts again at zero - but
 * it degrades into weaker limiting instead of into an out-of-memory kill, and
 * absorbing traffic at that scale is the operator's layer (ADR-20).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  /**
   * Insertion order is recency order: `Map` iterates oldest-inserted first and
   * every hit re-inserts its key, so the first entry is the least recently hit.
   */
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;

  constructor(
    private readonly clock: Clock,
    maxKeys: number = DEFAULT_MAX_KEYS,
  ) {
    this.maxKeys = Math.max(1, Math.trunc(maxKeys));
  }

  /** Entries currently retained. Never exceeds the configured capacity. */
  get size(): number {
    return this.buckets.size;
  }

  /** The capacity this store was built with (the bound `size` respects). */
  get capacity(): number {
    return this.maxKeys;
  }

  hit(key: string, windowMs: number): Promise<RateLimitResult> {
    const now = this.clock.now().getTime();
    const existing = this.buckets.get(key);
    if (existing !== undefined && now < existing.resetAt) {
      existing.count += 1;
      // Re-insert to move the key to the warm end of the eviction order.
      this.buckets.delete(key);
      this.buckets.set(key, existing);
      return Promise.resolve({ count: existing.count, resetAt: existing.resetAt });
    }
    // A new key, or one whose window elapsed: both start a fresh window at the
    // warm end. Delete first so a re-used key is re-inserted, not updated in
    // place, which would leave it stranded at its old position in the order.
    this.buckets.delete(key);
    this.makeRoom(now);
    const bucket: Bucket = { count: 1, resetAt: now + windowMs };
    this.buckets.set(key, bucket);
    return Promise.resolve({ count: bucket.count, resetAt: bucket.resetAt });
  }

  reset(key: string): Promise<void> {
    this.buckets.delete(key);
    return Promise.resolve();
  }

  /**
   * Free a slot for one insertion. Sweeps expired buckets out of the coldest
   * {@link SWEEP_SCAN} entries first (the cheap, lossless reclaim), then evicts
   * from the cold end until there is room. Deleting during `Map` iteration is
   * well defined: an entry removed before the iterator reaches it is skipped.
   */
  private makeRoom(now: number): void {
    let scanned = 0;
    for (const [key, bucket] of this.buckets) {
      if (scanned >= SWEEP_SCAN) break;
      scanned += 1;
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
    while (this.buckets.size >= this.maxKeys) {
      const coldest = this.buckets.keys().next();
      if (coldest.done === true) return;
      this.buckets.delete(coldest.value);
    }
  }
}

import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
  readonly store: RateLimitStore;
  readonly windowMs: number;
  readonly max: number;
  /** Derives the bucket key from the request (default: the vouched client address). */
  readonly keyFor?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

/**
 * Middleware factory enforcing `max` hits per `windowMs` per key. Over the
 * limit throws a 429 `ApiError` (the error envelope renders it). Not applied
 * globally by `createApp`; slices opt in per group (026).
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  // The default keys on the address the calling BFF vouched for, never on a raw
  // `x-forwarded-for` (issue #341: that is a client-chosen value, so it is a
  // client-chosen bucket). See `client-address.ts` for the trust model.
  const keyFor = options.keyFor ?? clientAddress;

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
