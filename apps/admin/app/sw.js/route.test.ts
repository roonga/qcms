import { describe, expect, it } from "vitest";

import { GET } from "./route";

async function served(): Promise<{ body: string; headers: Headers }> {
  const response = GET();
  return { body: await response.text(), headers: response.headers };
}

describe("the service worker this app serves", () => {
  it("is JavaScript the browser may never reuse without revalidating", async () => {
    const { headers } = await served();

    expect(headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(headers.get("cache-control")).toBe("no-cache");
  });

  it("registers no fetch handler, so no response of any kind passes through it", async () => {
    const { body } = await served();

    expect(body).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(body).not.toContain("onfetch");
  });

  it("opens no cache and stores nothing", async () => {
    const { body } = await served();

    for (const api of ["caches", "CacheStorage", "indexedDB", "localStorage", "fetch("]) {
      expect(body, `${api} has no place in an update-only worker`).not.toContain(api);
    }
  });

  it("replaces the active worker only when a page asks it to", async () => {
    const { body } = await served();

    // One call, and it is the guarded one: an unconditional takeover would reload an edit in progress.
    expect(body.match(/skipWaiting/g)).toHaveLength(1);
    expect(body).toMatch(/event\.data === "SKIP_WAITING"\) self\.skipWaiting\(\);/);
  });
});
