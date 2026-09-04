/**
 * Admin-auth middleware tests (task 031, exit criterion 1 - the middleware half).
 *
 * The companion half lives in the admin Playwright suite: "an unauthenticated
 * admin *page* redirects to sign-in". Here we prove the API side: an
 * unauthenticated (or out-of-policy) call to any `/admin` route is `401` before a
 * handler runs, and a real, in-policy better-auth session is the only thing that
 * passes.
 *
 * Driven through `app.request()` against the 013 Testcontainers harness DB,
 * because verification is a database read: mocking it would test nothing. The
 * probe route below is registered *after* `registerAdminAuth` in the admin bucket
 * so it sits behind the gate exactly as a real slice does, and it echoes the
 * resolved principal so the SEC-3 `role` claim is observable.
 *
 * Requires Docker.
 */

import { CONTAINER_BOOT_TIMEOUT_MS, startTestDb, type TestDb } from "@roonga/qcms-db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { SliceRegistrar } from "../app.js";
import type { Deps } from "../deps.js";
import { internalTokenFor, makeDeps, seedAdminSession, validEnv } from "../test-support.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "./admin-auth.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
/** The pinned instant every seeded session is anchored to (fixedClock's). */
const NOW = new Date("2026-07-20T00:00:00.000Z");
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * A minimal admin slice: it exists only to observe what got past the gate, so a
 * pass/fail here is the middleware's verdict and nothing else's.
 */
const registerPrincipalProbe: SliceRegistrar = (group) => {
  group.get("/whoami", (c) => c.json({ principal: c.get("adminPrincipal") }));
};

let testDb: TestDb;

beforeAll(async () => {
  testDb = await startTestDb();
}, CONTAINER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.teardown();
}, CONTAINER_BOOT_TIMEOUT_MS);

interface Composed {
  readonly app: ReturnType<typeof createApp>;
  readonly deps: Deps;
}

function compose(env: Record<string, string | undefined> = validEnv()): Composed {
  const deps = makeDeps({ db: testDb.db, env });
  const app = createApp(deps, ADMIN_ONLY, {
    groups: { admin: [registerAdminAuth, registerPrincipalProbe] },
  });
  return { app, deps };
}

async function whoami(composed: Composed, sessionToken?: string): Promise<Response> {
  return composed.app.request("/admin/whoami", {
    headers: {
      "x-qcms-internal-token": internalTokenFor(composed.deps.config),
      ...(sessionToken === undefined ? {} : { [ADMIN_SESSION_HEADER]: sessionToken }),
    },
  });
}

describe("admin-auth: an unauthenticated /admin call is 401", () => {
  it("rejects a request with no session header at all", async () => {
    const res = await whoami(compose());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("rejects a blank session header", async () => {
    expect((await whoami(compose(), "   ")).status).toBe(401);
  });

  it("rejects a token that matches no session row", async () => {
    expect((await whoami(compose(), "st_this-token-was-never-issued")).status).toBe(401);
  });

  it("rejects a token that is a valid session's USER id rather than its token", async () => {
    // Guards the join: resolving on the wrong column would authenticate anyone
    // who knows a user id.
    const { userId } = await seedAdminSession(testDb.db, { at: NOW, label: "byuserid" });
    expect((await whoami(compose(), userId)).status).toBe(401);
  });

  it("says nothing about WHY in the 401 body (SEC-1: no enumeration)", async () => {
    const { token } = await seedAdminSession(testDb.db, {
      at: NOW,
      expiresInMs: -1_000,
      label: "silent",
    });
    const expired = (await (await whoami(compose(), token)).json()) as {
      error: { code: string; message: string };
    };
    const unknown = (await (await whoami(compose(), "st_never-issued-either")).json()) as {
      error: { code: string; message: string };
    };
    // Byte-identical envelopes: an attacker cannot distinguish the two cases.
    expect(expired).toEqual(unknown);
    expect(expired.error.message).toBe("Admin authentication required");
  });
});

describe("admin-auth: a real, in-policy session authenticates", () => {
  it("passes and resolves the principal with its SEC-3 role claim", async () => {
    const { token, userId } = await seedAdminSession(testDb.db, { at: NOW, label: "ok" });
    const res = await whoami(compose(), token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      principal: { userId: string; role: string; scopes: string[] };
    };
    expect(body.principal.userId).toBe(userId);
    // Launch ships a single role; the claim is carried so Phase 4 RBAC is additive.
    expect(body.principal.role).toBe("admin");
    expect(body.principal.scopes).toContain("forms:write");
  });
});

describe("admin-auth: session lifetime policy (SEC-1)", () => {
  it("rejects a session past its idle expiry", async () => {
    const { token } = await seedAdminSession(testDb.db, {
      at: NOW,
      expiresInMs: -1,
      label: "idle",
    });
    expect((await whoami(compose(), token)).status).toBe(401);
  });

  it("rejects a session past the 12h absolute lifetime even when its idle window is open", async () => {
    // The shape an idle-window-only implementation gets wrong: issued 13h ago and
    // kept warm, so `expiresAt` is comfortably in the future.
    const { token } = await seedAdminSession(testDb.db, {
      at: new Date(NOW.getTime() - 13 * 60 * 60 * 1000),
      expiresInMs: 14 * 60 * 60 * 1000,
      label: "stale",
    });
    expect((await whoami(compose(), token)).status).toBe(401);
  });

  it("accepts a session just inside the absolute lifetime", async () => {
    const { token } = await seedAdminSession(testDb.db, {
      at: new Date(NOW.getTime() - (TWELVE_HOURS_MS - 60_000)),
      expiresInMs: TWELVE_HOURS_MS,
      label: "fresh-enough",
    });
    expect((await whoami(compose(), token)).status).toBe(200);
  });

  it("honours a configured absolute lifetime", async () => {
    const env = validEnv({ QCMS_ADMIN_SESSION_MAX_AGE_MS: String(60_000) });
    const { token } = await seedAdminSession(testDb.db, {
      at: new Date(NOW.getTime() - 120_000),
      expiresInMs: 60 * 60 * 1000,
      label: "configured",
    });
    expect((await whoami(compose(env), token)).status).toBe(401);
  });
});

describe("admin-auth: 2FA policy (SEC-1)", () => {
  it("rejects a session whose account has not completed TOTP enrollment", async () => {
    const { token } = await seedAdminSession(testDb.db, {
      at: NOW,
      twoFactorEnabled: false,
      label: "unenrolled",
    });
    // The default policy is `required`, so a signed-in-but-not-enrolled admin
    // reaches the enrollment screens (better-auth in the shell) and no API route.
    expect((await whoami(compose(), token)).status).toBe(401);
  });

  it("accepts the same session under the documented QCMS_ADMIN_2FA=optional escape hatch", async () => {
    const { token } = await seedAdminSession(testDb.db, {
      at: NOW,
      twoFactorEnabled: false,
      label: "devmode",
    });
    const optional = compose(validEnv({ QCMS_ADMIN_2FA: "optional" }));
    expect((await whoami(optional, token)).status).toBe(200);
  });
});
