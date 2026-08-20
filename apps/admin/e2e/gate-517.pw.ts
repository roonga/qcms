import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, captureInto } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import {
  addStep,
  createForm,
  openStep,
  pinGrip,
  pinLabel,
  pinQuestion,
  waitForSaved,
} from "./support/forms.js";

/**
 * Screenshot evidence for issue 517's design gate: the pin list as the ownership grid.
 *
 * What a reviewer has to judge here is one thing, and every frame is arranged to make it
 * judgeable at a glance:
 *
 * > **Can you tell, without being told, which of these values you can change here?**
 *
 * `plan/admin-ux-audit.md` §8 item 5 calls this the highest-value design change in the
 * redesign because the pin list is the app's one genuinely mixed-ownership table. The
 * form owns a pin's position and its version and both are editable here; the question
 * library owns the id, the label and the type and none of them can be touched from a
 * form. If the finished grid does not make that legible, it has missed, and no amount of
 * passing tests fixes it.
 *
 * `docs/gates/pr-517/README.md` names the contract clause each frame carries.
 *
 * ## The frame at 390 is the important one
 *
 * `plan/admin-mobile-stance.md` puts reorder, remove and "change a question's version
 * pin" on the supported-at-390 path, so the narrow frames are where the design is under
 * real pressure: Type and Issues are gone, Version is not, and the row's one control has
 * to still be findable on a screen that has no hover at all.
 *
 * ## Loaded at width rather than resized into it
 *
 * `captureInto` resizes a live page, and issue #575 records a container-query screen
 * being photographed before it settled. The pin list keys its drops off a media query
 * rather than a container query and would reflow either way, but the builder is
 * navigated to at 390 first, so the 390 frame is a fresh load at 390 and the question
 * does not arise. The 1280 frame is the same document at the wider viewport, which media
 * queries re-evaluate synchronously.
 *
 * ## Modes
 *
 * The full set in light, and the populated grid again in dark and high contrast. The
 * three colours the change introduces are the version control's `--color-border-strong`
 * edge, the row's `--color-danger` error flag and the grip's `--color-ghost-hover`, and
 * every one of them is an existing token that all three mode layers define; what is
 * genuinely worth three passes is the ownership contrast itself, which is carried by the
 * populated frame.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. Skipped unless
 * `QCMS_ADMIN_CAPTURE_GATE=1`, because it writes into a committed directory.
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-517
 * ```
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate517");
const capture = captureInto("docs/gates/pr-517");
const TAIL = Date.now().toString(36).slice(-5);

const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";
const DOB = "q_dob";

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";
/** The builder URL of the form the capture photographs, built once. */
let builderUrl = "";

async function useMode(page: Page, mode: string): Promise<void> {
  await page
    .context()
    .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
  await signInWithTotp(page, EMAIL, totpSecret);
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account and builds the step the capture photographs", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createForm(page, `pin-grid-${TAIL}`, "Vehicle insurance");
  await addStep(page, "Driving history");
  await pinQuestion(page, ACCIDENT, 1);
  await pinQuestion(page, COUNT, 1);
  await pinQuestion(page, DOB, 1);
  await waitForSaved(page);
  builderUrl = new URL(page.url()).pathname;
  expect(builderUrl, "the builder owns the URL").toMatch(/^\/forms\/frm_/u);
});

for (const mode of ["light", "dark", "hc"] as const) {
  test(`captures the ${mode} pin grid`, async ({ page }) => {
    test.setTimeout(300_000);
    // At 390 before the navigation, so the narrow frame is a fresh load at 390.
    await page.setViewportSize({ width: 390, height: 844 });
    await useMode(page, mode);
    await page.goto(builderUrl);
    await openStep(page, "Driving history");
    await expect(pinLabel(page, ACCIDENT, 1)).toBeVisible();

    // 1. The grid at rest. Contract §2's family (44px rows, 0.72rem header over the
    //    strong-border underline, no zebra) carrying design-language element 4: the two
    //    form-owned cells have an edge, the three library-owned ones are text.
    await capture(page, `pin-grid-${mode}`);

    if (mode !== "light") return;

    // 2. Element 5, open. The row's one control, and the five entries that make the
    //    row-boundary insert legal under SC 2.5.8 and reorder reachable with one
    //    pointer under SC 2.5.7.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(builderUrl);
    await openStep(page, "Driving history");
    await pinGrip(page, COUNT).click();
    await expect(page.getByRole("menu", { name: `Row actions for ${COUNT}` })).toBeVisible();
    await capture(page, "pin-grid-row-menu");

    // 3. The one version change the builder has (R7), open at the width the mobile
    //    stance keeps it operable at.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(builderUrl);
    await openStep(page, "Driving history");
    await page.getByRole("button", { name: `Move pin for ${ACCIDENT}` }).click();
    await expect(page.getByRole("menuitem", { name: "Move to v2", exact: true })).toBeVisible();
    await capture(page, "pin-grid-version-menu");

    // 4. The empty step: contract §3's one panel, CTA-less because the creating action
    //    is the library button on the same screen (the §3 amendment of 2026-08-20).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(builderUrl);
    await addStep(page, "Empty step");
    await openStep(page, "Empty step");
    await expect(page.getByTestId("qcms-step-empty")).toBeVisible();
    await capture(page, "pin-grid-empty-step");
  });
}
