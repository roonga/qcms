import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";

/**
 * Screenshot evidence for issue 685's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-685.pw.ts
 * ```
 *
 * ## What is being looked at
 *
 * The change is what the forms list looks like when it is ONLY a list. That is not a claim
 * a test can make: no assertion says "the table is the first thing on the screen now", and
 * the acceptance criteria this issue was written from could not have caught it either. A
 * frame is the only artefact that shows a screen as a screen, so the pair that matters
 * most here is `forms-list-*` - the same route, with the create card gone.
 *
 * The other pair is the screen the card became. The typed frame is deliberate rather than
 * decorative: the id callout is the R6 statement this whole issue turns on, and it says
 * nothing until a slug is in the box.
 *
 * ## One frame per `test`
 *
 * `gate-559.pw.ts`'s shape, for its reason: a re-shoot of one frame should be one frame,
 * which is inexpressible when a single test writes the whole set.
 *
 * ## The state this gate cannot shoot
 *
 * The empty library, which is where the panel's new CTA renders. The seeded fixture always
 * has a form in it and nothing a browser can do removes one (no delete exists anywhere,
 * R6), so that state is evidenced at the layer that can reach it,
 * `app/(shell)/forms-create-route.test.tsx`, and is named in the README beside these
 * frames rather than left as a gap a reviewer has to notice.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-685";
const EMAIL = uniqueAdminEmail("gate685");

/** Set by `beforeAll`, which enrols the admin these frames are shot as. */
let totpSecret = "";

/** The Code Owner's standing pair. */
const WIDTHS = { narrow: 390, wide: 1280 } as const;

/**
 * Shoot one frame, after asserting the screen is the one being claimed.
 *
 * The overflow check is `gate-559.pw.ts`'s and is restated for its reason: a full-page PNG
 * is sized to the DOCUMENT, so a screen that scrolls sideways writes a file wider than the
 * width in its own name and misdescribes itself to a reviewer who cannot measure a PNG in
 * a GitHub diff.
 */
async function shoot(page: Page, name: string, width: number): Promise<void> {
  await waitForHydration(page);
  await hideDevChrome(page);

  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect
    .soft(scrollWidth, `the ${name} frame fits its ${String(width)}px viewport`)
    .toBeLessThanOrEqual(width);

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

/** Open the form library and assert it is a list with no creating form on it. */
async function openList(page: Page, width: number): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/forms");
  await expect(page.getByRole("table", { name: "Form library" })).toBeVisible();
  // The claim of the frame, asserted before the shutter rather than left to the eye: the
  // fields that used to sit above this table are not on this screen at all.
  await expect(page.getByRole("textbox", { name: "Slug", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "New form", exact: true })).toBeVisible();
}

/** Open the creating route and assert its three fields are there. */
async function openNewForm(page: Page, width: number): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/forms/new");
  await expect(page.getByRole("heading", { level: 1, name: "New form" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Slug", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Default locale", exact: true })).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

/** The list at 390, with nothing above the table but its heading and the New form link. */
test("forms-list-390", async ({ page }) => {
  await openList(page, WIDTHS.narrow);
  await shoot(page, "forms-list-390", WIDTHS.narrow);
});

/** The same at 1280: the point of the change is the screen when it is only a list. */
test("forms-list-1280", async ({ page }) => {
  await openList(page, WIDTHS.wide);
  await shoot(page, "forms-list-1280", WIDTHS.wide);
});

/** The creating route at 390, empty, with the callout prompting for a slug. */
test("new-form-390", async ({ page }) => {
  await openNewForm(page, WIDTHS.narrow);
  await shoot(page, "new-form-390", WIDTHS.narrow);
});

/** The creating route at 1280, empty. Its column takes the 40rem its model takes. */
test("new-form-1280", async ({ page }) => {
  await openNewForm(page, WIDTHS.wide);
  await shoot(page, "new-form-1280", WIDTHS.wide);
});

/**
 * The one-way door, open. With a slug typed the callout shows the `frm_` id that slug will
 * mint and the sentence saying it is permanent, which is the R6 argument the POC made for
 * giving this a screen of its own.
 */
test("new-form-1280-typed", async ({ page }) => {
  await openNewForm(page, WIDTHS.wide);
  await fillStable(page.getByRole("textbox", { name: "Slug", exact: true }), "vehicle-insurance");
  await expect(page.locator(".qcms-id-callout__value")).toHaveText("frm_vehicle_insurance");
  await shoot(page, "new-form-1280-typed", WIDTHS.wide);
});
