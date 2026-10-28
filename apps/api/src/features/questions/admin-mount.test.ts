import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER } from "../../middleware/admin-auth.js";
import { registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps } from "../../test-support.js";
import { registerQuestions } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = {
  groups: { admin: [registerAdminAuth, registerGrantCheck, registerQuestions] },
};

interface ErrBody {
  error: { code: string; message: string };
}

describe("admin auth seam (exit criterion 4)", () => {
  it("rejects an admin request with no admin session → 401 (before any handler)", async () => {
    const deps = makeDeps();
    const app = createApp(deps, ADMIN_ONLY, adminGroups);

    const res = await app.request("/admin/questions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
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
        // Unmounted group: nothing runs, so this value is never verified.
        [ADMIN_SESSION_HEADER]: "any-value-unverified-here",
      },
      body: JSON.stringify({ slug: "x", definition: {} }),
    });

    expect(res.status).toBe(404);
  });
});
