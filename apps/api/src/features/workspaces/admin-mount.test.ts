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
