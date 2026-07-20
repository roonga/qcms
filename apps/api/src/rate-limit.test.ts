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
