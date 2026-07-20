import { createRoute, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { schema } from "@qcms/db";

import { createApp, type SliceRegistrar } from "./app.js";
import { ApiError } from "./errors.js";
import {
  internalTokenFor,
  makeDeps,
  recordingLogger,
  synthSecret,
  validEnv,
} from "./test-support.js";

const { Pool } = pg;

// A real Drizzle handle over a dead port: a genuine "database is down" - the
// query rejects. Not a mock of our package; the external DB is simply absent.
const deadPool = new Pool({
  host: "127.0.0.1",
  port: 1,
  connectionTimeoutMillis: 300,
});
const downDb = drizzle(deadPool, { schema });

afterAll(async () => {
  await deadPool.end();
});

// The slice contract: a happy `/ping` declared with the createRoute convention.
const pingRoute = createRoute({
  method: "get",
  path: "/ping",
  responses: {
    200: {
      description: "ok",
      content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
    },
  },
});
const registerPing: SliceRegistrar = (group) => {
  group.openapi(pingRoute, (c) => c.json({ ok: true }, 200));
};

const ALL = { public: true, internal: true, admin: true } as const;
// No mounted groups: only health/ready + the always-installed middleware
// (error envelope, request logger). Used to exercise middleware in isolation
// without a group's internal-token guard intercepting a root test route.
const NONE = { public: false, internal: false, admin: false } as const;

describe("health and readiness (exit criterion 1)", () => {
  it("GET /health returns a static ok in every shape, no credential", async () => {
    const app = createApp(makeDeps(), ALL);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready returns 503 with a clean body when the DB is down", async () => {
    const app = createApp(makeDeps({ db: downDb }), ALL);
    const res = await app.request("/ready");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable", checks: { db: "down" } });
  });

  it("health/ready never require the internal token", async () => {
    const app = createApp(makeDeps({ db: downDb }), ALL);
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/ready")).status).toBe(503);
  });
});

describe("mount flags (exit criterion 2, ADR-09)", () => {
  it("an admin route 404s in a public-only composition (no route registered)", async () => {
    const deps = makeDeps();
    const app = createApp(
      deps,
      { public: true, internal: false, admin: false },
      {
        groups: { admin: [registerPing] },
      },
    );
    const res = await app.request("/admin/ping", {
      headers: { "x-qcms-internal-token": internalTokenFor(deps.config) },
    });
    // Not 403 - the route does not exist at all in this process.
    expect(res.status).toBe(404);
  });

  it("the same admin route is present in an admin composition", async () => {
    const deps = makeDeps();
    const app = createApp(
      deps,
      { public: false, internal: false, admin: true },
      {
        groups: { admin: [registerPing] },
      },
    );
    const res = await app.request("/admin/ping", {
      headers: { "x-qcms-internal-token": internalTokenFor(deps.config) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("error envelope (exit criterion 3)", () => {
  it("an unexpected throw yields a 500 envelope, a logged stack, and no stack in the body", async () => {
    const { logger, lines } = recordingLogger();
    const deps = makeDeps({ logger });
    const app = createApp(deps, NONE);
    // A test-only throwing route to exercise the error middleware.
    app.get("/boom", () => {
      throw new Error("boom: SENSITIVE-INTERNAL-DETAIL");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: { errorId?: string } };
    };
    expect(body.error.code).toBe("internal");
    expect(body.error.message).toBe("Internal Server Error");
    expect(body.error.details?.errorId).toBeTruthy();

    // The body leaks nothing internal.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("SENSITIVE-INTERNAL-DETAIL");
    expect(raw).not.toContain("stack");

    // The stack IS logged, correlated by errorId.
    const errLine = lines.find((l) => l.level === "error" && l.msg === "unhandled error");
    expect(errLine).toBeDefined();
    expect(errLine!.errorId).toBe(body.error.details?.errorId);
    expect(JSON.stringify(errLine)).toContain("SENSITIVE-INTERNAL-DETAIL");
  });

  it("a deliberate ApiError renders its code/message at its status", async () => {
    const app = createApp(makeDeps(), NONE);
    app.get("/conflict", () => {
      throw new ApiError("already_submitted", 409, "Session already submitted");
    });
    const res = await app.request("/conflict");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "already_submitted", message: "Session already submitted" },
    });
  });

  it("logs one structured request line per request", async () => {
    const { logger, lines } = recordingLogger();
    const app = createApp(makeDeps({ logger }), NONE);
    await app.request("/health");
    const reqLine = lines.find((l) => l.msg === "request");
    expect(reqLine).toMatchObject({ method: "GET", path: "/health", status: 200 });
    expect(typeof reqLine!.durationMs).toBe("number");
    expect(reqLine!.requestId).toBeTruthy();
  });
});

describe("internal service token (exit criterion 6, SEC-4)", () => {
  const deps = makeDeps();
  const token = internalTokenFor(deps.config);
  const app = createApp(deps, ALL, { groups: { public: [registerPing] } });

  it("rejects a mounted request with no token (401)", async () => {
    const res = await app.request("/ping");
    expect(res.status).toBe(401);
    expect((await res.json()) as { error: { code: string } }).toEqual({
      error: { code: "unauthorized", message: "Missing or invalid internal service token" },
    });
  });

  it("rejects a wrong token (401)", async () => {
    const res = await app.request("/ping", {
      headers: { "x-qcms-internal-token": "not-the-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts the correct token (200)", async () => {
    const res = await app.request("/ping", {
      headers: { "x-qcms-internal-token": token },
    });
    expect(res.status).toBe(200);
  });

  it("accepts any token on the rotation accepted-list", async () => {
    const a = synthSecret();
    const b = synthSecret();
    const rotDeps = makeDeps({ env: validEnv({ QCMS_INTERNAL_TOKEN: `${a}, ${b}` }) });
    const rotApp = createApp(rotDeps, ALL, { groups: { public: [registerPing] } });
    for (const tok of [a, b]) {
      const res = await rotApp.request("/ping", { headers: { "x-qcms-internal-token": tok } });
      expect(res.status).toBe(200);
    }
  });
});
