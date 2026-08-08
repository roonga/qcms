/**
 * Per-endpoint-class rate-limit tests (task 026, exit criterion 1). Drives each
 * limiter through `app.request()` on its real route path - no DB (the limiter
 * runs before the handler; an over-limit request 429s without touching it), and
 * no mock of our own code. Asserts: under the limit passes, over 429s with
 * `Retry-After`, the window resets, keys isolate the right unit, and the limits
 * are configurable via the env knobs.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { CLIENT_ADDRESS_HEADER } from "../../client-address.js";
import type { Clock } from "../../clock.js";
import { ApiError } from "../../errors.js";
import { InMemoryRateLimitStore } from "../../rate-limit.js";
import { makeDeps, validEnv } from "../../test-support.js";
import {
  answersPerIpLimiter,
  answersPerSessionLimiter,
  sessionCreateLimiter,
  submitPerSessionLimiter,
} from "./rate-limits.js";

function mutableClock(start = 0): { clock: Clock; advance: (ms: number) => void } {
  let t = start;
  return { clock: { now: () => new Date(t) }, advance: (ms) => (t += ms) };
}

/** A bare app with the error envelope so a thrown 429 surfaces as a 429. */
function appWith(mount: (app: Hono) => void): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.toEnvelope(), err.status);
    throw err;
  });
  mount(app);
  return app;
}

/** Tight limits (max 2 / 1s window) on every class, via the env knobs. */
function tightEnv(): Record<string, string | undefined> {
  return validEnv({
    QCMS_RL_SESSION_CREATE_MAX: "2",
    QCMS_RL_SESSION_CREATE_WINDOW_MS: "1000",
    QCMS_RL_ANSWERS_SESSION_MAX: "2",
    QCMS_RL_ANSWERS_SESSION_WINDOW_MS: "1000",
    QCMS_RL_ANSWERS_IP_MAX: "2",
    QCMS_RL_ANSWERS_IP_WINDOW_MS: "1000",
    QCMS_RL_SUBMIT_SESSION_MAX: "2",
    QCMS_RL_SUBMIT_SESSION_WINDOW_MS: "1000",
  });
}

describe("session-create limiter (per IP)", () => {
  it("passes under the limit, 429s over it with Retry-After, resets after the window", async () => {
    const { clock, advance } = mutableClock();
    const deps = makeDeps({ clock, env: tightEnv() });
    const app = appWith((a) => {
      a.use("/sessions", sessionCreateLimiter(deps));
      a.post("/sessions", (c) => c.text("ok"));
    });
    const call = (ip: string) =>
      app.request("/sessions", { method: "POST", headers: { [CLIENT_ADDRESS_HEADER]: ip } });

    expect((await call("1.1.1.1")).status).toBe(200);
    expect((await call("1.1.1.1")).status).toBe(200);
    const over = await call("1.1.1.1");
    expect(over.status).toBe(429);
    expect(over.headers.get("retry-after")).toBeTruthy();

    // A different IP has its own bucket.
    expect((await call("2.2.2.2")).status).toBe(200);

    // Window elapses → the first IP is allowed again.
    advance(1000);
    expect((await call("1.1.1.1")).status).toBe(200);
  });
});

describe("answers limiters (per session and per IP)", () => {
  it("isolates buckets by session id from the path", async () => {
    const { clock } = mutableClock();
    const deps = makeDeps({ clock, env: tightEnv() });
    const app = appWith((a) => {
      a.use("/sessions/:id/answers", answersPerSessionLimiter(deps));
      a.post("/sessions/:id/answers", (c) => c.text("ok"));
    });
    const call = (id: string) => app.request(`/sessions/${id}/answers`, { method: "POST" });

    expect((await call("ses_a")).status).toBe(200);
    expect((await call("ses_a")).status).toBe(200);
    expect((await call("ses_a")).status).toBe(429);
    // A different session is unaffected by ses_a's exhausted bucket.
    expect((await call("ses_b")).status).toBe(200);
  });

  it("also caps per IP regardless of session (flood backstop)", async () => {
    const { clock } = mutableClock();
    const deps = makeDeps({ clock, env: tightEnv() });
    const app = appWith((a) => {
      a.use("/sessions/:id/answers", answersPerIpLimiter(deps));
      a.post("/sessions/:id/answers", (c) => c.text("ok"));
    });
    const call = (id: string) =>
      app.request(`/sessions/${id}/answers`, {
        method: "POST",
        headers: { [CLIENT_ADDRESS_HEADER]: "9.9.9.9" },
      });
    // Two different sessions from one IP still hit the shared per-IP ceiling.
    expect((await call("ses_1")).status).toBe(200);
    expect((await call("ses_2")).status).toBe(200);
    expect((await call("ses_3")).status).toBe(429);
  });
});

/**
 * What the per-address limiters key on, and what they refuse to key on (#341).
 *
 * Against the pre-fix `clientIp()` - `x-forwarded-for` first entry, then
 * `x-real-ip`, then `unknown-ip` - the first case here fails (no address arrives,
 * so both callers share the one bucket and the second request 429s) and the last
 * two fail the other way (a client-written header shards the bucket at will).
 */
describe("the address the limiters key on", () => {
  const appFor = (deps: ReturnType<typeof makeDeps>): Hono =>
    appWith((a) => {
      a.use("/sessions", sessionCreateLimiter(deps));
      a.post("/sessions", (c) => c.text("ok"));
    });

  it("keys on the address the BFF vouched for, so two respondents get two buckets", async () => {
    const { clock } = mutableClock();
    const app = appFor(makeDeps({ clock, env: tightEnv() }));
    const call = (headers: Record<string, string>) =>
      app.request("/sessions", { method: "POST", headers });

    // Two respondents the pre-fix code could not tell apart: it saw no address on
    // either request, bucketed both as `unknown-ip`, and 429'd the third call.
    expect((await call({ [CLIENT_ADDRESS_HEADER]: "203.0.113.7" })).status).toBe(200);
    expect((await call({ [CLIENT_ADDRESS_HEADER]: "203.0.113.7" })).status).toBe(200);
    expect((await call({ [CLIENT_ADDRESS_HEADER]: "198.51.100.22" })).status).toBe(200);
    expect((await call({ [CLIENT_ADDRESS_HEADER]: "198.51.100.22" })).status).toBe(200);
    // ...and each is still capped on its own bucket.
    expect((await call({ [CLIENT_ADDRESS_HEADER]: "203.0.113.7" })).status).toBe(429);
    expect((await call({ [CLIENT_ADDRESS_HEADER]: "198.51.100.22" })).status).toBe(429);
  });

  it("does NOT let x-forwarded-for move the bucket", async () => {
    const { clock } = mutableClock();
    const app = appFor(makeDeps({ clock, env: tightEnv() }));
    const call = (forwardedFor: string) =>
      app.request("/sessions", {
        method: "POST",
        headers: { [CLIENT_ADDRESS_HEADER]: "203.0.113.7", "x-forwarded-for": forwardedFor },
      });

    // Rotating the forgeable header does not buy a fresh bucket: all three land in
    // the vouched address's bucket, and the third is over its limit of 2.
    expect((await call("10.0.0.1")).status).toBe(200);
    expect((await call("10.0.0.2")).status).toBe(200);
    expect((await call("10.0.0.3")).status).toBe(429);
  });

  it("does NOT let x-forwarded-for or x-real-ip stand in for a vouched address", async () => {
    const { clock } = mutableClock();
    const app = appFor(makeDeps({ clock, env: tightEnv() }));
    const call = (headers: Record<string, string>) =>
      app.request("/sessions", { method: "POST", headers });

    // No vouched header at all: every caller shares one bucket regardless of what
    // it claims about itself. Coarse, deliberately, and never a free bucket.
    expect((await call({ "x-forwarded-for": "10.0.0.1" })).status).toBe(200);
    expect((await call({ "x-real-ip": "10.0.0.2" })).status).toBe(200);
    expect((await call({ "x-forwarded-for": "10.0.0.3" })).status).toBe(429);
  });
});

/**
 * The store the address-keyed limiters fill cannot grow without bound (#376).
 *
 * `POST /sessions` is reachable without any credential the respondent chooses -
 * the portal's `GET /l/<token>` calls it before anything validates the token,
 * and the limiter is deliberately mounted ahead of the handler so an invalid
 * token costs an attacker a bucket rather than a database round trip. That makes
 * "one request from a fresh address" the cheapest thing on the surface, so the
 * store behind it has to be bounded. Against the pre-fix store this test sees
 * 400 retained entries instead of 32.
 */
describe("the store the session-create limiter fills", () => {
  it("stays within capacity under one request each from many fresh addresses", async () => {
    const { clock } = mutableClock();
    const store = new InMemoryRateLimitStore(clock, 32);
    const deps = makeDeps({ clock, env: tightEnv(), rateLimitStore: store });
    const app = appWith((a) => {
      a.use("/sessions", sessionCreateLimiter(deps));
      a.post("/sessions", (c) => c.text("ok"));
    });

    for (let i = 0; i < 400; i++) {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { [CLIENT_ADDRESS_HEADER]: `2001:db8::${i.toString(16)}` },
      });
      // Each address is under its own limit, so the limiter still lets it past:
      // the request is served, it just no longer leaks an entry forever.
      expect(res.status).toBe(200);
      expect(store.size).toBeLessThanOrEqual(32);
    }
  });
});

describe("submit limiter (per session)", () => {
  it("passes under the configured limit and 429s over it", async () => {
    const { clock } = mutableClock();
    const deps = makeDeps({ clock, env: tightEnv() });
    const app = appWith((a) => {
      a.use("/sessions/:id/submit", submitPerSessionLimiter(deps));
      a.post("/sessions/:id/submit", (c) => c.text("ok"));
    });
    const call = () => app.request("/sessions/ses_x/submit", { method: "POST" });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  it("honors a reconfigured max (limits are configurable)", async () => {
    const { clock } = mutableClock();
    const deps = makeDeps({
      clock,
      env: validEnv({ QCMS_RL_SUBMIT_SESSION_MAX: "1", QCMS_RL_SUBMIT_SESSION_WINDOW_MS: "1000" }),
    });
    expect(deps.config.rateLimit.submitPerSession.max).toBe(1);
    const app = appWith((a) => {
      a.use("/sessions/:id/submit", submitPerSessionLimiter(deps));
      a.post("/sessions/:id/submit", (c) => c.text("ok"));
    });
    const call = () => app.request("/sessions/ses_y/submit", { method: "POST" });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });
});
