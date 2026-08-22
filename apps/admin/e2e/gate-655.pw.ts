import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * Screenshot evidence for issue 655's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-655.pw.ts
 * ```
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * Issue 559's shape, for issue 559's reason: a capture that wrote every frame inside a single
 * `test` made "re-shoot only what moved" inexpressible. Here every frame is its own test named
 * after the file it writes, so `--grep settings-1280-password` re-shoots exactly that one.
 *
 * ## Why six frames, and why one per panel
 *
 * The change this gate is about is a SWITCH, and a switch cannot be shown by one frame of one
 * state. Each of the three sections is shot at both widths, so a reviewer can see that exactly
 * one panel is on screen, that the heading names it, that the rail row for it is the marked
 * one, and that the other two sections are genuinely gone rather than below the fold.
 *
 * This gate supersedes issue 562's for this screen: that one photographed the stacked design
 * and its `:target` mark, neither of which exists any more. Its frames stay in
 * `docs/gates/pr-562/` as the record of what was there before.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-655";
const EMAIL = uniqueAdminEmail("gate655");

/** Set by `beforeAll`, which enrolls the account every frame is shot as. */
let totpSecret = "";

/** One frame: the width it is shot at, and the rail row pressed before the shutter. */
interface Frame {
  readonly width: number;
  readonly height: number;
  /** The rail row to press. Omitted for Account, which is the panel the screen opens on. */
  readonly row?: string;
}

async function capture(page: Page, name: string, frame: Frame): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: frame.width, height: frame.height });
  await page.goto("/settings");
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect(page.getByTestId("qcms-settings-rail")).toBeVisible();
  await waitForHydration(page);
  await hideDevChrome(page);

  if (frame.row !== undefined) {
    // Scoped to the rail: the password panel's submit button carries the same name as its
    // rail row, correctly, and an unscoped query would be ambiguous once that panel is up.
    await page
      .getByTestId("qcms-settings-rail")
      .getByRole("button", { name: frame.row, exact: true })
      .click();
    await expect(
      page.getByTestId("qcms-settings-rail").getByRole("button", { name: frame.row, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    // The press leaves a focus ring on the row, which is chrome the reviewer is not being
    // asked about. Blurring is the whole of the cleanup: nothing else moved.
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

/** The panel the screen opens on, at the narrow width where the rail is a disclosure above it. */
test("settings-390-account", async ({ page }) => {
  await capture(page, "settings-390-account", { width: 390, height: 900 });
});

/** The switch at 390: the password panel up, the account line gone, the heading renamed. */
test("settings-390-password", async ({ page }) => {
  await capture(page, "settings-390-password", {
    width: 390,
    height: 900,
    row: "Change password",
  });
});

/** The third surface at 390, which is the longest of the three and the reason they separated. */
test("settings-390-twofactor", async ({ page }) => {
  await capture(page, "settings-390-twofactor", {
    width: 390,
    height: 900,
    row: "Two-factor authentication",
  });
});

/** Account at the Code Owner's standing wide width: the 240px track, and the 40rem column
 * left-anchored against it rather than centred in the viewport. */
test("settings-1280-account", async ({ page }) => {
  await capture(page, "settings-1280-account", { width: 1280, height: 900 });
});

/** The switch at 1280, with the marked row and the renamed heading both in frame. */
test("settings-1280-password", async ({ page }) => {
  await capture(page, "settings-1280-password", {
    width: 1280,
    height: 900,
    row: "Change password",
  });
});

/** Two-factor at 1280, the panel that used to sit two screens down the same scroll. */
test("settings-1280-twofactor", async ({ page }) => {
  await capture(page, "settings-1280-twofactor", {
    width: 1280,
    height: 900,
    row: "Two-factor authentication",
  });
});
