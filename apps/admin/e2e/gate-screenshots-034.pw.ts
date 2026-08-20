import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  addRule,
  addStep,
  chooseOption,
  createForm,
  pinQuestion,
  rule,
  savedStamp,
  toggleTarget,
  waitForSaveAfter,
  waitForSaved,
} from "./support/forms.js";
import { confirmLifecycle, createDraft, fillDate, optionIds } from "./support/questions.js";

/**
 * Capture the screenshot set for the task 034 human design gate.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-034
 * ```
 *
 * ## The set: eight states, two viewports, three modes
 *
 * The publish confirmation (the R1 teaching surface), a refused publish's anchored work
 * list, the live preview before and after a branch reveals, the version history with its
 * stamps, one published version rendered from storage, the secure-link screen, and the
 * one-time minted-URL panel. Those are the eight moments the wireframe's Regions and States
 * inventories name, and each is a state that does not exist on first render - which is why
 * they are driven through the UI rather than deep-linked.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule; the mode comes from the real
 * `qcms-app-mode` cookie rather than from poking the DOM. Everything else - hydration waits,
 * dev-chrome suppression, the caret fix and the reflow guard - lives in `support/capture.ts`.
 *
 * Short id tails, for the reason `gate-screenshots-033.pw.ts` records at length: a full
 * base36 timestamp mints ids longer than anything in the repo and pushes the cards past a
 * 390px viewport, which `captureInto` now refuses to shoot.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate034");
const capture = captureInto("docs/gates/034");
const TAIL = Date.now().toString(36).slice(-5);

const ACCIDENT = `at-fault-${TAIL}`;
const COUNT = `acc-count-${TAIL}`;

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";
/** Read off the published question rather than guessed. */
let accidentOption = "";

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors the questions the captured form pins", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createDraft(page, ACCIDENT, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  accidentOption = (await optionIds(page))[0] ?? "";
  expect(accidentOption).toMatch(/^opt_/u);

  await createDraft(page, COUNT, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
});

for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} set`, async ({ page }) => {
    test.setTimeout(420_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    const formId = await createForm(page, `vehicle-ins-${mode}-${TAIL}`, "Vehicle insurance");
    await addStep(page, "Driving history");
    await pinQuestion(page, questionIdFor(ACCIDENT), 1);
    await pinQuestion(page, questionIdFor(COUNT), 1);

    // The rule the preview walks: within one step, so the reveal is visible beside the
    // question that caused it (the wireframe's sketch).
    const ruleId = await addRule(page);
    const scope = rule(page, ruleId);
    await chooseOption(scope, "Operator", "equals (the whole answer)");
    await chooseOption(scope, "Value", accidentOption);
    await toggleTarget(page, ruleId, questionIdFor(COUNT), true);
    await waitForSaved(page);

    // --- a refused publish, first: it needs the draft to be broken ----------
    // Publish reads the STORED draft, so the wait has to be about the save rather than
    // about the panel: see `waitForSaveAfter`.
    const beforeBreak = await savedStamp(page);
    await toggleTarget(page, ruleId, questionIdFor(ACCIDENT), true);
    await waitForSaveAfter(page, beforeBreak);
    await page.reload();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Publish v/ })
      .click();
    await expect(page.getByTestId("qcms-publish-rejected")).toBeVisible({ timeout: 30_000 });
    await capture(page, `publish-rejected-${mode}`);

    // --- and then the confirmation over a draft that will publish ----------
    const beforeFix = await savedStamp(page);
    await toggleTarget(page, ruleId, questionIdFor(ACCIDENT), false);
    await waitForSaveAfter(page, beforeFix);
    await page.reload();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await capture(page, `publish-confirm-${mode}`);

    await page.getByRole("alertdialog").getByRole("button", { name: "Publish v1" }).click();
    await expect(page.getByText("Published as v1.")).toBeVisible({ timeout: 30_000 });
    await capture(page, `publish-success-${mode}`);

    // --- the live preview, before and after the branch ---------------------
    await page.goto(`/forms/${formId}/preview`);
    const preview = page.getByTestId("qcms-draft-preview");
    await expect(preview.getByText("E2E Single choice question")).toBeVisible({ timeout: 60_000 });
    await capture(page, `preview-${mode}`);

    await preview.getByText("Yes, always", { exact: true }).click();
    await expect(preview.getByText("E2E Number question")).toBeVisible({ timeout: 30_000 });
    await capture(page, `preview-branch-${mode}`);

    // --- history, and one frozen version -----------------------------------
    await page.goto(`/forms/${formId}/versions`);
    await expect(page.getByRole("grid", { name: "Published versions" })).toBeVisible();
    await capture(page, `version-history-${mode}`);

    await page.getByRole("link", { name: "View v1" }).click();
    await expect(page.getByTestId("qcms-version-view")).toBeVisible({ timeout: 60_000 });
    await capture(page, `version-view-${mode}`);

    // --- secure links, empty and just minted -------------------------------
    await page.goto(`/forms/${formId}/links`);
    await expect(page.getByTestId("qcms-links-empty")).toBeVisible();
    await capture(page, `links-empty-${mode}`);

    await page.getByRole("button", { name: "Mint links" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await fillDate(page, "Expires", "12312030");
    await capture(page, `links-mint-${mode}`);

    await page.getByRole("dialog").getByRole("button", { name: "Mint", exact: true }).click();
    await expect(page.getByTestId("qcms-minted-links")).toBeVisible({ timeout: 30_000 });
    await capture(page, `links-minted-${mode}`);

    // The revoked chip. Across the rest of this set and the whole axe sweep the only link
    // state ever drawn is Active, so a reviewer would be signing off a four-state chip
    // having seen one of them - and this gate is the admin's primary visual accessibility
    // evidence while 030's manual pass waits behind the 033-035 chain. Consumed and Expired
    // need a respondent session and a clock this suite does not have; they are recorded as
    // a gap rather than faked here.
    await page.getByTestId("qcms-minted-links").getByRole("button", { name: "Done" }).click();
    await page
      .getByTestId("qcms-links-table")
      .getByRole("button", { name: "Revoke" })
      .first()
      .click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revoke it" }).click();
    await expect(page.getByText("That link is revoked.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("qcms-links-table").getByText("Revoked")).toBeVisible();
    await capture(page, `links-revoked-${mode}`);
  });
}
