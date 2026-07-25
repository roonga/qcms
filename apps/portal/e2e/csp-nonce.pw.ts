/**
 * CSP nonce end to end (SEC-9, issue #20).
 *
 * The portal mints one nonce per request in `proxy.ts`, names it in the
 * response `Content-Security-Policy`, and stamps it on the inline theme-bootstrap
 * script the root layout renders. This spec proves the whole chain against a real
 * browser, because a nonce that does not match its own CSP header is not a
 * control at all: it either blocks the script or silently authorizes nothing.
 *
 * What is asserted, and why each part matters:
 *
 * 1. The nonce the SSR HTML stamps is *character for character* the nonce the
 *    same response's CSP names. A mismatch (or the empty nonce issue #20
 *    suspected) would mean the inline script is unauthorized.
 * 2. The nonce is minted per request: two loads get different values. A constant
 *    nonce is equivalent to `'unsafe-inline'` for an attacker who can read one
 *    page.
 * 3. `script-src` still names no `'unsafe-inline'` and no `'unsafe-eval'`, so the
 *    nonce is the only thing authorizing inline script. This is the regression
 *    guard for "fix the hydration warning by loosening the CSP".
 * 4. The browser actually applied the nonce: the inline script ran (it sets the
 *    theme class on <html>) and the element's `nonce` IDL property holds the real
 *    value.
 *
 * On the `nonce` *content attribute* reading empty in the DOM (what issue #20 read
 * as an empty server-rendered nonce): that is the HTML specification's nonce
 * hiding, not a server or propagation defect. On insertion the browser moves the
 * value into the element's internal `[[CSPNonce]]` slot (exposed as the `.nonce`
 * property) and blanks the content attribute, so a CSS attribute selector cannot
 * exfiltrate it. Every nonced script on the page shows it. The served HTML
 * (asserted below) carries the real value, and so does the RSC payload React
 * hydrates from, so the server and client React trees agree; only the attribute
 * React reads back differs, which is why `app/layout.tsx` suppresses the
 * hydration warning on that one element and nowhere else.
 *
 * The shared gate in `support/gates.ts` still fails this spec on any console
 * error, so a CSP violation (the script losing its nonce) or a real hydration
 * failure elsewhere reds the run. No allowlist entry for a nonce or hydration
 * warning exists, and none may be added (issue #20).
 */

// Type only: the gated `test` / `expect` still come from `support/gates.js`.
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
  // The theme bootstrap is the inline <script> whose body reads the theme cookie.
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

  // 1. Server and CSP agree, and the nonce is a real value (issue #20 suspected
  //    an empty one). 16 random bytes base64-encode to 24 characters.
  expect(ssrNonce).toBe(cspNonce);
  expect(ssrNonce).not.toBe("");
  expect(ssrNonce).toHaveLength(24);
  // No script in the served markup carries an empty nonce.
  expect(html).not.toContain('nonce=""');

  // 3. The nonce is the ONLY thing authorizing inline script.
  const scriptSrc = /script-src ([^;]*)/.exec(csp ?? "")?.[1] ?? "";
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");

  // 4. The browser applied it: the inline theme script ran (only possible if the
  //    nonce authorized it), and the element's nonce property holds the real
  //    value even though the content attribute is blanked by nonce hiding.
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
  // Browser nonce hiding, asserted so a future browser that stops doing it shows
  // up here (and the layout's suppression could then be dropped) rather than as a
  // silent change of meaning.
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
