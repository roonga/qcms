import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createRailFixture } from "./support/rail.js";

/**
 * Screenshot evidence for issue 559's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-559.pw.ts
 * ```
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * Issue 558's capture wrote all thirty of its frames inside a single `test`, which made
 * "re-shoot only what moved" inexpressible: the only way to replace two frames was to
 * shoot fifteen and keep two. Here every frame is its own test named after the file it
 * writes, so `--grep links-1024` re-shoots exactly that one. The fixture is built once in
 * `beforeAll` on a page of its own, which is what lets a single-frame run still have a form
 * to point at.
 *
 * ## What each frame is claiming, in contract terms
 *
 * The clause each one satisfies is recorded on the frame itself below and repeated in
 * `docs/gates/pr-559/README.md`, because the PM seat clears this gate against
 * `plan/admin-design-contracts.md` rather than against a description of it.
 *
 * ## Why 1023 and 1024 are both here
 *
 * §1 gives the app two breakpoints, and `--bp-sidebar` is the one this rail turns at. A
 * boundary is only shown by a pair, which is the precedent issue 557's gate set: one frame
 * of a collapsed rail proves nothing about where it collapses.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-559";
const EMAIL = uniqueAdminEmail("gate559");
const RUN = Date.now().toString(36);

/** Set by `beforeAll`, which builds the fixture the frames are shot against. */
let totpSecret = "";
let formId = "";

/** One frame: the width and height it is shot at, and whether the rail is left open. */
interface Frame {
  readonly width: number;
  readonly height: number;
  readonly shut?: boolean;
}

async function capture(page: Page, name: string, frame: Frame): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: frame.width, height: frame.height });
  await page.goto(`/forms/${formId}/links`);
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect(page.getByTestId("qcms-rail")).toBeVisible();
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
  formId = (await createRailFixture(page, RUN)).formId;
  await page.close();
});

/** §7 collapsed: below `--bp-sidebar` the rail is a disclosure, here shown open. */
test("links-390", async ({ page }) => {
  await capture(page, "links-390", { width: 390, height: 900 });
});

/** §7 collapsed, shut: the summary names the active item and truncates with an ellipsis. */
test("links-390-shut", async ({ page }) => {
  await capture(page, "links-390-shut", { width: 390, height: 900, shut: true });
});

/** §1 / §7: one pixel below `--bp-sidebar`, still a disclosure and not a column. */
test("links-1023", async ({ page }) => {
  await capture(page, "links-1023", { width: 1023, height: 900 });
});

/** §1 / §7: at `--bp-sidebar`, the 240px grid column, with both groups and the divider. */
test("links-1024", async ({ page }) => {
  await capture(page, "links-1024", { width: 1024, height: 900 });
});

/** §7 at the Code Owner's standing wide width, with the per-step issue badge visible. */
test("links-1280", async ({ page }) => {
  await capture(page, "links-1280", { width: 1280, height: 900 });
});

/** N2: at a viewport taller than the content, the rail's surface reaches the shell's foot. */
test("links-1280-tall", async ({ page }) => {
  await capture(page, "links-1280-tall", { width: 1280, height: 1600 });
});
