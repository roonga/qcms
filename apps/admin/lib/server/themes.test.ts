import { beforeEach, describe, expect, it, vi } from "vitest";

import { shippedThemeOptions } from "./appearance-options.ts";

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

/* A shipped theme's own colours, so the test writes no colour of its own. */
const PALETTES = (() => {
  const first = shippedThemeOptions()[0];
  if (first === undefined) throw new Error("no shipped theme to borrow palettes from");
  return first.palettes;
})();

const THEME_ID = "9f3a2b1c-0000-4000-8000-000000000000";
const NAME = "From the site";

const THEME = {
  name: NAME,
  palettes: PALETTES,
  face: "lexend",
  corners: "subtle",
  pageTint: false,
  logoKey: null,
  sourceHost: "brand.example",
};

const SAVED = {
  themeId: THEME_ID,
  workspaceId: "org_a",
  name: NAME,
  palettes: PALETTES,
  face: "lexend",
  corners: "subtle",
  pageTint: false,
  logoKey: null,
  sourceHost: "brand.example",
  updatedAt: "2026-11-22T00:00:00.000Z",
};

beforeEach(() => {
  calls.length = 0;
});

describe("keeping a look as a workspace theme", () => {
  it("reads the saved row the route answers under `theme`, so the name is the stored one", async () => {
    reply = json(201, { theme: SAVED });
    const { createWorkspaceTheme } = await import("./themes.ts");
    const result = await createWorkspaceTheme(SESSION, "org_a", THEME);
    expect(calls[0]?.path).toBe("/workspaces/org_a/themes");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toStrictEqual(THEME);
    expect(result).toStrictEqual({ ok: true, data: { themeId: THEME_ID, name: NAME } });
  });

  it("refuses a success body carrying no saved row rather than naming nothing", async () => {
    reply = json(201, { themeId: THEME_ID, name: NAME });
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
