import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The admin requires JavaScript (Code Owner, 2026-09-27;
 * `plan/admin-design-contracts.md`, "Standing correction").
 *
 * The browser claim - that a scriptless operator sees the message and nothing else - is
 * `e2e/requires-js.pw.ts`, because only a browser can switch scripting off and only a
 * browser applies a `<noscript>` rule. That is the layer ADR-23 assigns it to.
 *
 * What is left for this layer is the half a browser cannot fail on: the gate is in the
 * ROOT layout and not in a screen. Every admin route renders through
 * `app/layout.tsx`, so putting the check there is what makes the browser spec's two
 * routes representative of all of them; putting it in the shell layout or on the sign-in
 * page would pass an e2e that checked those two and leave the rest open. A markup
 * assertion is the only way to say that about the layout itself rather than about a
 * sample of its routes.
 *
 * The second claim is the pairing that makes the gate flash-free, and it is the one that
 * breaks silently. The message must be rendered UNCONDITIONALLY and hidden by
 * `globals.css`; the `<noscript>` rule reveals it. Rendering it conditionally would need
 * client code, and hiding it inline instead of in the sheet would paint it for one frame
 * on every scripted load. Neither failure is visible in the e2e spec with scripting off,
 * because both look identical there.
 *
 * ## Why the module is reached the way it is
 *
 * `app/layout.tsx` is an async server component reading `cookies()`, so `next/headers` is
 * stubbed and the component is awaited into an element before `renderToStaticMarkup` is
 * asked for a string. Nothing else is stubbed: the catalog is real, because the rendered
 * STRINGS are half of what is being asserted, and `HydrationMarker` is real because it
 * renders nothing either way.
 */

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { default: AdminRootLayout } = await import("./layout.tsx");
const { messages } = await import("../lib/i18n/en.ts");

/** The layout's markup around a stand-in for whatever screen a route puts inside it. */
async function markup(): Promise<string> {
  return renderToStaticMarkup(
    await AdminRootLayout({ children: <main id="main-content">a screen</main> }),
  );
}

describe("the root layout's JavaScript-required gate", () => {
  it("renders the catalogued message on every route", async () => {
    const html = await markup();
    expect(html).toContain(messages["requiresJs.title"]);
    expect(html).toContain(messages["requiresJs.body"]);
  });

  it("announces the message and heads it, so it is reachable and not a bare sentence", async () => {
    const html = await markup();
    expect(html).toMatch(/role="alert"/);
    // The heading is the one an operator's heading walk lands on, because in the state
    // this renders for it is the page's only content.
    expect(html).toMatch(/<h1[^>]*>JavaScript is required<\/h1>/);
  });

  it("hides the message through the stylesheet rather than by not rendering it", async () => {
    const html = await markup();
    // Present in the server HTML unconditionally: no `display:none` written inline here,
    // and nothing that could only be decided in the browser.
    expect(html).toContain('class="qcms-requires-js"');
    expect(html, "an inline hide would defeat the noscript reveal").not.toMatch(
      /qcms-requires-js[^>]*style=/,
    );
  });

  it("carries the gate as a noscript style block and grants nothing to script-src", async () => {
    const html = await markup();
    // The rule itself: everything in the body goes, the message comes back. Asserted as
    // the shipped text because the `!important` and the `:not()` are both load-bearing -
    // the first survives whatever order Next injects the stylesheet link in, the second
    // is what makes this one rule cover every screen.
    expect(html).toContain(
      "<noscript><style>body>:not(.qcms-requires-js){display:none!important}" +
        ".qcms-requires-js{display:flex!important}</style></noscript>",
    );
    // A script would be the one thing that cannot run in the case the gate exists for,
    // and it would also need the CSP nonce this app deliberately never threads into React
    // (`lib/server/csp.ts`).
    expect(html).not.toContain("<script");
  });

  it("leaves the shell and the skip link in place for a scripted operator", async () => {
    const html = await markup();
    // The gate adds a sibling; it does not replace what was already rendered. If it did,
    // every scripted screen would be gone too and no no-JS assertion would notice.
    expect(html).toContain("skip-link");
    expect(html).toContain('id="main-content"');
  });

  it("puts the message after everything else in the body", async () => {
    const html = await markup();
    // Position, asserted because it is load-bearing rather than cosmetic and because the
    // browser suite is where it was found. Document order does not matter to the reader
    // this is for - in the state where the message shows, every sibling is out of the
    // accessibility tree - but it matters to any locator that reads document order, and the
    // admin suite reads `page.locator("h1").first()` on two screens. With this block first
    // in the body, `.first()` was this heading on every page in the app.
    expect(html.indexOf('class="qcms-requires-js"')).toBeGreaterThan(html.indexOf("main-content"));
    expect(html.trimEnd()).toMatch(/<\/div><\/body><\/html>$/);
  });
});
