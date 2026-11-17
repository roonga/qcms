import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let requestHeaders = new Headers();
const jar = new Map<string, string>();
const deleted: string[] = [];

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(requestHeaders),
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: (name: string, value: string) => jar.set(name, value),
      delete: (name: string) => {
        deleted.push(name);
        jar.delete(name);
      },
    }),
}));

const PALETTE = { primary: "#1d4ed8", text: "#111111", background: "#fafafa" };
const APPEARANCE = {
  palettes: {
    light: PALETTE,
    dark: PALETTE,
    lightHighContrast: PALETTE,
    darkHighContrast: PALETTE,
  },
  logo: null,
  face: "lexend",
  corners: "pill",
  density: "compact",
  textSize: 16,
  progress: "none",
  pageTint: false,
};

let requested: string[] = [];
let statusBody: () => Response;

beforeEach(() => {
  requested = [];
  jar.clear();
  deleted.length = 0;
  requestHeaders = new Headers();
  statusBody = () =>
    Response.json({ sessionId: "ses_1", status: "in_progress", appearance: APPEARANCE });
  vi.stubEnv("QCMS_API_BASE_URL", "http://api.internal:4000");
  vi.stubEnv("QCMS_INTERNAL_TOKEN", "internal-token-value-for-this-test-only");
  vi.stubGlobal("fetch", (input: string) => {
    requested.push(new URL(input).pathname);
    return Promise.resolve(statusBody());
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function load() {
  const [mod, env] = await Promise.all([import("./session-appearance"), import("./environment")]);
  return { ...mod, PATH_HEADER: env.PATH_HEADER };
}

describe("sessionFormAppearance", () => {
  it("reads the session status, never a step, so opening any step mints nothing", async () => {
    const { sessionFormAppearance, PATH_HEADER } = await load();
    requestHeaders.set(PATH_HEADER, "/s/ses_1");
    jar.set("qcms_session", "token");

    expect(await sessionFormAppearance()).toMatchObject({ face: "lexend", corners: "pill" });
    expect(requested).toEqual(["/sessions/ses_1"]);
  });

  it("reads the completion page's copy without calling the API", async () => {
    const { sessionFormAppearance, rememberCompletionAppearance, PATH_HEADER } = await load();
    await rememberCompletionAppearance("ses_1", "token");
    requested = [];

    requestHeaders.set(PATH_HEADER, "/done");
    expect(await sessionFormAppearance()).toMatchObject({ face: "lexend", density: "compact" });
    expect(requested).toEqual([]);
  });

  it("is null off a session page and without a token", async () => {
    const { sessionFormAppearance, PATH_HEADER } = await load();
    requestHeaders.set(PATH_HEADER, "/f/road-cover");
    expect(await sessionFormAppearance()).toBeNull();
    requestHeaders.set(PATH_HEADER, "/s/ses_1");
    expect(await sessionFormAppearance()).toBeNull();
    expect(requested).toEqual([]);
  });
});

describe("rememberCompletionAppearance", () => {
  it("clears an earlier form's copy when this one has no appearance or cannot be read", async () => {
    const { rememberCompletionAppearance, COMPLETION_APPEARANCE_COOKIE } = await load();
    await rememberCompletionAppearance("ses_1", "token");
    expect(jar.has(COMPLETION_APPEARANCE_COOKIE)).toBe(true);

    statusBody = () => Response.json({ sessionId: "ses_2", status: "submitted", appearance: null });
    await rememberCompletionAppearance("ses_2", "token");
    expect(jar.has(COMPLETION_APPEARANCE_COOKIE)).toBe(false);

    statusBody = () =>
      Response.json({ sessionId: "ses_1", status: "submitted", appearance: APPEARANCE });
    await rememberCompletionAppearance("ses_1", "token");
    expect(jar.has(COMPLETION_APPEARANCE_COOKIE)).toBe(true);
    statusBody = () => new Response("down", { status: 503 });
    await rememberCompletionAppearance("ses_3", "token");
    expect(jar.has(COMPLETION_APPEARANCE_COOKIE)).toBe(false);
    expect(deleted).toEqual([COMPLETION_APPEARANCE_COOKIE, COMPLETION_APPEARANCE_COOKIE]);
  });
});
