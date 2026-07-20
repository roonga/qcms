/**
 * Admin-group mount + auth-seam tests for the response data-out slices (task
 * 023). No database — these assert the surface guarantees: the admin-auth gate
 * (021, reused) rejects an unauthenticated request before any handler, and a
 * public-only process has no admin group at all (a 404, not a 403; ADR-09). The
 * full lifecycle runs against the real DB in `responses.integration.test.ts`.
 *
 * These are the SEC guardrails: export and detail are answer data; without a
 * session they 401, and in a public-only process they do not exist.
 */

import { describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { ADMIN_SESSION_HEADER, registerAdminAuth } from "../../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps } from "../../../test-support.js";
import { registerAdminResponses } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = { groups: { admin: [registerAdminAuth, registerAdminResponses] } };

interface ErrBody {
  error: { code: string; message: string };
}

describe("responses admin auth seam (401 before any handler)", () => {
  const paths: ReadonlyArray<{ method: string; path: string; body?: unknown }> = [
    { method: "GET", path: "/admin/forms/frm_x/responses" },
    { method: "GET", path: "/admin/forms/frm_x/responses/ses_x" },
    { method: "GET", path: "/admin/forms/frm_x/export?format=json" },
    { method: "GET", path: "/admin/erasures" },
    { method: "POST", path: "/admin/sessions/ses_x/erase", body: { reason: "x" } },
    { method: "POST", path: "/admin/responses/ses_x/unflag" },
  ];

  for (const { method, path, body } of paths) {
    it(`${method} ${path} → 401 with no admin session`, async () => {
      const deps = makeDeps(); // unusedDb: the gate rejects before touching it
      const app = createApp(deps, ADMIN_ONLY, adminGroups);
      const res = await app.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-qcms-internal-token": internalTokenFor(deps.config),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
    });
  }
});

describe("responses admin group is absent in a public-only process (ADR-09)", () => {
  it("an admin export route 404s — the group is not mounted, not merely forbidden", async () => {
    const deps = makeDeps();
    const app = createApp(deps, PUBLIC_ONLY, adminGroups);
    const res = await app.request("/admin/forms/frm_x/export?format=json&version=1", {
      headers: {
        "x-qcms-internal-token": internalTokenFor(deps.config),
        [ADMIN_SESSION_HEADER]: "editor-1",
      },
    });
    expect(res.status).toBe(404);
  });
});
