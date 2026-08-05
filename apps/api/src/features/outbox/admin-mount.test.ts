/**
 * Admin-group mount + auth-seam tests for the outbox delivery-operations slice
 * (tasks 025 and 035).
 *
 * No database - these assert the surface guarantees: the admin-auth gate (021,
 * reused) rejects an unauthenticated request before any handler runs, and a
 * public-only process has no admin group at all (a 404, not a 403; ADR-09). The
 * behaviour of each route runs against the real DB in `outbox.integration.test.ts`
 * and in `apps/api/src/schedulers/webhook-delivery.integration.test.ts`.
 *
 * The enumeration below is the whole admin surface `registerOutboxOps` mounts: a
 * route added to the slice without a row here would be mounted but unproven.
 */

import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps } from "../../test-support.js";
import { registerOutboxOps } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = { groups: { admin: [registerAdminAuth, registerOutboxOps] } };

const DELIVERY_ID = "d290f1ee-6c54-4b01-90e6-d701748f0851";

const routes: ReadonlyArray<{ method: string; path: string }> = [
  { method: "GET", path: "/admin/outbox/dead-letters" },
  { method: "GET", path: "/admin/forms/frm_x/deliveries" },
  { method: "POST", path: `/admin/outbox/${DELIVERY_ID}/redeliver` },
];

interface ErrBody {
  error: { code: string; message: string };
}

describe("outbox ops admin auth seam (401 before any handler)", () => {
  for (const { method, path } of routes) {
    it(`${method} ${path} -> 401 with no admin session`, async () => {
      const deps = makeDeps(); // unusedDb: the gate rejects before touching it
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
          // Unmounted group: nothing runs, so this value is never verified (031).
          [ADMIN_SESSION_HEADER]: "any-value-unverified-here",
        },
      });
      expect(res.status).toBe(404);
    });
  }
});
