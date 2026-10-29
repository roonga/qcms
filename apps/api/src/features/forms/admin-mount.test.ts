import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps } from "../../test-support.js";
import { registerForms } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = { groups: { admin: [registerAdminAuth, registerGrantCheck, registerForms] } };

interface ErrBody {
  error: { code: string; message: string };
}

describe("forms admin auth seam", () => {
  it("rejects a forms request with no admin session → 401 (before any handler)", async () => {
    const deps = makeDeps(); // unusedDb: the gate must reject before touching it
    const app = createApp(deps, ADMIN_ONLY, adminGroups);

    const res = await app.request("/admin/forms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
      body: JSON.stringify({ formId: "frm_x", slug: "x", defaultLocale: "en" }),
    });

    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
  });

  it("a GET list is equally gated with no admin session → 401", async () => {
    const deps = makeDeps();
    const app = createApp(deps, ADMIN_ONLY, adminGroups);
    const res = await app.request("/admin/forms", {
      headers: { "x-qcms-internal-token": internalTokenFor(deps.config) },
    });
    expect(res.status).toBe(401);
  });
});

describe("forms admin group is absent in a public-only process (ADR-09)", () => {
  it("an admin form route 404s - the group is not mounted, not merely forbidden", async () => {
    const deps = makeDeps();
    const app = createApp(deps, PUBLIC_ONLY, adminGroups);

    const res = await app.request("/admin/forms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
        // Unmounted group: nothing runs, so this value is never verified.
        [ADMIN_SESSION_HEADER]: "any-value-unverified-here",
      },
      body: JSON.stringify({ formId: "frm_x", slug: "x", defaultLocale: "en" }),
    });

    expect(res.status).toBe(404);
  });
});
