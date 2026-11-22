import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveAppearance } from "@roonga/qcms-core";

interface Call {
  readonly path: string;
  readonly method: string | undefined;
  readonly body: Record<string, unknown> | undefined;
}

const calls: Call[] = [];
let reply: Response = new Response(null, { status: 500 });

const adminApiFetch = vi.fn(
  (
    _session: unknown,
    path: string,
    init?: { method?: string; body?: Record<string, unknown> },
  ): Promise<Response> => {
    calls.push({ path, method: init?.method, body: init?.body });
    return Promise.resolve(reply);
  },
);

vi.mock("./api.ts", () => ({ adminApiFetch }));

const SESSION = {
  userId: "u_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "tok",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const DERIVED = deriveAppearance({ primary: "#0f766e" });

const THEME = {
  name: "From the site",
  palettes: DERIVED.palettes,
  face: DERIVED.face,
  corners: "subtle",
  pageTint: DERIVED.pageTint,
  logoKey: null,
  sourceHost: "brand.example",
};

beforeEach(() => {
  calls.length = 0;
});

describe("saving a workspace theme", () => {
  it("reads the saved row the route answers under `theme`, so the name is the stored one", async () => {
    reply = json(201, {
      theme: {
        themeId: "9f3a2b1c-0000-4000-8000-000000000000",
        workspaceId: "org_a",
        name: "From the site",
        palettes: DERIVED.palettes,
        face: DERIVED.face,
        corners: "subtle",
        pageTint: false,
        logoKey: null,
        sourceHost: "brand.example",
        updatedAt: "2026-11-22T00:00:00.000Z",
      },
    });
    const { createWorkspaceTheme } = await import("./themes.ts");
    const result = await createWorkspaceTheme(SESSION, "org_a", THEME);
    expect(calls[0]?.path).toBe("/workspaces/org_a/themes");
    expect(calls[0]?.method).toBe("POST");
    expect(result).toStrictEqual({
      ok: true,
      data: { themeId: "9f3a2b1c-0000-4000-8000-000000000000", name: "From the site" },
    });
  });

  it("refuses a success body carrying no saved row rather than naming nothing", async () => {
    reply = json(201, { themeId: "9f3a2b1c-0000-4000-8000-000000000000", name: "From the site" });
    const { createWorkspaceTheme } = await import("./themes.ts");
    const result = await createWorkspaceTheme(SESSION, "org_a", THEME);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("INVALID_THEME");
  });

  it("passes the route's own refusal through", async () => {
    reply = json(409, { error: { code: "THEME_NAME_TAKEN" } });
    const { createWorkspaceTheme } = await import("./themes.ts");
    const result = await createWorkspaceTheme(SESSION, "org_a", THEME);
    expect(result.ok ? "" : result.code).toBe("THEME_NAME_TAKEN");
  });
});
