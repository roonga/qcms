import { expect, test } from "../../portal/e2e/support/gates.js";

import { ADMIN_BASE_URL } from "./support/harness-config.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { addOption, createDraft, field, grip, pendingRow } from "./support/questions.js";

/**
 * Capture the screenshot set for the task 057 human design gate.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-057
 * ```
 *
 * ## The set: the card's states, at two widths, in three modes
 *
 * Exit criterion 1 names them, and each is a state the frozen card
 * `plan/admin-theme/ds-option-grid.html` draws and the reviewer is being asked to compare
 * against:
 *
 * 1. `grid-rest` - the grid at rest, including a genuinely long label wrapping across
 *    lines rather than truncating (the card's own rule: the editor must never show less
 *    of a label than the respondent will see).
 * 2. `grid-row-focus` - a row's controls revealed. The card reveals the grip and the
 *    insert point on hover **or focus**, and focus is the half that has to work without a
 *    pointer, so it is the half captured: hover cannot be held across a viewport change.
 * 3. `grid-editing` - a cell in its editing state, with the focus ring and surface fill
 *    that separate "being edited" from "table text at rest".
 * 4. `grid-menu` - the row menu open on the grip, carrying Insert above, Insert below and
 *    Remove option. This is where remove lives under the card, and it is the discrepancy
 *    against the task file most worth a reviewer's eye.
 * 5. `grid-ghost` - the ghost add-row opened and not yet named. This is the frame that
 *    shows the Code Owner's minting ruling on screen: the row exists, and its ID cell says
 *    the id is still pending because nothing has been minted for it.
 * 6. `grid-error` - a row whose label has been cleared, showing the cell error treatment
 *    and the message line below the grid.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. The narrow frame carries its own
 * question here: at that width the ID column folds into a second line inside the label
 * cell, so 390 is not merely a smaller copy of 1280, it is the other layout the card
 * specifies. All three modes, because high contrast changes the grid's behaviour rather
 * than only its palette - it drops the hover-only reveal and shows every grip and insert
 * point at rest.
 *
 * Everything else (hydration waiting, dev-chrome suppression, the 1.4.10 overflow refusal,
 * and Playwright's caret trap from issue #220) lives in `support/capture.ts`.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate057");
const capture = captureInto("docs/gates/057");

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";
/** The choice question whose option grid every frame is taken of. */
let questionId = "";

/** A label long enough to wrap at both widths, which is the card's no-truncation rule. */
const LONG_LABEL =
  "I have read the policy above and agree to the processing of my information for the purposes it describes";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

// The question is authored inside the FIRST capture pass rather than in a test of its own:
// every pass needs the same four rows, and authoring them once and re-signing-in for the
// other two modes is two sign-ins cheaper than a separate setup test would be.
for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} set`, async ({ page }) => {
    test.setTimeout(300_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);

    if (totpSecret === "") {
      totpSecret = await enrollNewAdmin(page, EMAIL);
      await createDraft(page, `gate057-cover-${Date.now().toString(36)}`, "Single choice");
      await addOption(page, "Roadside assistance");
      await addOption(page, LONG_LABEL);
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page.getByText("Draft saved.")).toBeVisible();
      questionId = new URL(page.url()).pathname.split("/").pop() ?? "";
      expect(questionId, "the created draft should own the URL").toMatch(/^q_/u);
    } else {
      await signInWithTotp(page, EMAIL, totpSecret);
    }

    // FRAME 1: at rest. Four rows, the last of them wrapping.
    await page.goto(`/questions/${questionId}`);
    await expect(field(page, "Option 4 label")).toHaveValue(LONG_LABEL);
    await capture(page, `grid-rest-${mode}`);

    // FRAME 2: a row's controls revealed by FOCUS, with no pointer involved.
    await page.locator('[data-option-index="1"] .qcms-opt-insert').first().focus();
    await expect(page.locator('[data-option-index="1"] .qcms-opt-insert').first()).toBeVisible();
    await capture(page, `grid-row-focus-${mode}`);

    // FRAME 3: a cell being edited.
    await field(page, "Option 2 label").focus();
    await capture(page, `grid-editing-${mode}`);

    // FRAME 4: the row menu, which is where insert-by-keyboard and remove live.
    await grip(page, 0).focus();
    await grip(page, 0).press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await capture(page, `grid-menu-${mode}`);
    await page.getByRole("menu").press("Escape");

    // FRAME 5: the ghost add-row opened and unnamed - a row with no option id yet.
    await page.getByRole("button", { name: "Add option" }).click();
    await expect(pendingRow(page)).toBeFocused();
    await capture(page, `grid-ghost-${mode}`);
    await pendingRow(page).blur();
    await expect(pendingRow(page)).toHaveCount(0);

    // FRAME 6: the error treatment. Clearing a committed label is the only way to reach a
    // blank option under the grid - the pending path abandons a row it cannot name - so
    // this is the real route to the state, not a contrived one. Reloaded first so the
    // API's own issue text is what the message line carries.
    await fillStable(field(page, "Option 3 label"), "");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.locator(".qcms-opt-grid-error").first()).toBeVisible();
    await capture(page, `grid-error-${mode}`);
  });
}
