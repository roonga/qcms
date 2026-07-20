/**
 * Admin-group mount + auth-seam tests (task 021, exit criterion 4).
 *
 * These assert the surface guarantees without a database - the admin-auth gate
 * rejects an unauthenticated request before any handler runs, and a public-only
 * process has no admin group at all (a 404, not a 403). The full lifecycle
 * (create/edit/publish/deprecate, R6, malformed) is exercised against the real
 * DB in `questions.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { ADMIN_SESSION_HEADER } from "../../middleware/admin-auth.js";
import { registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps } from "../../test-support.js";
import { registerQuestions } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = { groups: { admin: [registerAdminAuth, registerQuestions] } };

interface ErrBody {
  error: { code: string; message: string };
}

describe("admin auth seam (exit criterion 4)", () => {
  it("rejects an admin request with no admin session → 401 (before any handler)", async () => {
    const deps = makeDeps(); // unusedDb: the gate must reject before touching it
    const app = createApp(deps, ADMIN_ONLY, adminGroups);

    const res = await app.request("/admin/questions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Channel token present, so the internal-token gate passes; the *admin*
        // gate is what rejects here.
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
      body: JSON.stringify({ slug: "x", definition: {} }),
    });

    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
  });

  it("a GET read is equally gated with no admin session → 401", async () => {
    const deps = makeDeps();
    const app = createApp(deps, ADMIN_ONLY, adminGroups);
    const res = await app.request("/admin/questions", {
      headers: { "x-qcms-internal-token": internalTokenFor(deps.config) },
    });
    expect(res.status).toBe(401);
  });
});

describe("admin group is absent in a public-only process (exit criterion 4, ADR-09)", () => {
  it("an admin route 404s - the group is not mounted, not merely forbidden", async () => {
    const deps = makeDeps();
    const app = createApp(deps, PUBLIC_ONLY, adminGroups);

    const res = await app.request("/admin/questions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
        // Even with a (stub) admin session, the path does not exist here.
        [ADMIN_SESSION_HEADER]: "editor-1",
      },
      body: JSON.stringify({ slug: "x", definition: {} }),
    });

    // Not 403, not 401 - the admin surface simply does not exist in this shape.
    expect(res.status).toBe(404);
  });
});
