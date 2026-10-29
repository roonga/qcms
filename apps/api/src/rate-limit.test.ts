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
    advance(1000);
    expect((await store.hit("k", 1000)).count).toBe(1);
  });

  it("isolates keys", async () => {
    const { clock } = mutableClock();
    const store = new InMemoryRateLimitStore(clock);
    await store.hit("a", 1000);
    expect((await store.hit("b", 1000)).count).toBe(1);
  });
});

describe("InMemoryRateLimitStore key-space bound", () => {
  it("never exceeds its capacity, however many distinct keys it sees", async () => {
    const { clock } = mutableClock();
    const store = new InMemoryRateLimitStore(clock, 64);
    let peak = 0;
    // Every key is fresh and its window stays open, so nothing here is reclaimable
    // as expired and only the capacity bound can hold.
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
    // Capacity far above the traffic, so this measures the sweep alone.
    const store = new InMemoryRateLimitStore(clock, 1_000_000);
    for (let i = 0; i < 100; i++) await store.hit(`first:${i}`, 1000);
    expect(store.size).toBe(100);

    advance(1001);
    for (let i = 0; i < 100; i++) await store.hit(`second:${i}`, 1000);

    expect(store.size).toBe(100);
  });

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
    expect(new InMemoryRateLimitStore(clock, 1).capacity).toBe(1);
    expect(new InMemoryRateLimitStore(clock, 250_000).capacity).toBe(250_000);
    const store = new InMemoryRateLimitStore(clock);
    expect(store.capacity).toBe(100_000);
    await store.hit("k", 1000);
    expect(store.size).toBe(1);
  });

  it("evicts cold keys before the bucket that is actively limiting someone", async () => {
    const { clock } = mutableClock();
    const store = new InMemoryRateLimitStore(clock, 4);
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
    // Stands in for the envelope `createApp` installs, so the thrown 429 surfaces as one.
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
