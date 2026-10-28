import { clientAddress } from "./client-address.js";
import type { Clock } from "./clock.js";
import { errors } from "./errors.js";

export interface RateLimitResult {
  /** Includes the hit that produced this result. */
  readonly count: number;
  /** Epoch ms. */
  readonly resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

interface Bucket {
  count: number;
  resetAt: number;
}

// ~165 bytes per entry, so roughly 16 MB of retained heap at capacity.
const DEFAULT_MAX_KEYS = 100_000;

// A small constant so a hit stays O(1); DEFAULT_MAX_KEYS is what makes the bound
// unconditional.
const SWEEP_SCAN = 8;

/**
 * Retained heap is O(`maxKeys`) however many distinct keys the process sees, so one
 * request from a never-seen-again client address cannot add a permanent entry.
 *
 * Eviction is LRU rather than oldest-window-first because evicting a live bucket forgives
 * its count: a key that is actively limiting somebody stays warm, while the one-shot keys
 * a distinct-address flood creates go cold at once. Under such a flood limiting weakens
 * instead of the process being killed for memory; absorbing that is the operator's layer
 * (ADR-20).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  /** Insertion order is recency order: every hit re-inserts its key. */
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;

  /**
   * A bad `maxKeys` throws rather than being coerced: coercion let `NaN` and `Infinity`
   * through, which disabled eviction while the store still reported a capacity.
   */
  constructor(
    private readonly clock: Clock,
    maxKeys: number = DEFAULT_MAX_KEYS,
  ) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new RangeError(
        `InMemoryRateLimitStore: maxKeys must be a positive integer, received ${String(maxKeys)}`,
      );
    }
    this.maxKeys = maxKeys;
  }

  get size(): number {
    return this.buckets.size;
  }

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
    // Delete first so a re-used key is re-inserted rather than updated in place, which
    // would strand it at its old position in the eviction order.
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
   * Expired buckets are swept before anything live is evicted. Deleting during `Map`
   * iteration is well defined: an entry removed before the iterator reaches it is skipped.
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
  readonly keyFor?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  // Keys on the address the calling BFF vouched for, never on a raw `x-forwarded-for`:
  // that is a client-chosen value, so it would be a client-chosen bucket.
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
