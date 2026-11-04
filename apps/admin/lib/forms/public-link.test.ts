import { describe, expect, it } from "vitest";

import { publicFormLink } from "./public-link.ts";

const PUBLISHED = {
  slug: "life-insurance",
  versions: [{ version: 1 }],
} as unknown as Parameters<typeof publicFormLink>[0];

const DRAFT_ONLY = { slug: "life-insurance", versions: [] } as unknown as Parameters<
  typeof publicFormLink
>[0];

describe("a published form's public address", () => {
  it("is the portal's slug-keyed entry route, which is the address respondents use", () => {
    expect(publicFormLink(PUBLISHED, "https://forms.example.com")).toBe(
      "https://forms.example.com/f/life-insurance",
    );
  });

  it("treats the configured base as an ORIGIN, so a path on it is dropped", () => {
    // Absolute /f paths discard base subpaths, matching secure-link minting. Subpath-mounted portals are unsupported.
    expect(publicFormLink(PUBLISHED, "https://example.com/portal/")).toBe(
      "https://example.com/f/life-insurance",
    );
  });

  it("escapes a slug on its way into the path", () => {
    const odd = { slug: "a b/c", versions: [{ version: 1 }] } as unknown as typeof PUBLISHED;
    expect(publicFormLink(odd, "https://forms.example.com")).toBe(
      "https://forms.example.com/f/a%20b%2Fc",
    );
  });

  it("has none for a form that has never been published", () => {
    expect(publicFormLink(DRAFT_ONLY, "https://forms.example.com")).toBeUndefined();
  });

  it("has none when this deployment has not been told where the portal is", () => {
    expect(publicFormLink(PUBLISHED, undefined)).toBeUndefined();
    expect(publicFormLink(PUBLISHED, "   ")).toBeUndefined();
  });

  it("has none when the configured base cannot be parsed, rather than throwing a screen away", () => {
    expect(publicFormLink(PUBLISHED, "not a url")).toBeUndefined();
  });
});
