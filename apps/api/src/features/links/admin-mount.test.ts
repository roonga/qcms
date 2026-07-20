/**
 * Admin-group mount + auth-seam tests for the secure-link slices (task 024).
 *
 * These assert the surface guarantees without a database — the admin-auth gate
 * (021, reused) rejects an unauthenticated request before any handler runs, and
 * a public-only process has no admin group at all (a 404, not a 403; ADR-09).
 * The mint→verify/revoke/rotation lifecycle runs against the real DB in
 * `links.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps } from "../../test-support.js";
import { registerLinks } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = { groups: { admin: [registerAdminAuth, registerLinks] } };

interface ErrBody {
  error: { code: string; message: string };
}

describe("links admin auth seam", () => {
  it("rejects a mint with no admin session → 401 (before any handler)", async () => {
    const deps = makeDeps(); // unusedDb: the gate must reject before touching it
    const app = createApp(deps, ADMIN_ONLY, adminGroups);
    const res = await app.request("/admin/forms/frm_x/links", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
      body: JSON.stringify({ expiresAt: "2026-12-31T00:00:00.000Z" }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
  });

  it("revoke is equally gated with no admin session → 401", async () => {
    const deps = makeDeps();
    const app = createApp(deps, ADMIN_ONLY, adminGroups);
    const res = await app.request("/admin/links/lnk_x/revoke", {
      method: "POST",
      headers: { "x-qcms-internal-token": internalTokenFor(deps.config) },
    });
    expect(res.status).toBe(401);
  });
});

describe("links admin group is absent in a public-only process (ADR-09)", () => {
  it("an admin link route 404s — the group is not mounted, not merely forbidden", async () => {
    const deps = makeDeps();
    const app = createApp(deps, PUBLIC_ONLY, adminGroups);
    const res = await app.request("/admin/forms/frm_x/links", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
        [ADMIN_SESSION_HEADER]: "editor-1",
      },
      body: JSON.stringify({ expiresAt: "2026-12-31T00:00:00.000Z" }),
    });
    expect(res.status).toBe(404);
  });
});
