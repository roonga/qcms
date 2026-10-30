import type { Response } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";

/** The nonce token the response's own CSP names in `script-src`. */
function nonceFromCsp(csp: string | undefined): string {
  expect(csp, "the response must carry a Content-Security-Policy").toBeTruthy();
  const match = /script-src [^;]*'nonce-([^']+)'/.exec(csp ?? "");
  expect(match, `script-src must name a nonce, got: ${csp ?? "(no header)"}`).not.toBeNull();
  return match?.[1] ?? "";
}

/** The nonce stamped on the inline theme-bootstrap script in the served HTML. */
function nonceFromThemeScript(html: string): string {
  const match = /<script nonce="([^"]*)"[^>]*>[^<]*qcms-theme/.exec(html);
  expect(match, "the served HTML must stamp a nonce on the inline theme script").not.toBeNull();
  return match?.[1] ?? "";
}

/** Read the CSP nonce, the SSR nonce, and the CSP off one navigation response. */
async function readNonces(response: Response | null) {
  expect(response, "the navigation must produce a response").not.toBeNull();
  const csp = response?.headers()["content-security-policy"];
  const html = (await response?.text()) ?? "";
  return { csp, cspNonce: nonceFromCsp(csp), ssrNonce: nonceFromThemeScript(html), html };
}

test("the SSR nonce is the nonce the response's own CSP names", async ({ page }) => {
  const { slug } = readFixtures();

  const { csp, cspNonce, ssrNonce, html } = await readNonces(await page.goto(`/f/${slug}`));

  expect(ssrNonce).toBe(cspNonce);
  expect(ssrNonce).not.toBe("");
  expect(ssrNonce).toHaveLength(24);
  expect(html).not.toContain('nonce=""');

  const scriptSrc = /script-src ([^;]*)/.exec(csp ?? "")?.[1] ?? "";
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  // `next dev` compiles with `eval`-based sourcemaps and a production build never does,
  // so which answer is correct depends on what this harness is serving; the production
  // string itself is asserted byte-for-byte in `lib/server/csp.test.ts`.
  expect(scriptSrc.includes("'unsafe-eval'")).toBe(process.env["QCMS_HARNESS_BUILD"] !== "1");

  await expect(page.locator("html")).toHaveClass(/\b(light|dark)\b/);
  const applied = await page.evaluate(() => {
    const theme = [...document.querySelectorAll("head script")].find((script) =>
      (script.textContent ?? "").includes("qcms-theme"),
    );
    return {
      found: theme instanceof HTMLScriptElement,
      property: theme instanceof HTMLScriptElement ? theme.nonce : null,
      attribute: theme?.getAttribute("nonce") ?? null,
    };
  });
  expect(applied.found, "the inline theme script must be in the live document").toBe(true);
  expect(applied.property).toBe(cspNonce);
  expect(applied.attribute).toBe("");
});

test("the nonce is minted per request, not a constant", async ({ page }) => {
  const { slug } = readFixtures();

  const first = await readNonces(await page.goto(`/f/${slug}`));
  const second = await readNonces(await page.reload());

  expect(first.ssrNonce).toBe(first.cspNonce);
  expect(second.ssrNonce).toBe(second.cspNonce);
  expect(second.ssrNonce).not.toBe(first.ssrNonce);
});
