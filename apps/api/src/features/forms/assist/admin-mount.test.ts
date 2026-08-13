/**
 * Flag `none` means the assist routes do not exist (041, exit criterion 1).
 *
 * Not "exist and refuse" - *absent*, the mount-flag shape ADR-09 uses, so a
 * request 404s. That is the difference between a feature that is off and a
 * feature that is merely disabled, and it is the one an operator can verify.
 */

import { describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { loadConfig } from "../../../config.js";
import { registerAdminAuth } from "../../../middleware/admin-auth.js";
import { internalTokenFor, makeDeps, validEnv } from "../../../test-support.js";
import { registerForms } from "../route.js";
import { registerFormsAssist } from "./route.js";

const ADMIN_ONLY = { public: false, internal: false, admin: true } as const;
const groups = { groups: { admin: [registerAdminAuth, registerForms, registerFormsAssist] } };

function appFor(env: Record<string, string | undefined>) {
  const deps = makeDeps({ env });
  return { app: createApp(deps, ADMIN_ONLY, groups), deps };
}

const ASSIST_PATH = "/admin/forms/frm_x/draft/assist";

async function post(
  app: ReturnType<typeof createApp>,
  token: string,
  path = ASSIST_PATH,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-qcms-internal-token": token,
    },
    body: JSON.stringify({ conversation: [{ role: "user", content: "hi" }] }),
  });
}

/** Every path this app actually registered a handler for. */
function registeredPaths(app: ReturnType<typeof createApp>): string[] {
  return app.routes.map((r) => r.path);
}

describe("assist route mounting (ADR-24 flag, ADR-09 shape)", () => {
  it("registers no assist route when the flag is none (the default)", () => {
    const { app, deps } = appFor(validEnv());
    expect(deps.config.flags.agentAuthoring).toBe("none");
    expect(registeredPaths(app).filter((p) => p.includes("assist"))).toEqual([]);
  });

  it("registers the assist route when a provider is configured", () => {
    const { app } = appFor(validEnv({ QCMS_FLAG_AGENT_AUTHORING: "fake" }));
    // Both the handler and its rate limiter; the negative above is therefore
    // about this route specifically, not about the matcher never seeing it.
    expect(registeredPaths(app).filter((p) => p.includes("assist")).length).toBeGreaterThan(0);
  });

  it("leaves the rest of the forms slice mounted either way", async () => {
    const { app, deps } = appFor(validEnv());
    const res = await post(app, internalTokenFor(deps.config), "/admin/forms");
    expect(res.status).toBe(401);
    expect(registeredPaths(app).some((p) => p.endsWith("/forms"))).toBe(true);
  });

  it("boots with no provider key at all when the flag is none", () => {
    const env = validEnv();
    delete env.QCMS_AGENT_API_KEY;
    delete env.QCMS_AGENT_MODEL;
    expect(() => loadConfig(env)).not.toThrow();
  });
});
