import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, captureInto } from "./support/capture.js";
import { enrollNewAdmin } from "./support/flow.js";
import { addStep, createForm, openStep, waitForSaved } from "./support/forms.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/**
 * The screenshot gate for issue 570: the four tables whose rows stopped being the control.
 *
 * **Skipped unless `QCMS_ADMIN_CAPTURE_GATE=1`**, like every other capture spec here: it
 * writes PNGs into a committed directory, so leaving it in the standing suite would dirty
 * the working tree on every `pnpm verify:browser`. Run it deliberately:
 *
 * ```
 * QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test --project=admin-chromium gate-screenshots-pr-570
 * ```
 *
 * ## A new spec rather than four frames added to `gate-514`
 *
 * Adding a frame to an existing capture spec re-shoots the whole set it belongs to, which
 * would replace issue 514's committed evidence with frames taken from a different tree.
 * Those PNGs are the record a reviewer signed off; they are not this issue's to overwrite.
 *
 * ## What each frame is for
 *
 * Every screen appears at both widths, and the pair IS the review, because the two halves
 * of this change show at different widths:
 *
 *  - At **1280** the change to look at is the identifying cell: it is a link now, with a
 *    link's colour and underline, and no row-wide hover promising a click.
 *  - At **390** the change to look at is which columns are gone. §2 requires every table to
 *    state its compact-width drops, and these four had no way to state any until their
 *    markup stopped coming from the kit. Type and Created leave the question library,
 *    Locale leaves the form library, the three engine stamps leave the version history, and
 *    Type leaves the picker. The Version column stays everywhere
 *    (`plan/admin-mobile-stance.md`, item 5).
 *
 * Light mode only. This change moves markup and columns rather than colour: the link
 * treatment it introduces is `.qcms-text-link`, which every other table in the app already
 * wears in all three modes and which issue 514's capture reviewed there. A dark and
 * high-contrast set here would be twelve more frames of a decision nobody is being asked to
 * make.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const EMAIL = uniqueAdminEmail("gate570");
const RUN = Date.now().toString(36);
const capture = captureInto("docs/gates/pr-570");

/** The seeded insurance fixture: already published, so it has a version history to shoot. */
const SEEDED_FORM_ID = "frm_auto_quote";

const SLUG = `gate570-pick-${RUN}`;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("captures the four converted tables at both widths", async ({ page }) => {
  test.setTimeout(300_000);
  await enrollNewAdmin(page, EMAIL);

  // One published question and one form with one step, which is the least the library
  // picker needs to have a choosable row in it.
  await createDraft(page, SLUG, "Short text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createForm(page, `gate570-form-${RUN}`, "Anchors 570");
  await addStep(page, "Only step");

  // The picker first, from the builder this walk is already standing on. A step lives in
  // the autosaved draft, so leaving the builder before the save lands and coming back
  // finds a form with no step and no way to open the dialog. The wait is the fix; the
  // order is the belt.
  await waitForSaved(page);
  await openStep(page, "Only step");
  await page.getByRole("button", { name: "Add question from library" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: `Add q_${SLUG.replaceAll("-", "_")} version 1` }),
  ).toBeVisible();
  await capture(page, "library-picker");

  // The question library, scoped to this run so the frame is a readable handful of rows
  // rather than whatever the harness database has accumulated.
  await page.goto(`/questions?q=gate570`);
  // A frame is evidence, so refuse to shoot one that does not carry the state it claims.
  await expect(
    page.getByRole("link", { name: `Open question q_${SLUG.replaceAll("-", "_")}` }),
  ).toBeVisible();
  await capture(page, "questions-table");

  await page.goto("/forms");
  await expect(page.getByRole("link", { name: `Open form gate570-form-${RUN}` })).toBeVisible();
  await capture(page, "forms-table");

  await page.goto(`/forms/${SEEDED_FORM_ID}/versions`);
  await expect(page.getByRole("link", { name: "View v1" })).toBeVisible();
  await capture(page, "version-history");
});
