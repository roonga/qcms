import { describe, expect, it } from "vitest";

import { isDevServerAsset, partitionRequests } from "./dev-server-assets.js";

/**
 * The dev-server asset predicate (issue #193).
 *
 * The trap is that `next dev` serves its own error-overlay typeface from the portal's
 * origin, so a wholesale asset count is off by exactly one and reads as a font nobody
 * declared. These tests pin the two properties a spec relies on: the overlay is
 * recognised by WHERE it is served from rather than by its filename, and an asset that
 * is neither ours nor the dev server's lands in a pile that a spec can assert is empty.
 */

const ORIGIN = "http://localhost:7000";

describe("isDevServerAsset", () => {
  it("recognises the error-overlay typeface that cost task 052 a red run", () => {
    expect(isDevServerAsset(`${ORIGIN}/__nextjs_font/geist-latin.woff2`)).toBe(true);
  });

  it("recognises the other dev endpoints under the same prefix", () => {
    expect(isDevServerAsset(`${ORIGIN}/__nextjs_original-stack-frames`)).toBe(true);
    expect(isDevServerAsset(`${ORIGIN}/__nextjs_launch-editor?file=x`)).toBe(true);
    expect(isDevServerAsset(`${ORIGIN}/_next/webpack-hmr`)).toBe(true);
  });

  it("does not claim portal content served from _next", () => {
    expect(isDevServerAsset(`${ORIGIN}/_next/static/media/inter-400.a1b2c3.woff2`)).toBe(false);
    expect(isDevServerAsset(`${ORIGIN}/f/kitchen-sink`)).toBe(false);
  });

  it("is a path predicate, so a query string or another host cannot defeat it", () => {
    expect(isDevServerAsset("http://127.0.0.1/__nextjs_font/geist-latin.woff2?v=2")).toBe(true);
  });

  it("does not match a portal path that merely mentions the prefix", () => {
    // A form slug is respondent-facing and arbitrary, so the prefix must be anchored
    // at the start of the pathname rather than searched for anywhere in the URL.
    expect(isDevServerAsset(`${ORIGIN}/f/__nextjs_font-survey`)).toBe(false);
  });

  it("treats an unparseable URL as unexpected rather than as dev chrome", () => {
    expect(isDevServerAsset("not a url")).toBe(false);
  });
});

describe("partitionRequests", () => {
  const ours = (url: string) => url.includes("/inter-400.");

  it("separates declared assets, dev-server chrome, and everything else", () => {
    const result = partitionRequests(
      [
        `${ORIGIN}/_next/static/media/inter-400.a1b2c3.woff2`,
        `${ORIGIN}/__nextjs_font/geist-latin.woff2`,
        `${ORIGIN}/_next/static/media/mystery-700.d4e5f6.woff2`,
      ],
      ours,
    );
    expect(result.ours).toHaveLength(1);
    expect(result.devServer).toHaveLength(1);
    expect(result.unexpected).toEqual([`${ORIGIN}/_next/static/media/mystery-700.d4e5f6.woff2`]);
  });

  it("never lets dev-server chrome satisfy a declared asset, even on a name collision", () => {
    // The overlay ships `geist-latin.woff2`. A registry entry one rename away from that
    // stem would otherwise make "our file arrived" true while our file 404ed.
    const result = partitionRequests([`${ORIGIN}/__nextjs_font/geist-latin.woff2`], (url) =>
      url.includes("/geist-latin."),
    );
    expect(result.ours).toEqual([]);
    expect(result.devServer).toHaveLength(1);
  });

  it("returns three empty piles for no requests at all", () => {
    expect(partitionRequests([], ours)).toEqual({ ours: [], devServer: [], unexpected: [] });
  });
});
