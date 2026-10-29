import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { internalTokenFor, makeDeps, validEnv } from "../../test-support.js";
import { ALLOWED_AUTH_ENDPOINTS, authSubPath, registerAdminAuthProxy } from "./route.js";

const ALL = { public: true, internal: true, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const groups = { groups: { auth: [registerAdminAuthProxy] } };

interface ErrBody {
  error: { code: string; message: string };
}

/** Generated rather than literal so no credential-shaped string is ever committed here. */
const SYNTHETIC_PASSWORD = `probe-${Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64url")}`;

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

  it("the allowlist names no organisation or team endpoint (Q45, task 068)", () => {
    const grantShaped = ALLOWED_AUTH_ENDPOINTS.filter((entry) =>
      /(organization|team|member)/i.test(entry),
    );
    expect(grantShaped).toEqual([]);
  });

  it("POST /api/auth/sign-up/email is a 404, not a created account", async () => {
    const { deps, app } = compose(ALL);
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
      body: JSON.stringify({ email: "intruder@example.test", password: SYNTHETIC_PASSWORD }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrBody).error.code).toBe("not_found");
  });

  it("refuses every better-auth endpoint that is not on the allowlist", async () => {
    const { deps, app } = compose(ALL);
    const token = internalTokenFor(deps.config);
    const denied = [
      "/api/auth/sign-up/email",
      "/api/auth/two-factor/disable",
      "/api/auth/two-factor/send-otp",
      "/api/auth/two-factor/verify-otp",
      "/api/auth/two-factor/get-totp-uri",
      "/api/auth/list-sessions",
      "/api/auth/update-user",
      "/api/auth/organization/create",
      "/api/auth/organization/update",
      "/api/auth/organization/delete",
      "/api/auth/organization/invite-member",
      "/api/auth/organization/add-member",
      "/api/auth/organization/remove-member",
      "/api/auth/organization/create-team",
      "/api/auth/organization/add-team-member",
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
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
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
      body: JSON.stringify({ email: "a@b.test", password: SYNTHETIC_PASSWORD }),
    });
    expect(res.status).toBe(404);
  });
});

describe("issue #402: the admin BFF is the only path to better-auth", () => {
  function requestFor(entry: string, headers: Record<string, string>): [string, RequestInit] {
    const [method = "GET", path = "/"] = entry.split(" ");
    const body =
      method === "GET"
        ? undefined
        : JSON.stringify({ email: "intruder@example.test", password: SYNTHETIC_PASSWORD });
    return [
      `/api/auth${path}`,
      {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body ? { body } : {}),
      },
    ];
  }

  it.each(ALLOWED_AUTH_ENDPOINTS)(
    "refuses %s without the SEC-4 channel token, which a browser cannot hold",
    async (entry) => {
      const { app } = compose(ALL);
      const res = await app.request(...requestFor(entry, {}));
      expect(res.status).toBe(401);
      expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
    },
  );

  it.each(ALLOWED_AUTH_ENDPOINTS)(
    "does not mount %s at all in a process without the admin surface",
    async (entry) => {
      const { deps, app } = compose(PUBLIC_ONLY);
      const res = await app.request(
        ...requestFor(entry, { "x-qcms-internal-token": internalTokenFor(deps.config) }),
      );
      expect(res.status).toBe(404);
    },
  );

  it("sets no CORS header on the refusal, so no browser origin is ever granted the hop", async () => {
    const { app } = compose(ALL);
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://admin.example.test" },
      body: JSON.stringify({ email: "intruder@example.test", password: SYNTHETIC_PASSWORD }),
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("path derivation", () => {
  it("strips the base path and normalizes the root", () => {
    expect(authSubPath("http://api.test/api/auth/get-session")).toBe("/get-session");
    expect(authSubPath("http://api.test/api/auth/two-factor/verify-totp")).toBe(
      "/two-factor/verify-totp",
    );
    expect(authSubPath("http://api.test/api/auth")).toBe("/");
    // A query string is not part of the endpoint identity, so it cannot smuggle a denied
    // path past the allowlist.
    expect(authSubPath("http://api.test/api/auth/get-session?disableCookieCache=true")).toBe(
      "/get-session",
    );
  });
});
