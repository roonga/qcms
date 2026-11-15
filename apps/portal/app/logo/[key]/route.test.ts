import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));

const KEY = "a".repeat(64);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

let requested: string[] = [];
let upstream: () => Response;

beforeEach(() => {
  requested = [];
  upstream = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  vi.stubEnv("QCMS_API_BASE_URL", "http://api.internal:4000");
  vi.stubEnv("QCMS_INTERNAL_TOKEN", "internal-token-value-for-this-test-only");
  vi.stubGlobal("fetch", (input: string) => {
    requested.push(input);
    return Promise.resolve(upstream());
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function serve(key: string): Promise<Response> {
  const { GET } = await import("./route");
  return GET(new Request(`https://portal.test/logo/${key}`), {
    params: Promise.resolve({ key }),
  });
}

describe("the respondent-facing logo route", () => {
  it("serves the API's bytes with the stored type, nosniff and a long immutable cache", async () => {
    const res = await serve(KEY);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toStrictEqual(PNG);
    expect(requested).toEqual([`http://api.internal:4000/logos/${KEY}`]);
  });

  it("answers 404 for a malformed key without calling the API at all", async () => {
    for (const key of ["", "not-a-key", KEY.toUpperCase(), `${KEY}a`, "../secret"]) {
      const res = await serve(key);
      expect(res.status, key).toBe(404);
    }
    expect(requested).toEqual([]);
  });

  it("answers the same 404 when the API refuses, saying nothing about why", async () => {
    upstream = () => new Response("", { status: 404 });
    const res = await serve(KEY);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("refuses to pass through a type the store never holds", async () => {
    upstream = () =>
      new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } });
    expect((await serve(KEY)).status).toBe(404);

    upstream = () => new Response(PNG, { status: 200, headers: { "content-type": "text/html" } });
    expect((await serve(KEY)).status).toBe(404);
  });

  it("passes a raster type through whatever charset parameter the API sent with it", async () => {
    upstream = () =>
      new Response(PNG, { status: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" } });
    const res = await serve(KEY);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});
