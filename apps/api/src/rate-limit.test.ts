import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Clock } from "./clock.js";
import { ApiError } from "./errors.js";
import { InMemoryRateLimitStore, rateLimit } from "./rate-limit.js";

function mutableClock(start = 0): { clock: Clock; advance: (ms: number) => void } {
  let t = start;
  return {
    clock: { now: () => new Date(t) },
    advance: (ms) => {
      t += ms;
    },
  };
}

describe("InMemoryRateLimitStore", () => {
  it("counts hits within a window and resets after it", async () => {
    const { clock, advance } = mutableClock();
    const store = new InMemoryRateLimitStore(clock);
    expect((await store.hit("k", 1000)).count).toBe(1);
    expect((await store.hit("k", 1000)).count).toBe(2);
    advance(1000); // window elapsed
    expect((await store.hit("k", 1000)).count).toBe(1);
  });

  it("isolates keys", async () => {
    const { clock } = mutableClock();
    const store = new InMemoryRateLimitStore(clock);
    await store.hit("a", 1000);
    expect((await store.hit("b", 1000)).count).toBe(1);
  });
});

/**
 * The key space is bounded (issue #376).
 *
 * Before the fix the store was a bare `Map` with no eviction: one request from a
 * never-seen-again client address allocated a bucket for the process lifetime,
 * and an attacker sourcing addresses from an IPv6 /64 could grow it without
 * limit (~157-165 bytes per key, ~300 MB per million addresses across the two
 * address-keyed limiters). Both tests below fail against that shape - the first
 * observes 5,000 retained entries against a capacity of 64, the second 200
 * against 100 - because nothing ever removed an entry.
 */
describe("InMemoryRateLimitStore key-space bound", () => {
  it("never exceeds its capacity, however many distinct keys it sees", async () => {
    const { clock } = mutableClock();
    const store = new InMemoryRateLimitStore(clock, 64);
    let peak = 0;
    // The described attack: every key is fresh and never revisited, so eviction
    // driven by re-hitting a key would not help. Windows stay open throughout
    // (1 hour, clock never advanced), so no entry is reclaimable as expired.
    for (let i = 0; i < 5000; i++) {
      await store.hit(`rl:session-create:2001:db8::${i.toString(16)}`, 3_600_000);
      peak = Math.max(peak, store.size);
    }
    expect(store.capacity).toBe(64);
    expect(peak).toBeLessThanOrEqual(64);
    expect(store.size).toBeLessThanOrEqual(64);
  });

  it("reclaims expired buckets instead of retaining them forever", async () => {
    const { clock, advance } = mutableClock();
    // Capacity far above the traffic, so this measures the sweep alone: any
    // bound observed here comes from dropping expired entries, not from evicting.
    const store = new InMemoryRateLimitStore(clock, 1_000_000);
    for (let i = 0; i < 100; i++) await store.hit(`first:${i}`, 1000);
    expect(store.size).toBe(100);

    advance(1001); // every bucket above is now expired
    for (let i = 0; i < 100; i++) await store.hit(`second:${i}`, 1000);

    // The 100 expired buckets are gone; only the live generation is retained.
    expect(store.size).toBe(100);
  });

  /**
   * The bound has to survive its own constructor.
   *
   * The first cut normalized with `Math.max(1, Math.trunc(maxKeys))`, which
   * leaves `NaN` as `NaN` and `Infinity` as `Infinity`. Every comparison against
   * either is false, so `while (size >= maxKeys)` never ran and the store went
   * back to being the unbounded `Map` this class exists to not be, while still
   * answering `capacity`. Measured on that shape: `NaN` retained all 5,000
   * distinct keys and reported `capacity` `NaN`; `Infinity` retained all 300 and
   * reported `Infinity`. The other bad values were harmless but equally silent
   * (`-Infinity`, `0` and `-5` all became 1; `64.7` became 64), so none of them
   * is coerced now either. Each case below throws instead, and every one of them
   * constructs successfully on the pre-fix shape.
   */
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["a negative", -5],
    ["a fraction", 64.7],
  ])("refuses to build a store for %s rather than coercing the capacity", (_label, maxKeys) => {
    const { clock } = mutableClock();
    expect(() => new InMemoryRateLimitStore(clock, maxKeys)).toThrow(RangeError);
    expect(() => new InMemoryRateLimitStore(clock, maxKeys)).toThrow(/positive integer/);
  });

  it("accepts the capacities that are actually usable, unchanged", async () => {
    const { clock } = mutableClock();
    // The smallest legal capacity, and one reported back exactly as passed.
    expect(new InMemoryRateLimitStore(clock, 1).capacity).toBe(1);
    expect(new InMemoryRateLimitStore(clock, 250_000).capacity).toBe(250_000);
    // The default is what a caller that passes only a clock gets.
    const store = new InMemoryRateLimitStore(clock);
    expect(store.capacity).toBe(100_000);
    await store.hit("k", 1000);
    expect(store.size).toBe(1);
  });

  it("evicts cold keys before the bucket that is actively limiting someone", async () => {
    const { clock } = mutableClock();
    const store = new InMemoryRateLimitStore(clock, 4);
    // A respondent hitting their limit, interleaved with flood keys that are
    // never revisited. Eviction is LRU, so the flood evicts itself and the warm
    // bucket keeps its count: the limit it is enforcing is not forgiven.
    for (let i = 0; i < 50; i++) {
      await store.hit("rl:answers-session:ses_warm", 3_600_000);
      await store.hit(`rl:session-create:flood-${i}`, 3_600_000);
    }
    expect(store.size).toBeLessThanOrEqual(4);
    expect((await store.hit("rl:answers-session:ses_warm", 3_600_000)).count).toBe(51);
  });
});

describe("rateLimit middleware", () => {
  it("passes under the limit and 429s over it", async () => {
    const { clock } = mutableClock();
    const store = new InMemoryRateLimitStore(clock);
    const app = new Hono();
    // Minimal envelope so the thrown 429 surfaces as 429 (createApp does this).
    app.onError((err, c) => {
      if (err instanceof ApiError) return c.json(err.toEnvelope(), err.status);
      throw err;
    });
    app.use("*", rateLimit({ store, windowMs: 1000, max: 2, keyFor: () => "fixed" }));
    app.get("/", (c) => c.text("ok"));

    expect((await app.request("/")).status).toBe(200);
    const second = await app.request("/");
    expect(second.status).toBe(200);
    expect(second.headers.get("x-ratelimit-remaining")).toBe("0");

    const third = await app.request("/");
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });
});
