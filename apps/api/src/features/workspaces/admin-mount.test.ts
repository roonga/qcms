/**
 * Admin-group mount and auth-seam tests for the workspaces slice (task 068).
 *
 * The surface guarantees without a database: the admin-auth gate rejects an
 * unauthenticated request before any handler runs, and a public-only process has no admin
 * group at all, so a workspace route 404s rather than 403s (ADR-09). A respondent-facing
 * process therefore cannot archive a workspace or move a form between workspaces even if
 * something inside it tried to. The model itself - the archive refusal, the move, the
 * shared switch - is exercised against a real Postgres in
 * `workspaces.integration.test.ts`.
 *
 * **There is no role assertion here and that is not an omission.** Task 068 builds the
 * container and grants nothing: these routes sit behind the admin-session gate every
 * other admin slice sits behind, and ADR-41's `forms.owner` arrives with task 069.
 */

import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { registerGrantCheck } from "../membership/middleware.js";
import { registerAdminAuth } from "../../middleware/admin-auth.js";
import { registerRequestEnvironment } from "../../middleware/request-environment.js";
import { internalTokenFor, makeDeps } from "../../test-support.js";
import { registerWorkspaces } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const PUBLIC_ONLY = { public: true, internal: false, admin: false } as const;
const adminGroups = {
  groups: {
    admin: [registerAdminAuth, registerRequestEnvironment, registerGrantCheck, registerWorkspaces],
  },
};

interface ErrBody {
  error: { code: string; message: string };
}

/** Every route this slice mounts, as a method and a path. */
const ROUTES: readonly [string, string][] = [
  ["GET", "/admin/workspaces"],
  ["POST", "/admin/workspaces"],
  ["PUT", "/admin/workspaces/org_x/shared"],
  ["POST", "/admin/workspaces/org_x/archive"],
  ["POST", "/admin/forms/frm_x/workspace"],
  ["POST", "/admin/questions/q_x/workspace"],
];

describe("workspaces admin auth seam", () => {
  it.each(ROUTES)(
    "refuses %s %s with no admin session → 401 (before any handler)",
    async (method, path) => {
      // `unusedDb`: the gate must reject before anything touches the database, so a leak
      // here fails loudly rather than passing quietly.
      const deps = makeDeps();
      const app = createApp(deps, ADMIN_ONLY, adminGroups);
      const res = await app.request(path, {
        method,
        headers: {
          "content-type": "application/json",
          "x-qcms-internal-token": internalTokenFor(deps.config),
        },
        ...(method === "GET" ? {} : { body: JSON.stringify({}) }),
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as ErrBody).error.code).toBe("unauthorized");
    },
  );
});

describe("ADR-09: no workspace surface in a respondent-only process", () => {
  it.each(ROUTES)("does not mount %s %s at all → 404", async (method, path) => {
    const deps = makeDeps();
    const app = createApp(deps, PUBLIC_ONLY, adminGroups);
    const res = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-qcms-internal-token": internalTokenFor(deps.config),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify({}) }),
    });
    expect(res.status).toBe(404);
  });
});
