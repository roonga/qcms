import { describe, expect, it } from "vitest";

import { MASKED_QUERY, endpointUrlFor, maskEndpointUrl } from "./mask.js";

describe("maskEndpointUrl", () => {
  it("keeps the scheme, the host and the path, and replaces the query", () => {
    expect(maskEndpointUrl("https://consumer.example.com/qcms-hook?token=abc&tenant=acme")).toBe(
      `https://consumer.example.com/qcms-hook?${MASKED_QUERY}`,
    );
  });

  it("replaces the whole query rather than each value", () => {
    const masked = maskEndpointUrl("https://consumer.example.com/hook?apiKey=s3cret");
    expect(masked).not.toContain("apiKey");
    expect(masked).not.toContain("s3cret");
  });

  it("leaves a URL with no query exactly as it is", () => {
    expect(maskEndpointUrl("https://consumer.example.com/qcms-hook")).toBe(
      "https://consumer.example.com/qcms-hook",
    );
  });

  it("drops a fragment with the query rather than keeping it beside the marker", () => {
    expect(maskEndpointUrl("https://consumer.example.com/hook?a=1#part")).toBe(
      `https://consumer.example.com/hook?${MASKED_QUERY}`,
    );
  });

  it("does not throw on a value that is not a URL at all", () => {
    expect(maskEndpointUrl("not a url")).toBe("not a url");
    expect(maskEndpointUrl("")).toBe("");
  });
});

describe("endpointUrlFor", () => {
  const url = "https://consumer.example.com/hook?token=abc";

  it("returns the whole URL only for `whole`", () => {
    expect(endpointUrlFor(url, "whole")).toBe(url);
  });

  it("masks for `masked` and for anything else, including nothing at all", () => {
    expect(endpointUrlFor(url, "masked")).toBe(`https://consumer.example.com/hook?${MASKED_QUERY}`);
    expect(endpointUrlFor(url, undefined)).toBe(
      `https://consumer.example.com/hook?${MASKED_QUERY}`,
    );
  });
});
