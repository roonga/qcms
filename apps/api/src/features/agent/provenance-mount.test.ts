import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { makeDeps, validEnv } from "../../test-support.js";
import { agentProvenance, agentProvenanceDisabled } from "./provenance-mount.js";
import { PROPOSAL_HEADER, PROPOSAL_STEP_HEADER } from "./provenance.js";

/**
 * The mount's own property: a request with no token is served exactly as it would be
 * without the middleware, and a request with one that fails is refused rather than served
 * as an ordinary human act (SEC-17, criterion 2).
 */

const MINT_PATH = "/admin/forms/frm_prov/links";

function appWith(middleware: MiddlewareHandler<ApiEnv>): OpenAPIHono<ApiEnv> {
  const app = new OpenAPIHono<ApiEnv>();
  app.onError((error) =>
    Response.json(
      { code: error instanceof ApiError ? error.code : "UNEXPECTED" },
      { status: error instanceof ApiError ? error.status : 500 },
    ),
  );
  app.use("*", async (c, next) => {
    c.set("adminPrincipal", { userId: "usr_mounted", role: "staff", scopes: [] });
    await next();
  });
  app.use("*", middleware);
  app.post(MINT_PATH, (c) =>
    c.json({ served: true, audited: c.get("agentProposal") !== undefined }),
  );
  return app;
}

async function post(
  app: OpenAPIHono<ApiEnv>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(MINT_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ environment: "test", count: 2, expiresAt: "2026-12-31T00:00:00.000Z" }),
  });
}

function depsWith(flag: string | undefined) {
  return makeDeps({
    env: validEnv(flag === undefined ? {} : { QCMS_FLAG_AGENT_AUTHORING: flag }),
  });
}

describe("the provenance middleware as the admin group mounts it", () => {
  it("serves a request carrying no token unchanged, with the flag on", async () => {
    const res = await post(appWith(agentProvenance(depsWith("fake"))));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ served: true, audited: false });
  });

  it("serves a request carrying no token unchanged, with the flag off", async () => {
    const res = await post(appWith(agentProvenanceDisabled()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ served: true, audited: false });
  });

  it("refuses a presented token with 400 when the deployment mints none", async () => {
    const res = await post(appWith(agentProvenanceDisabled()), {
      [PROPOSAL_HEADER]: "anything",
      [PROPOSAL_STEP_HEADER]: "0",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "AGENT_PROPOSAL_DISABLED" });
  });

  it("refuses either header alone, with the flag off", async () => {
    const res = await post(appWith(agentProvenanceDisabled()), { [PROPOSAL_STEP_HEADER]: "0" });
    expect(res.status).toBe(400);
  });

  it("refuses a token that does not verify rather than serving the act", async () => {
    const res = await post(appWith(agentProvenance(depsWith("fake"))), {
      [PROPOSAL_HEADER]: "eyJ2IjoxfQ.not-a-signature",
      [PROPOSAL_STEP_HEADER]: "0",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toMatch(/^AGENT_PROPOSAL_/);
  });

  it("refuses a token presented without its step header", async () => {
    const res = await post(appWith(agentProvenance(depsWith("fake"))), {
      [PROPOSAL_HEADER]: "eyJ2IjoxfQ.sig",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "AGENT_PROPOSAL_MALFORMED" });
  });

  it("refuses a token on a route no action kind declares", async () => {
    const app = appWith(agentProvenance(depsWith("fake")));
    const res = await app.request("/admin/forms/frm_prov/links", {
      method: "GET",
      headers: { [PROPOSAL_HEADER]: "eyJ2IjoxfQ.sig", [PROPOSAL_STEP_HEADER]: "0" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "AGENT_PROPOSAL_ROUTE" });
  });
});
