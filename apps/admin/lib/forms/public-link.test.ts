import { describe, expect, it } from "vitest";

import { publicFormLink } from "./public-link.ts";

/**
 * When a published form has an address to hand out, and when it has none.
 *
 * The four `undefined` cases are the point of this file rather than the happy one. Each is
 * a state a real deployment reaches, and in every one of them the alternative to showing
 * nothing is showing an address that does not work - which is worse than silence, because
 * an operator would hand it to a respondent before finding out.
 */
const PUBLISHED = {
  slug: "life-insurance",
  versions: [{ version: 1 }],
} as unknown as Parameters<typeof publicFormLink>[0];

const DRAFT_ONLY = { slug: "life-insurance", versions: [] } as unknown as Parameters<
  typeof publicFormLink
>[0];

describe("a published form's public address", () => {
  it("is the portal's slug-keyed entry route, which is the address respondents use", () => {
    // `apps/portal/app/f/[formSlug]/page.tsx` is the route, and `scripts/dev-stack.mjs`
    // prints the same shape in its own banner. Asserted as the whole string rather than
    // by parts, because what an operator copies is the whole string.
    expect(publicFormLink(PUBLISHED, "https://forms.example.com")).toBe(
      "https://forms.example.com/f/life-insurance",
    );
  });

  it("treats the configured base as an ORIGIN, so a path on it is dropped", () => {
    // Written down because it is a limitation rather than an accident, and because the
    // assertion looks like a bug until the reason is stated: `/f/...` is an absolute path,
    // so `new URL` resolves it against the origin and any sub-path on the base goes away.
    //
    // It matches the API, which mints every secure link the same way
    // (`apps/api/src/features/links/handler.ts`: `new URL(\`/l/${token}\`, portalBaseUrl)`).
    // A portal mounted under a sub-path would therefore get a wrong address from both, and
    // fixing it in one place only would be worse than the shared limitation: two surfaces
    // handing out two different links for one form. If that deployment ever arrives, both
    // change together.
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
    // Nothing is behind that URL yet: the portal's start route answers `notfound` and the
    // respondent is told the form is unavailable.
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
