import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { registerGrantCheck } from "../membership/middleware.js";
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
  groups: {
    admin: [registerAdminAuth, registerRequestEnvironment, registerGrantCheck, registerReleases],
  },
};

interface ErrBody {
  error: { code: string; message: string };
}

describe("releases admin auth seam", () => {
  it("rejects a release with no admin session → 401 (before any handler)", async () => {
    const deps = makeDeps();
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
