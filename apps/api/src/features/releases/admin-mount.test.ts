/**
 * Admin-group mount + auth-seam tests for the releases slice (task 065).
 *
 * The surface guarantees without a database: the admin-auth gate rejects an
 * unauthenticated request before any handler runs, and a public-only process has no admin
 * group at all, so a release route 404s rather than 403s (ADR-09). The release transaction
 * itself is exercised against a real Postgres in `releases.integration.test.ts`.
 *
 * The environment-switcher middleware is asserted here too, because its refusal is a
 * surface property: an environment this deployment does not serve is a 400 at the edge
 * rather than a throw from `Databases.for` inside a handler, which would be a 500.
 */

import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import {
  REQUEST_ENVIRONMENT_HEADER,
  registerRequestEnvironment,
} from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps } from "../../test-support.js";
import { registerReleases } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = {
  groups: { admin: [registerAdminAuth, registerRequestEnvironment, registerReleases] },
};

interface ErrBody {
  error: { code: string; message: string };
}

describe("releases admin auth seam", () => {
  it("rejects a release with no admin session → 401 (before any handler)", async () => {
    const deps = makeDeps(); // unusedDb: the gate must reject before touching it
    const app = createApp(deps, ADMIN_ONLY, adminGroups);

    const res = await app.request("/admin/forms/frm_x/releases", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
      body: JSON.stringify({ environment: "prod", version: 1 }),
    });

    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
  });

  it("gates the reads the same way → 401", async () => {
    const deps = makeDeps();
    const app = createApp(deps, ADMIN_ONLY, adminGroups);
    for (const path of ["/admin/environments", "/admin/forms/frm_x/releases"]) {
      const res = await app.request(path, {
        headers: { "x-qcms-internal-token": internalTokenFor(deps.config) },
      });
      expect(res.status, path).toBe(401);
    }
  });

  it("answers 401 before the switcher's header is looked at", async () => {
    // The gate is registered ahead of the environment middleware, so an unauthenticated
    // request is refused without the switcher's value being read at all - it is never
    // told which environments exist. `makeDeps()`'s rejecting database handle is what
    // proves the gate ran first: a handler that got as far as a query would throw.
    const deps = makeDeps();
    const app = createApp(deps, ADMIN_ONLY, adminGroups);
    const res = await app.request("/admin/environments", {
      headers: {
        "x-qcms-internal-token": internalTokenFor(deps.config),
        [REQUEST_ENVIRONMENT_HEADER]: "staging",
      },
    });
    expect(res.status).toBe(401);
  });
});

describe("releases admin group is absent in a public-only process (ADR-09)", () => {
  it("a release route 404s - the group is not mounted, not merely forbidden", async () => {
    const deps = makeDeps();
    const app = createApp(deps, PUBLIC_ONLY, adminGroups);

    const res = await app.request("/admin/forms/frm_x/releases", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
        // Unmounted group: nothing runs, so this value is never verified.
        [ADMIN_SESSION_HEADER]: "any-value-unverified-here",
      },
      body: JSON.stringify({ environment: "prod", version: 1 }),
    });

    expect(res.status).toBe(404);
  });

  it("does not put the switcher's header in front of the respondent surface (SEC-14)", async () => {
    // The environment middleware is mounted on the admin group alone. In a public-only
    // process there is no admin group, so there is nothing anywhere that reads this
    // header - which is what keeps "no anonymous entry to a non-prod environment" a
    // property of what is mounted rather than a check a handler could skip.
    const deps = makeDeps();
    const app = createApp(deps, PUBLIC_ONLY, adminGroups);
    const res = await app.request("/admin/environments", {
      headers: {
        "x-qcms-internal-token": internalTokenFor(deps.config),
        [REQUEST_ENVIRONMENT_HEADER]: "test",
      },
    });
    expect(res.status).toBe(404);
  });
});
