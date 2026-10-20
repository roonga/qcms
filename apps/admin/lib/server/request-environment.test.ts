import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENVIRONMENT_COOKIE } from "../environment.ts";

import { ENVIRONMENT_HEADER } from "./request-environment.ts";

/**
 * The API header and the screen read ONE resolution of the environment (local UX list A12).
 *
 * Before this the header carried the raw cookie while the shell validated it against the
 * live set and fell back to `prod`, so a stale selection showed production in the chrome
 * while every read went to whatever the cookie still named. This drives the real
 * `adminApiFetch` over a faked `fetch` and asserts what crosses the hop: the read of the
 * set carries no environment (a stale one would have the API refuse that very read), and
 * every other call carries exactly what `requestEnvironment` resolved.
 */

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "qcms-environment" && jar.value !== undefined ? { value: jar.value } : undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));

const { adminApiFetch, requestEnvironment } = await import("./api.ts");

const SESSION = {
  userId: "usr_1",
  email: "admin@example.test",
  name: "Admin",
  role: "admin",
  twoFactorEnabled: true,
  mustChangePassword: false,
  token: "session-token-for-this-test-only",
};

/** Each request the fake API saw: its path and the environment header it carried. */
let seen: { path: string; environment: string | null }[] = [];
/** What `GET /admin/environments` answers with; `undefined` makes it fail. */
let set: readonly string[] | undefined = ["prod", "test"];

beforeEach(() => {
  process.env.QCMS_API_BASE_URL = "http://api.example.test";
  process.env.QCMS_INTERNAL_TOKEN = "synthetic-internal-token-for-this-test-000";
  seen = [];
  set = ["prod", "test"];
  jar.value = undefined;
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    seen.push({ path, environment: headers.get(ENVIRONMENT_HEADER) });
    if (path === "/admin/environments") {
      if (set === undefined) return Promise.resolve(new Response("{}", { status: 503 }));
      return Promise.resolve(
        Response.json({
          environments: set.map((name, index) => ({ name, position: index + 1 })),
        }),
      );
    }
    return Promise.resolve(Response.json({}));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.QCMS_API_BASE_URL;
  delete process.env.QCMS_INTERNAL_TOKEN;
});

/** The environment header the one non-set call carried. */
function headerOfTheCall(): string | null | undefined {
  return seen.find((entry) => entry.path === "/admin/forms")?.environment;
}

describe("the environment header", () => {
  it("is sent on the resolved selection", async () => {
    jar.value = "test";

    await adminApiFetch(SESSION, "/forms");

    expect(headerOfTheCall()).toBe("test");
  });

  it("names prod for a stale selection, which is what the shell shows", async () => {
    jar.value = "staging";

    const resolved = await requestEnvironment(SESSION);
    await adminApiFetch(SESSION, "/forms");

    expect(resolved).toMatchObject({ status: "known", environment: "prod" });
    // The regression: this used to be "staging" under a chrome that said prod.
    expect(headerOfTheCall()).toBe("prod");
  });

  it("is never sent on the read of the set itself", async () => {
    jar.value = "staging";

    await adminApiFetch(SESSION, "/forms");

    const reads = seen.filter((entry) => entry.path === "/admin/environments");
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((entry) => entry.environment === null)).toBe(true);
  });

  it("resolves to unknown, not prod, when the set cannot be read", async () => {
    jar.value = "test";
    set = undefined;

    expect(await requestEnvironment(SESSION)).toEqual({ status: "unknown", selection: "test" });
  });

  it("reads the cookie the shell writes", () => {
    // The fake jar above answers one name; this keeps it the real one.
    expect(ENVIRONMENT_COOKIE).toBe("qcms-environment");
  });
});
