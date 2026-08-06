import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * Capture the `erase-confirm` frames for the task 059 human design gate.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-059
 * ```
 *
 * ## One state, not thirteen
 *
 * 059 changes exactly one photographed surface: the erase dialog's third ADR-17 fact
 * moves from 035's pre-059 statement ("an event still waiting to be delivered is not
 * withdrawn: it may still be sent") to the post-059 one (delivered events stay
 * delivered and are the consumer's to handle; undelivered ones are cancelled and never
 * sent; QCMS's own stored copy is redacted). Every other frame in `docs/gates/035/` is
 * unchanged, so re-shooting the whole set would hand the Code Owner 78 images to
 * re-judge for one sentence. This spec shoots the one that moved, into
 * `docs/gates/059/`, and the README there names the diff.
 *
 * The delivery dashboard gains a `cancelled` badge in the same task, but reaching that
 * state in a capture needs a submit, an endpoint, eleven delivery passes and an erasure
 * per mode - the whole 035 arc - to photograph one tag. It is asserted instead, in
 * `responses-ops.pw.ts` step 8, on the real row with its real reason.
 *
 * Frames are named `<state>-<mode>-<viewport>`, matching 033, 034 and 035. 390px and
 * 1280px per the Code Owner's 2026-07-25 rule; the mode comes from the real
 * `qcms-app-mode` cookie rather than from poking the DOM.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate059");
const capture = captureInto("docs/gates/059");

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the capture signs in with", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret.length, "the enrollment produced a TOTP secret").toBeGreaterThan(0);
});

for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} erase-confirm frame`, async ({ page }) => {
    test.setTimeout(240_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    // Each mode erases a response, so each mode needs its own: three runs over one
    // would find the second and third already erased and photograph the tombstone.
    const erasable = await submitResponse(SLUG, [
      [ACCIDENT, true],
      [COUNT, 2],
    ]);

    await page.goto(`/forms/${FORM_ID}/responses/${erasable}`);
    await page.getByRole("button", { name: "Erase respondent data…" }).click();
    const erase = page.getByTestId("qcms-erase-dialog");
    await expect(erase).toBeVisible();

    // Copy is BAKED into a committed PNG, so the capture refuses to shoot the screen
    // unless the new sentence is on it. 035 learned this the expensive way: a frame
    // that photographs stale copy costs a re-shoot and a second gate round, and the
    // whole reason this task exists is that the previous sentence was true only
    // because erasure did not reach far enough.
    await expect(erase).toContainText("An event already delivered stays delivered");
    await expect(erase).toContainText("is cancelled and will never be sent");
    await expect(erase).toContainText("QCMS's own stored copy of the answers");

    // The id typed in, so the enabled state of the destructive button is what is
    // signed off rather than the inert one.
    await erase.getByRole("textbox", { name: /Type the session id/ }).fill(erasable);
    await expect(page.getByRole("button", { name: "Erase permanently" })).toBeEnabled();
    await capture(page, `erase-confirm-${mode}`);
  });
}
