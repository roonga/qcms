import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { internalTokenFor, makeDeps, validEnv } from "../../test-support.js";
import { registerAdminAuthProxy, ALLOWED_AUTH_ENDPOINTS, authSubPath } from "./route.js";

/**
 * The auth mount's surface guarantees (task 056; SEC-1, SEC-4, ADR-09).
 *
 * No database and no better-auth work happens in this file: every assertion is about
 * what the *route tree* allows, which is where SEC-1's "no self-registration path
 * exists in any composition" is won or lost. The flows themselves run against a real
 * Postgres and the real library in `auth.integration.test.ts`.
 *
 * The `unusedDb()` handle is load-bearing here: an allowlist miss must be refused
 * before `auth.handler` is reached, so any test below that accidentally let a request
 * through would fail loudly on a rejected database call rather than passing quietly.
 */

const ALL = { public: true, internal: true, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const groups = { groups: { auth: [registerAdminAuthProxy] } };

interface ErrBody {
  error: { code: string; message: string };
}

function compose(flags: typeof ALL | typeof PUBLIC_ONLY) {
  const deps = makeDeps({ env: validEnv() });
  return { deps, app: createApp(deps, flags, groups) };
}

describe("SEC-1: no self-registration path exists in any composition", () => {
  it("the allowlist names no registration-shaped endpoint", () => {
    const suspicious = ALLOWED_AUTH_ENDPOINTS.filter((entry) =>
      /(sign-up|signup|register|registration|invite)/i.test(entry),
    );
    expect(suspicious).toEqual([]);
  });

  it("POST /api/auth/sign-up/email is a 404, not a created account", async () => {
    const { deps, app } = compose(ALL);
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
      body: JSON.stringify({ email: "intruder@example.test", password: "long-enough-password" }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrBody).error.code).toBe("not_found");
  });

  it("refuses every better-auth endpoint that is not on the allowlist", async () => {
    const { deps, app } = compose(ALL);
    const token = internalTokenFor(deps.config);
    // A representative spread: account creation, factor removal, code regeneration,
    // the OTP endpoints reserved for Phase 4, and the URI reveal the enrollment
    // screen does not use.
    const denied = [
      "/api/auth/sign-up/email",
      "/api/auth/two-factor/disable",
      "/api/auth/two-factor/generate-backup-codes",
      "/api/auth/two-factor/send-otp",
      "/api/auth/two-factor/verify-otp",
      "/api/auth/two-factor/get-totp-uri",
      "/api/auth/list-sessions",
      "/api/auth/update-user",
    ];
    const statuses = await Promise.all(
      denied.map(async (path) => {
        const res = await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json", "x-qcms-internal-token": token },
          body: "{}",
        });
        return `${path} -> ${String(res.status)}`;
      }),
    );
    expect(statuses).toEqual(denied.map((path) => `${path} -> 404`));
  });

  it("the refusal names no endpoint, so the surface cannot be enumerated", async () => {
    const { deps, app } = compose(ALL);
    const res = await app.request("/api/auth/two-factor/disable", {
      method: "POST",
      headers: { "content-type": "application/json", "x-qcms-internal-token": internalTokenFor(deps.config) },
      body: "{}",
    });
    const body = (await res.json()) as ErrBody;
    expect(body.error.message).toBe("Not Found");
    expect(body.error.message).not.toContain("two-factor");
  });
});

describe("SEC-4: the auth group is behind the internal service token", () => {
  it("rejects an allowlisted endpoint with no channel token (401, before better-auth)", async () => {
    const { app } = compose(ALL);
    const res = await app.request("/api/auth/get-session", { method: "GET" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
  });

  it("rejects a wrong channel token", async () => {
    const { app } = compose(ALL);
    const res = await app.request("/api/auth/get-session", {
      method: "GET",
      headers: { "x-qcms-internal-token": "not-the-token" },
    });
    expect(res.status).toBe(401);
  });
});

describe("ADR-09: no identity provider in a respondent-only process", () => {
  it("an allowlisted auth path 404s when the admin surface is not mounted", async () => {
    const { deps, app } = compose(PUBLIC_ONLY);
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
      body: JSON.stringify({ email: "a@b.test", password: "long-enough-password" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("path derivation", () => {
  it("strips the base path and normalizes the root", () => {
    expect(authSubPath("http://api.test/api/auth/get-session")).toBe("/get-session");
    expect(authSubPath("http://api.test/api/auth/two-factor/verify-totp")).toBe(
      "/two-factor/verify-totp",
    );
    expect(authSubPath("http://api.test/api/auth")).toBe("/");
    // A query string is not part of the endpoint identity, so it cannot be used to
    // smuggle a denied path past the allowlist.
    expect(authSubPath("http://api.test/api/auth/get-session?disableCookieCache=true")).toBe(
      "/get-session",
    );
  });
});
