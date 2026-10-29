import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps } from "../../test-support.js";
import { registerOutboxOps } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = {
  groups: { admin: [registerAdminAuth, registerGrantCheck, registerOutboxOps] },
};

const DELIVERY_ID = "d290f1ee-6c54-4b01-90e6-d701748f0851";

const routes: ReadonlyArray<{ method: string; path: string }> = [
  { method: "GET", path: "/admin/outbox/dead-letters" },
  { method: "GET", path: "/admin/forms/frm_x/deliveries" },
  { method: "POST", path: `/admin/forms/frm_x/deliveries/${DELIVERY_ID}/redeliver` },
];

interface ErrBody {
  error: { code: string; message: string };
}

describe("outbox ops admin auth seam (401 before any handler)", () => {
  for (const { method, path } of routes) {
    it(`${method} ${path} -> 401 with no admin session`, async () => {
      const deps = makeDeps();
      const app = createApp(deps, ADMIN_ONLY, adminGroups);
      const res = await app.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-qcms-internal-token": internalTokenFor(deps.config),
        },
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
    });
  }
});

describe("outbox ops admin group is absent in a public-only process (ADR-09)", () => {
  for (const { method, path } of routes) {
    it(`${method} ${path} -> 404, the group is not mounted rather than forbidden`, async () => {
      const deps = makeDeps();
      const app = createApp(deps, PUBLIC_ONLY, adminGroups);
      const res = await app.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-qcms-internal-token": internalTokenFor(deps.config),
          // Unmounted group: nothing runs, so this value is never verified.
          [ADMIN_SESSION_HEADER]: "any-value-unverified-here",
        },
      });
      expect(res.status).toBe(404);
    });
  }
});
