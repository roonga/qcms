import { describe, expect, it } from "vitest";

import { MASKED_QUERY, endpointUrlFor, maskEndpointUrl } from "./mask.js";

/**
 * Q58's masking, on the unit that decides it (task 067, criterion 8's clause).
 *
 * The criterion is asserted at the API in `apps/api/e2e/security/01-authorization-matrix.e2e.ts`,
 * for each of the two roles, against the bytes a real request gets back. What is here is
 * the string work underneath it, and three of these cases are the ones a role-level probe
 * cannot reach: a URL with no query, a URL with a fragment, and the fail-closed direction
 * when the middleware classified nothing.
 */
describe("maskEndpointUrl", () => {
  it("keeps the scheme, the host and the path, and replaces the query", () => {
    // The role is meant to be able to tell what this endpoint is, which is why only the
    // query goes.
    expect(maskEndpointUrl("https://consumer.example.com/qcms-hook?token=abc&tenant=acme")).toBe(
      `https://consumer.example.com/qcms-hook?${MASKED_QUERY}`,
    );
  });

  it("replaces the whole query rather than each value", () => {
    // A parameter NAME is as likely to be the interesting part as its value, and a masked
    // value beside a plain `token=` tells a reader exactly what to go and ask for. A fixed
    // token also cannot be reversed by counting characters.
    const masked = maskEndpointUrl("https://consumer.example.com/hook?apiKey=s3cret");
    expect(masked).not.toContain("apiKey");
    expect(masked).not.toContain("s3cret");
  });

  it("leaves a URL with no query exactly as it is", () => {
    // The ordinary case, and the reason this is safe to apply to every row rather than to
    // the ones that look interesting.
    expect(maskEndpointUrl("https://consumer.example.com/qcms-hook")).toBe(
      "https://consumer.example.com/qcms-hook",
    );
  });

  it("drops a fragment with the query rather than keeping it beside the marker", () => {
    // A fragment is never sent to a server, and `path?(hidden)#frag` would read as though
    // the fragment were part of what was kept.
    expect(maskEndpointUrl("https://consumer.example.com/hook?a=1#part")).toBe(
      `https://consumer.example.com/hook?${MASKED_QUERY}`,
    );
  });

  it("does not throw on a value that is not a URL at all", () => {
    // It runs on the way out of a read, where a throw would turn a masked field into a
    // 500. String surgery rather than `new URL()` for exactly that reason.
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
    // The fail-closed direction, and the reason the context field is read here rather
    // than defaulted in the middleware: a row the middleware did not classify is masked.
    expect(endpointUrlFor(url, "masked")).toBe(`https://consumer.example.com/hook?${MASKED_QUERY}`);
    expect(endpointUrlFor(url, undefined)).toBe(
      `https://consumer.example.com/hook?${MASKED_QUERY}`,
    );
  });
});
