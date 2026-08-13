import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * Capture the screenshot set for the task 041 human design gate.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-041
 * ```
 *
 * ## The set: five states, two viewports, three modes
 *
 * The panel's empty prompt, a completed proposal with its diff and clean validation
 * line, the diff with an entry expanded (the detail an author reads before accepting),
 * the accepted draft carrying its provenance mark, and a refused turn's error state.
 * Those are the moments the wireframe's States inventory names that cannot be reached
 * by deep-linking: every one of them is the result of a turn.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule; the mode comes from the real
 * `qcms-app-mode` cookie rather than from poking the DOM. Everything else - hydration
 * waits, dev-chrome suppression, the caret fix and the reflow guard - lives in
 * `support/capture.ts`.
 *
 * Short id tails, for the reason `gate-screenshots-033.pw.ts` records at length: a full
 * base36 timestamp mints ids longer than anything in the repo and pushes the cards past
 * a 390px viewport, which `captureInto` now refuses to shoot.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate041");
const capture = captureInto("docs/gates/041");
const TAIL = Date.now().toString(36).slice(-5);

/** Sorted so the library search returns the choice question first (questionId asc). */
const FIRST = `ag-a-${TAIL}`;
const SECOND = `ag-b-${TAIL}`;
/** Pins the fake provider's library search to this run's own two questions. */
const NEEDLE = `ag-`;

let totpSecret = "";

function questionIdFor(slug: string): string {
  return `q_${slug.replaceAll("-", "_")}`;
}

async function send(page: Page, message: string): Promise<void> {
  const input = page.getByTestId("qcms-assist-input").locator("input");
  await fillStable(input, message);
  await page.getByTestId("qcms-assist-send").locator("button").click();
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors the questions the captured proposal pins", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await createDraft(page, FIRST, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  await createDraft(page, SECOND, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
});

for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} set`, async ({ page }) => {
    test.setTimeout(420_000);
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    await createForm(page, `ag-quote-${mode}-${TAIL}`, "Vehicle insurance quote");
    await addStep(page, "Start");
    await pinQuestion(page, questionIdFor(FIRST), 1);
    await waitForSaved(page);

    // --- the empty panel: "describe the form you want" ----------------------
    await expect(page.getByTestId("qcms-assist-panel")).toBeVisible();
    await capture(page, `assist-empty-${mode}`);

    // --- a completed proposal, with its diff and its validation line --------
    await send(
      page,
      `a vehicle-insurance quote where an at-fault accident opens a follow-up #qcms-fake-search:${NEEDLE}`,
    );
    await expect(page.getByTestId("qcms-assist-proposal")).toBeVisible({ timeout: 60_000 });
    await capture(page, `assist-proposal-${mode}`);

    // --- one diff entry expanded: the definition an author reads before accepting
    await page.getByTestId("qcms-assist-diff").locator("summary").first().click();
    await capture(page, `assist-proposal-expanded-${mode}`);

    // --- accepted: the draft updates and the provenance mark appears --------
    await page.getByTestId("qcms-assist-accept").locator("button").click();
    await waitForSaved(page);
    await expect(page.getByTestId("qcms-builder-provenance")).toBeVisible();
    await capture(page, `assist-accepted-${mode}`);

    // --- refused: a scripted rogue tool call, stopped server-side -----------
    await send(page, "#qcms-fake:rogue-publish publish this for me");
    await expect(page.getByTestId("qcms-assist-error")).toBeVisible({ timeout: 60_000 });
    await capture(page, `assist-refused-${mode}`);
  });
}
