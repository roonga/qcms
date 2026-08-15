import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, captureInto } from "./support/capture.js";
import { enrollNewAdmin, settleTransitions, signInWithTotp } from "./support/flow.js";
import { chooseOption } from "./support/forms.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { createDraft } from "./support/questions.js";

/**
 * Capture the screenshot set for the task 058 human design gate (exit criterion 7).
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 QCMS_PORT_SEAT=<0-9> \
 *   pnpm exec playwright test --project=admin-chromium apps/admin/e2e/gate-screenshots-058.pw.ts
 * ```
 *
 * ## The set: five frames, two viewports
 *
 * What the Code Owner is being asked to rule on is a **pair** in every frame - the
 * respondent surface inside the box and the authoring chrome around it - so each one is
 * a full-page shot rather than a crop of the preview. A crop would show a themed box and
 * prove nothing about the thing the task is actually about.
 *
 * 1. `harbor-light` - the deployment's configured theme at first paint, untouched.
 * 2. `plum-dark` - a dark island inside a light authoring page. The starkest pair.
 * 3. `harbor-hc` - the high-contrast layer, where the label and option treatments change
 *    materially and which the task names as the case authors most need to see.
 * 4. `sand-light-chrome-dark` - the reverse mix: a light island while the operator's own
 *    chrome is dark. Two directions, because they are two different judgements.
 * 5. `overlay-open` - **deliberately showing a portalled overlay**, per the amendment of
 *    2026-08-14. A `date` question's calendar is open over a switched island, and it is
 *    drawn in the authoring app's Cobalt rather than in the previewed theme, because a
 *    react-aria popover is portalled to `document.body` and is therefore not a
 *    descendant of the scope carrier. It is in the set so the Code Owner rules on that
 *    appearance AT the gate rather than meeting it afterwards. `docs/gates/058/README.md`
 *    states the same thing in an operator's terms.
 *
 * The authoring mode comes from the real `qcms-app-mode` cookie, not from poking the DOM,
 * so frames 1-3 and 5 are genuinely the app in Light and frame 4 is genuinely the app in
 * Dark. Everything else - hydration waits, dev-chrome suppression, the caret fix and the
 * 390px reflow guard - lives in `support/capture.ts`.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate058");
const capture = captureInto("docs/gates/058");

/** Short tail, for the reason `gate-screenshots-033.pw.ts` records: ids widen frames. */
const TAIL = Date.now().toString(36).slice(-5);

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";

const THEME_LABEL = "Preview theme";
const MODE_LABEL = "Preview mode";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the capture account", async ({ page }) => {
  test.setTimeout(120_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret).not.toBe("");
});

/** Put the island into one theme and one mode through its own controls. */
async function setIsland(page: Page, theme: string, mode: string): Promise<void> {
  const switcher = page.getByTestId("qcms-preview-switcher");
  await chooseOption(switcher, THEME_LABEL, theme);
  await chooseOption(switcher, MODE_LABEL, mode);
  await settleTransitions(page);
}

test("captures the island against a light authoring page", async ({ page }) => {
  test.setTimeout(420_000);
  await page
    .context()
    .addCookies([{ name: "qcms-app-mode", value: "light", url: ADMIN_BASE_URL, sameSite: "Lax" }]);
  await signInWithTotp(page, EMAIL, totpSecret);

  // Multiple choice: options are where the label and selection treatments differ most
  // between the themes and most of all in high contrast, which is what the gate is for.
  await createDraft(page, `gate058-choice-${TAIL}`, "Multiple choice");
  await expect(page.getByTestId("qcms-preview-surface")).toBeVisible();
  await settleTransitions(page);

  // Untouched: the configured deployment theme at first paint.
  await capture(page, "harbor-light");

  await setIsland(page, "Plum", "Dark");
  await capture(page, "plum-dark");

  await setIsland(page, "Harbor", "High contrast");
  await capture(page, "harbor-hc");
});

test("captures a light island inside a dark authoring page", async ({ page }) => {
  test.setTimeout(420_000);
  await page
    .context()
    .addCookies([{ name: "qcms-app-mode", value: "dark", url: ADMIN_BASE_URL, sameSite: "Lax" }]);
  await signInWithTotp(page, EMAIL, totpSecret);

  await createDraft(page, `gate058-reverse-${TAIL}`, "Multiple choice");
  await expect(page.getByTestId("qcms-preview-surface")).toBeVisible();
  await settleTransitions(page);

  await setIsland(page, "Sand", "Light");
  await capture(page, "sand-light-chrome-dark");
});

test("captures an open overlay over a switched island (the accepted limitation)", async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page
    .context()
    .addCookies([{ name: "qcms-app-mode", value: "light", url: ADMIN_BASE_URL, sameSite: "Lax" }]);
  await signInWithTotp(page, EMAIL, totpSecret);

  // A `date` question, because its calendar is the overlay every author reaches: there is
  // no way to answer a date question without opening one.
  await createDraft(page, `gate058-date-${TAIL}`, "Date");
  await expect(page.getByTestId("qcms-preview-surface")).toBeVisible();
  await settleTransitions(page);

  // Plum + Dark, so the gap between the previewed theme and the overlay's Cobalt is as
  // visible as it can be. A light island over a light overlay would understate it.
  await setIsland(page, "Plum", "Dark");

  const surface = page.getByTestId("qcms-preview-surface");
  await surface
    .getByRole("button", { name: /[Cc]alendar/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await settleTransitions(page);

  await capture(page, "overlay-open");
});
