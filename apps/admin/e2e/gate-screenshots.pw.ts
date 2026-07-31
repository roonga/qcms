import { expect, test } from "../../portal/e2e/support/gates.js";

import { ADMIN_BASE_URL } from "./support/harness-config.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";

/**
 * Capture the screenshot set for the human design gate (task 031; re-shot for the
 * theme in task 055).
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots
 * ```
 *
 * It is a spec rather than a standalone script so it reuses the harness that already
 * exists (Postgres, the composed API, the admin dev server) and drives the real screens
 * rather than a mock of them - the gate is only worth anything if it shows what an
 * operator would see.
 *
 * ## The set: four screens, two viewports, three modes
 *
 * Task 055 names the four screens the theme has to be judged on - sign-in, the 2FA
 * challenge, the shell (Questions) and Settings - and requires each in Light, Dark and
 * High-contrast. Twenty-four frames, which is the smallest set that shows the theme's
 * three real risks: the translucent topbar, the auth card away from the shell, and the
 * high-contrast layer where the accent has to survive a two-colour palette.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. 390 is not because operators use
 * phones (they do not - see the project comment on `admin-chromium`) but because the
 * layout has to survive a narrow window, and the top bar's wrap is the thing to look at.
 *
 * The mode is set the way an operator's browser sets it - the `qcms-app-mode` cookie, read
 * by the root layout - rather than by poking the DOM, because a screenshot that did not go
 * through the real mechanism is evidence of nothing.
 *
 * The Next dev-tools indicator is removed before every capture. It is dev-server chrome,
 * not product UI, and leaving it in has twice put a floating badge in the corner of
 * evidence a human is asked to approve.
 */

const CAPTURE = process.env.QCMS_ADMIN_CAPTURE_GATE === "1";

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate");
const OUT_DIR = "docs/gates/055";
const WIDTHS = [390, 1280] as const;
const MODES = ["light", "dark", "hc"] as const;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/**
 * Wait until React has finished hydrating before touching the DOM.
 *
 * Not defensive padding: `hideDevChrome` below removes `nextjs-portal`, which is a
 * React-owned element, and doing that while hydration is still in flight made React report
 * a hydration mismatch on an unrelated input (`style={{caret-color:"transparent"}}` against
 * `style={undefined}`) - which the shared console gate correctly failed the run on. Waiting
 * removes the race rather than allowlisting its symptom.
 *
 * React tags every host node it owns with a `__reactFiber$...` property when it hydrates, so
 * the presence of one is the attachment signal itself rather than a proxy for it. Every
 * screen captured here renders at least one `<button>`, so that is the probe.
 */
async function waitForHydration(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector("button");
    if (button === null) return false;
    return Object.keys(button).some((key) => key.startsWith("__reactFiber$"));
  });
}

/**
 * Remove the Next dev-tools indicator. It lives in a custom element Next injects
 * (`nextjs-portal`) plus a couple of legacy ids, and it is only present under `next dev`,
 * so every selector here is expected to match nothing in a production build.
 */
async function hideDevChrome(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    for (const selector of ["nextjs-portal", "#__next-build-watcher", "[data-nextjs-toast]"]) {
      for (const element of Array.from(document.querySelectorAll(selector))) element.remove();
    }
  });
}

/** Capture one named state at both widths. */
async function capture(page: import("@playwright/test").Page, name: string): Promise<void> {
  await waitForHydration(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await hideDevChrome(page);
    await page.screenshot({ path: `${OUT_DIR}/${name}-${width}.png`, fullPage: true });
  }
  // Leave the page at the wide viewport so the next navigation starts from a known shape.
  await page.setViewportSize({ width: 1280, height: 800 });
}

test("enrolls the account the rest of the capture signs in with", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
});

for (const mode of MODES) {
  test(`captures the ${mode} set`, async ({ page }) => {
    // `url` rather than `domain` + `path`: Playwright takes one form or the other,
    // and the base URL is the one this project already knows.
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);

    await page.goto("/sign-in");
    await capture(page, `sign-in-${mode}`);

    await submitSignIn(page, EMAIL);
    await expect(page).toHaveURL(/\/two-factor\/challenge$/);
    await capture(page, `2fa-challenge-${mode}`);

    await submitTotp(page, totpSecret);
    await page.waitForURL(/\/questions$/);
    await capture(page, `shell-questions-${mode}`);

    await page.goto("/settings");
    await capture(page, `shell-settings-${mode}`);
  });
}
