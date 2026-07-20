/**
 * Per-endpoint-class rate-limit tests (task 026, exit criterion 1). Drives each
 * limiter through `app.request()` on its real route path — no DB (the limiter
 * runs before the handler; an over-limit request 429s without touching it), and
 * no mock of our own code. Asserts: under the limit passes, over 429s with
 * `Retry-After`, the window resets, keys isolate the right unit, and the limits
 * are configurable via the env knobs.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Clock } from "../../clock.js";
import { ApiError } from "../../errors.js";
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
      app.request("/sessions", { method: "POST", headers: { "x-forwarded-for": ip } });

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
        headers: { "x-forwarded-for": "9.9.9.9" },
      });
    // Two different sessions from one IP still hit the shared per-IP ceiling.
    expect((await call("ses_1")).status).toBe(200);
    expect((await call("ses_2")).status).toBe(200);
    expect((await call("ses_3")).status).toBe(429);
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
