import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  deactivateExistingWebhooks,
  deadUrl,
  openDeliverer,
  submitResponse,
} from "./support/ops.js";

/**
 * Capture the screenshot set for the task 035 human design gate.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-035
 * ```
 *
 * ## The set: thirteen states, two viewports, three modes
 *
 * The wireframe's States inventory, minus the two this build cannot reach and plus the
 * detail states the Regions inventory names. In order: the response browser, a
 * filtered-empty result, a response detail with its ledger, the export dialog, the
 * type-to-confirm erasure, the tombstone that replaces the response, the erasure log,
 * webhook config with nothing configured, the one-time secret reveal, the endpoints
 * table, the delivery dashboard with a delivery detail open, and the dead-letter queue
 * with a redelivery reported.
 *
 * Two of the wireframe's states are deliberately absent and `docs/gates/035/README.md`
 * says so rather than leaving a reviewer to notice: **"no responses"** (a form that has
 * collected nothing renders the same component as filtered-empty with one different
 * sentence, and reaching it needs a second form authored purely for the frame) and
 * **"flagged present"** (a flagged submission requires the honeypot or minimum-time
 * path, which is 020/026's surface and not reachable from these routes).
 *
 * Frames are named `<state>-<mode>-<viewport>`, matching 033 and 034. State first is
 * what makes a directory listing group by the thing a reviewer is judging rather than
 * by the colour it is judged in.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule; the mode comes from the real
 * `qcms-app-mode` cookie rather than from poking the DOM. Everything else - hydration
 * waits, dev-chrome suppression, the caret fix and the reflow guard - lives in
 * `support/capture.ts`.
 *
 * ## Each mode gets its own form
 *
 * Three runs over one form would show the second and third modes a dead-letter queue
 * the first had already emptied, and a response the first had already erased. Each mode
 * therefore submits its own responses and configures its own endpoint, which is also
 * why this file drives the deliverer itself rather than sharing one with the arc spec.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate035");
const capture = captureInto("docs/gates/035");

const SLUG = "auto";
const FORM_ID = "frm_auto_quote";
/** A seeded form that never gets an endpoint, so its "none" state stays real. */
const EMPTY_FORM_ID = "frm_kitchen_sink";
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
  test(`captures the ${mode} set`, async ({ page }) => {
    test.setTimeout(420_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    // No live consumer: every frame here wants the FAILURE record on screen (a
    // dead-lettered delivery, a queue with something in it), so the endpoint points at
    // a dead port throughout. The delivered path is the arc spec's job.
    const deliverer = openDeliverer();
    try {
      // Two responses: one to browse and erase, one to leave standing so the list is
      // never empty in the frames that follow the erasure.
      const erasable = await submitResponse(SLUG, [
        [ACCIDENT, true],
        [COUNT, 2],
      ]);
      await submitResponse(SLUG, [[ACCIDENT, false]]);

      // 1. The browser.
      await page.goto(`/forms/${FORM_ID}/responses`);
      await expect(page.getByTestId("qcms-responses-table")).toBeVisible();
      await capture(page, `responses-browser-${mode}`);

      // 2. Filtered-empty: a real filter that matches nothing, not an empty form.
      await page.goto(`/forms/${FORM_ID}/responses?from=2020-01-01&to=2020-01-02`);
      await expect(page.getByTestId("qcms-responses-empty")).toBeVisible();
      await capture(page, `responses-filtered-empty-${mode}`);

      // 3. The detail, with the locked answers and the ledger timeline.
      await page.goto(`/forms/${FORM_ID}/responses/${erasable}`);
      await expect(page.getByTestId("qcms-ledger")).toBeVisible();
      await capture(page, `response-detail-${mode}`);

      // 4. The export dialog, on the state a reviewer has to judge: CSV chosen, no
      //    version yet, so the hint is showing and the download is inert.
      await page.goto(`/forms/${FORM_ID}/responses`);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByTestId("qcms-export-dialog")).toBeVisible();
      await capture(page, `export-dialog-${mode}`);
      await page.keyboard.press("Escape");

      // 5. The erasure confirmation, with the session id typed so the enabled state of
      //    the destructive button is what the Code Owner is signing off.
      await page.goto(`/forms/${FORM_ID}/responses/${erasable}`);
      await page.getByRole("button", { name: "Erase respondent data…" }).click();
      const erase = page.getByTestId("qcms-erase-dialog");
      await expect(erase).toBeVisible();
      await erase.getByRole("textbox", { name: /Type the session id/ }).fill(erasable);
      await expect(page.getByRole("button", { name: "Erase permanently" })).toBeEnabled();
      await capture(page, `erase-confirm-${mode}`);

      // 6. The tombstone that replaces it.
      await page.getByRole("button", { name: "Erase permanently" }).click();
      await expect(page.getByTestId("qcms-tombstone")).toBeVisible({ timeout: 30_000 });
      await capture(page, `tombstone-${mode}`);

      // 7. The erasure log, now with a row in it.
      await page.goto("/responses/erasures");
      await expect(page.getByTestId("qcms-erasures-table")).toBeVisible();
      await capture(page, `erasure-log-${mode}`);

      // 8. Webhook config with nothing configured - shot on a DIFFERENT seeded form,
      //    and that is the honest way to get this frame. Every mode configures an
      //    endpoint on the insurance form below, so by the second mode that form's
      //    "none" state no longer exists, and a frame captured there would be labelled
      //    `webhooks-none` while showing an endpoint. The kitchen-sink form is seeded
      //    and never given one, so this state is real in all three modes.
      await page.goto(`/forms/${EMPTY_FORM_ID}/webhooks`);
      await expect(page.getByTestId("qcms-webhooks-empty")).toBeVisible();
      // Copy is BAKED into a committed PNG, so a capture run is the last place a wrong
      // sentence can still be caught cheaply: after this, fixing one word costs a
      // re-shoot and, if the Code Owner has already signed, a second gate round. This
      // claim in particular shipped wrong once - it promised consumers "every
      // submission" while the submit slice withholds a flagged one - so the capture now
      // refuses to photograph the screen unless the corrected sentence is on it.
      await expect(page.getByTestId("qcms-webhook-config")).toContainText(
        "withheld until an operator releases it",
      );
      await capture(page, `webhooks-none-${mode}`);

      // From here on, the insurance form, with any endpoint an earlier mode left behind
      // deactivated so the fan-out below is exactly one endpoint wide.
      await deactivateExistingWebhooks(page, FORM_ID);

      // 9. The one-time secret reveal. The endpoint points at a dead port, which is
      //    also what sets up the dead-letter frames below.
      await page.getByRole("button", { name: "Add endpoint" }).click();
      const create = page.getByTestId("qcms-webhook-url-dialog");
      await create.getByRole("textbox", { name: "Endpoint URL" }).fill(await deadUrl());
      await create.getByRole("button", { name: "Create endpoint" }).click();
      await expect(page.getByTestId("qcms-webhook-secret")).toBeVisible({ timeout: 30_000 });
      await maskSecret(page);
      await capture(page, `secret-reveal-${mode}`);

      // 10. The endpoints table, secrets masked.
      await page.getByRole("button", { name: "I have copied it" }).click();
      await expect(page.getByTestId("qcms-webhooks-table")).toBeVisible();
      await capture(page, `webhooks-table-${mode}`);

      // 11. The delivery dashboard with one delivery's detail open. Driven to
      //     dead-letter first, so the frame shows a real failure record rather than a
      //     row that has never been attempted.
      await submitResponse(SLUG, [[ACCIDENT, false]]);
      await deliverer.drive(11);
      await page.goto(`/forms/${FORM_ID}/webhooks`);
      await expect(page.getByTestId("qcms-deliveries-table")).toBeVisible();
      await page
        .getByRole("button", { name: /^Show request and response/ })
        .first()
        .click();
      await expect(page.getByTestId("qcms-delivery-detail")).toBeVisible();
      await capture(page, `delivery-detail-${mode}`);

      // 12. The dead-letter queue, and the same queue after a redelivery is reported.
      await page.goto("/webhooks");
      await expect(page.getByTestId("qcms-dead-letters-table")).toBeVisible();
      await capture(page, `dead-letters-${mode}`);

      // The exclusion below used to be load bearing: before task 059 an erased
      // session's event stayed queued, pressing its button was correctly refused
      // (ADR-17), and a capture that clicked it photographed the refusal instead of the
      // success this frame is for. Since 059 erasure cancels those deliveries and the
      // queue excludes cancelled rows, so the set is normally empty. It is computed
      // rather than deleted because "empty" is a consequence of the current code, not a
      // guarantee of the fixture ordering, and a capture that silently shoots the wrong
      // state is the worst thing a gate can do.
      const erased = await deliverer.erasedDeliveries();
      const exclusion = erased
        .map((row) => `:not([data-delivery-id="${row.deliveryId}"])`)
        .join("");
      await page
        .getByTestId("qcms-dead-letters-table")
        .locator(`tr[data-delivery-id]${exclusion}`)
        .first()
        .getByRole("button", { name: /^Redeliver response\.submitted to / })
        .click();
      await expect(page.getByTestId("qcms-redeliver-summary")).toBeVisible();
      await capture(page, `redeliver-queued-${mode}`);
    } finally {
      await deliverer.close();
    }
  });
}

/**
 * Replace the revealed secret with a placeholder before the frame is shot.
 *
 * The gate frames are committed to the repository and embedded in a PR body, so
 * whatever is on screen when the shutter goes is published. These secrets are minted
 * against an ephemeral Testcontainers database for endpoints on dead loopback ports,
 * so none of them has ever authenticated anything - but "the credential in the
 * committed image was worthless" is a property of how this spec happens to be wired
 * today, not a protection, and the next person to re-shoot this set should not have to
 * re-derive it. Masking makes it structural.
 *
 * A direct DOM mutation rather than a prop: React owns this node, and the shot is
 * taken immediately after with no state change in between, so there is no re-render to
 * restore the real value. Deliberately NOT done by hiding the element - the frame's
 * whole subject is that a secret is shown exactly once, and an empty box would not show
 * that.
 */
async function maskSecret(page: Page): Promise<void> {
  const masked = "whsec_EXAMPLE_VALUE_NOT_A_REAL_SECRET";
  await page.getByTestId("qcms-webhook-secret-value").evaluate((node, value) => {
    node.textContent = value;
  }, masked);
  await expect(page.getByTestId("qcms-webhook-secret-value")).toHaveText(masked);
}
