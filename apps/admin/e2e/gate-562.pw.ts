import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * Screenshot evidence for issue 562's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-562.pw.ts
 * ```
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * Issue 559's shape, for issue 559's reason: a capture that wrote every frame inside a
 * single `test` made "re-shoot only what moved" inexpressible. Here every frame is its own
 * test named after the file it writes, so `--grep settings-1024` re-shoots exactly that one.
 *
 * ## What each frame is claiming, in contract terms
 *
 * The clause each one satisfies is recorded on the frame below and repeated in
 * `docs/gates/pr-562/README.md`, because the reviewing seat clears this gate against
 * `plan/admin-design-contracts.md` §7a rather than against a description of it.
 *
 * ## Why 1023 and 1024 are both here
 *
 * §1 gives the app two breakpoints and `--bp-sidebar` is the one this rail turns at. A
 * boundary is only shown by a pair: one frame of a collapsed rail proves nothing about where
 * it collapses. Issue 557's gate set that precedent and issue 559's kept it.
 *
 * ## Why two of the six carry a fragment in the URL
 *
 * §7a's summary clause and the active mark are both about the ACTIVE section, and this rail
 * has no active section until the URL names one (`components/settings-section-rail.tsx`
 * writes out why). A frame shot at `/settings` alone would show the rail's resting state and
 * none of the behaviour the clause is about, so `-shut` and `-active` each arrive by anchor.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-562";
const EMAIL = uniqueAdminEmail("gate562");

/** Set by `beforeAll`, which enrolls the account every frame is shot as. */
let totpSecret = "";

/** One frame: the width and height it is shot at, the fragment it arrives by, and whether
 * the rail is left shut. */
interface Frame {
  readonly width: number;
  readonly height: number;
  readonly fragment?: string;
  readonly shut?: boolean;
}

async function capture(page: Page, name: string, frame: Frame): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: frame.width, height: frame.height });
  await page.goto(`/settings${frame.fragment ?? ""}`);
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect(page.getByTestId("qcms-settings-rail")).toBeVisible();
  await waitForHydration(page);
  await hideDevChrome(page);

  if (frame.shut === true) {
    await page.locator("summary.qcms-rail__summary").click();
    await expect(page.locator("details.qcms-rail__disclosure")).not.toHaveAttribute("open", "");
    // The click leaves a focus ring on the summary, which is chrome the reviewer is not
    // being asked about. Blurring is the whole of the cleanup: nothing else moved.
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
  }

  // A full-page PNG is sized to the DOCUMENT, so a screen that scrolls sideways produces a
  // file wider than the width in its own name and misdescribes itself to a reviewer who
  // cannot measure a PNG in a GitHub diff.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect
    .soft(scrollWidth, `the ${name} frame fits its ${String(frame.width)}px viewport`)
    .toBeLessThanOrEqual(frame.width);

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

/** §7a collapsed: below `--bp-sidebar` the rail is a disclosure, here open, and its resting
 * summary names no section because the URL names none. */
test("settings-390", async ({ page }) => {
  await capture(page, "settings-390", { width: 390, height: 900 });
});

/** §7a's summary clause: shut, with the summary naming the active section. */
test("settings-390-shut", async ({ page }) => {
  await capture(page, "settings-390-shut", {
    width: 390,
    height: 900,
    fragment: "#two-factor",
    shut: true,
  });
});

/** §1 / §7a: one pixel below `--bp-sidebar`, still a disclosure and not a column. */
test("settings-1023", async ({ page }) => {
  await capture(page, "settings-1023", { width: 1023, height: 900 });
});

/** §1 / §7a: at `--bp-sidebar`, the 240px grid column, beside the content rather than over
 * it, with three section links and no divider, no count and no action. */
test("settings-1024", async ({ page }) => {
  await capture(page, "settings-1024", { width: 1024, height: 900 });
});

/** §7a at the Code Owner's standing wide width. The audit calls Settings the clearest reject
 * on width in the app, and the rail does not change that: the forms stay at `max-w-sm`. */
test("settings-1280", async ({ page }) => {
  await capture(page, "settings-1280", { width: 1280, height: 900 });
});

/** §7a's active mark: the row the URL names carries the accent edge and the heavier weight,
 * and no other row does. */
test("settings-1280-active", async ({ page }) => {
  await capture(page, "settings-1280-active", {
    width: 1280,
    height: 900,
    fragment: "#change-password",
  });
});
