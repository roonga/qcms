import { expect, test } from "../../portal/e2e/support/gates.js";

import { ADMIN_BASE_URL } from "./support/harness-config.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, CAPTURE_MODES, captureInto } from "./support/capture.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import {
  addOption,
  chooseType,
  confirmLifecycle,
  createDraft,
  field,
} from "./support/questions.js";

/**
 * Capture the screenshot set for the task 032 human design gate.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`.** It writes PNGs into a committed
 * directory, so leaving it in the standing suite would make every local
 * `pnpm verify:browser` dirty the working tree. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-032
 * ```
 *
 * ## The set: three screens, two viewports, three modes
 *
 * The library list, a question's detail (version timeline plus the rendered preview),
 * and the editor. Eighteen frames, which is the smallest set that shows what 032
 * actually added: the app's first screens with real data density, and the rebuilt
 * topbar trailing group, which is in EVERY frame because it is chrome and is exactly
 * what this round of the gate is reviewing.
 *
 * 390px and 1280px per the Code Owner's 2026-07-25 rule. 390 is not because operators
 * use phones (they do not) but because the layout has to survive a narrow window, and
 * the top bar's wrap is the thing to look at.
 *
 * The mode is set through the `qcms-app-mode` cookie the root layout reads, not by
 * poking the DOM: a screenshot that did not go through the real mechanism is evidence
 * of nothing. Shared hydration, dev-chrome and viewport handling lives in
 * `support/capture.ts` (see it for why the dev overlay is hidden rather than removed).
 *
 * ## Why the data is built through the UI
 *
 * `pnpm qcms:seed-fixtures` populates a DEVELOPMENT database; this suite runs against
 * a per-run Testcontainers Postgres, so the library would otherwise be empty and the
 * gate would show an empty state three times over. The first test therefore authors a
 * small library the way an operator would - which also means every frame below is of
 * a screen reached through the product rather than through a fixture.
 *
 * A single-choice question carries the detail and editor frames because it is the
 * richest shape the editor has (an option list, with ids minted once and immutable
 * afterwards) and the most informative preview.
 *
 * The hydration mismatch that stopped this capture shipping the first time (issue
 * #220) is Playwright's own caret suppression, not the app and not react-aria - see
 * `support/capture.ts` for the diagnosis and the one-word fix.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate032");
const capture = captureInto("docs/gates/032");

/** Set by the first test, which enrolls the account the rest sign in with. */
let totpSecret = "";
/** The published-then-redrafted question whose detail screen is captured. */
let featuredId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("authors a small library for the capture to show", async ({ page }) => {
  test.setTimeout(180_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  // A few types and a few statuses, so the list shows its type column, its status tags
  // and its filters against something other than one row.
  await createDraft(page, `gate-cover-level-${Date.now().toString(36)}`, "Single choice");
  featuredId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(featuredId, "the created draft should own the URL").toMatch(/^q_/u);

  // Publish v1, then start v2: two rows in the timeline is what makes it a timeline,
  // and it is the state an author spends most of their time in.
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^New version$/, "Create draft");

  await createDraft(page, `gate-excess-${Date.now().toString(36)}`, "Number");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, `gate-notes-${Date.now().toString(36)}`, "Long text");
  await createDraft(page, `gate-claim-date-${Date.now().toString(36)}`, "Date");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await confirmLifecycle(page, /^Deprecate version 1$/, "Deprecate");
});

for (const mode of CAPTURE_MODES) {
  test(`captures the ${mode} set`, async ({ page }) => {
    test.setTimeout(180_000);
    // `url` rather than `domain` + `path`: Playwright takes one form or the other, and
    // the base URL is the one this project already knows.
    await page
      .context()
      .addCookies([{ name: "qcms-app-mode", value: mode, url: ADMIN_BASE_URL, sameSite: "Lax" }]);
    await signInWithTotp(page, EMAIL, totpSecret);

    await page.goto("/questions");
    // `grid`, not `table`: the vendored Table is interactive (rows open a question),
    // so react-aria gives it the grid role.
    await expect(page.getByRole("table", { name: "Question library" })).toBeVisible();
    await capture(page, `library-list-${mode}`);

    // The detail screen of the featured question: version timeline plus the preview
    // rendered by the shared renderer.
    await page.goto(`/questions/${featuredId}`);
    await expect(page.getByRole("heading", { name: featuredId })).toBeVisible();
    await capture(page, `question-detail-${mode}`);

    // The editor with a type chosen and an option list part-built, which is where the
    // form's density, its grouped panels and its inline validation all show at once.
    await page.goto("/questions/new");
    await chooseType(page, "Single choice");
    await fillStable(field(page, "Slug"), "vehicle-primary-use");
    await fillStable(field(page, "Label"), "What is the vehicle mainly used for?");
    await addOption(page, "Private and commuting");
    await addOption(page, "Business use");
    await capture(page, `question-editor-${mode}`);
  });
}
