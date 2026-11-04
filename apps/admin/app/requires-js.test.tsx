import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const { default: AdminRootLayout } = await import("./layout.tsx");
const { messages } = await import("../lib/i18n/en.ts");

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
    expect(html).toMatch(/<h1[^>]*>JavaScript is required<\/h1>/);
  });

  it("hides the message through the stylesheet rather than by not rendering it", async () => {
    const html = await markup();
    expect(html).toContain('class="qcms-requires-js"');
    expect(html, "an inline hide would defeat the noscript reveal").not.toMatch(
      /qcms-requires-js[^>]*style=/,
    );
  });

  it("carries the gate as a noscript style block and grants nothing to script-src", async () => {
    const html = await markup();
    expect(html).toContain(
      "<noscript><style>body>:not(.qcms-requires-js){display:none!important}" +
        ".qcms-requires-js{display:flex!important}</style></noscript>",
    );
    expect(html).not.toContain("<script");
  });

  it("leaves the shell and the skip link in place for a scripted operator", async () => {
    const html = await markup();
    expect(html).toContain("skip-link");
    expect(html).toContain('id="main-content"');
  });

  it("puts the message after everything else in the body", async () => {
    const html = await markup();
    expect(html.indexOf('class="qcms-requires-js"')).toBeGreaterThan(html.indexOf("main-content"));
    expect(html.trimEnd()).toMatch(/<\/div><\/body><\/html>$/);
  });
});
