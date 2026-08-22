import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { field, savedStamp, waitForSaveAfter } from "./support/forms.js";
import { createRailFixture } from "./support/rail.js";

/**
 * Screenshot evidence for issue 625's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-625.pw.ts
 * ```
 *
 * ## What is being approved
 *
 * One sentence and one word, both beside or below the Publish button, both of them the
 * app declining to state a count it has not computed. The validation panel
 * (`plan/admin-ux-audit.md` §5.6's single authoritative issue count) reads "This draft has
 * not been checked yet." instead of "No issues. Everything here would pass a publish.",
 * and the pin grid's Issues column reads "Not checked" instead of "None", until the first
 * change triggers the dry run the builder has always done on a debounce.
 *
 * The pair of frames at each width is the point: the same form before and after its first
 * change, so what the new state replaced and what it gives way to are both visible. The
 * fixed state is unchanged by this issue and is here as the control.
 *
 * ## Why the seeded form gets a frame of its own
 *
 * `docs/gates/pr-561/builder-1280.png` is a committed frame of the seeded insurance form's
 * builder reading "No issues. Everything here would pass a publish.", and
 * `docs/gates/pr-561/versions-1280.png` is a committed frame of the same form's rail
 * badging `2 issues`. `seeded-1280.png` here is the first of those two shot again after
 * the fix, so the contradiction and its resolution can be compared frame to frame.
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * Issue 559's convention, kept: `--grep unchecked-390` re-shoots exactly that one. The
 * fixture is built once in `beforeAll`, which is what lets a single-frame run still have a
 * form with an issue in it to point at.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-625";
const EMAIL = uniqueAdminEmail("gate625");
const RUN = Date.now().toString(36);

/** The seeded insurance form, whose two pins name versions the seed never publishes. */
const SEEDED_FORM = "frm_auto_quote";

/** Set by `beforeAll`, which builds the fixture the frames are shot against. */
let totpSecret = "";
let formId = "";

/** One frame: the width and height it is shot at, and whether it is shot after an edit. */
interface Frame {
  readonly width: number;
  readonly height: number;
  /** Make one change first, so the builder has actually run its dry run. */
  readonly edited?: boolean;
  /** Shoot the seeded form rather than this run's fixture. */
  readonly seeded?: boolean;
}

async function capture(page: Page, name: string, frame: Frame): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: frame.width, height: frame.height });
  await page.goto(`/forms/${frame.seeded === true ? SEEDED_FORM : formId}`);
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await expect(page.getByTestId("qcms-issue-summary")).toBeVisible();
  await waitForHydration(page);

  if (frame.edited === true) {
    const before = await savedStamp(page);
    // The value has to DIFFER from what is stored or no change event fires and nothing
    // saves, so it carries the run and the frame: a single-frame re-shoot still edits.
    await fillStable(field(page, "Form title"), `Household cover ${RUN} ${name}`);
    await waitForSaveAfter(page, before);
    await expect(page.getByTestId("qcms-issue-summary")).toContainText("block a publish", {
      timeout: 30_000,
    });
    // The edit leaves the caret and a focus ring in the title field, which is chrome the
    // reviewer is not being asked about.
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
  }

  await hideDevChrome(page);

  // A full-page PNG is sized to the DOCUMENT, so a screen that scrolls sideways produces a
  // file wider than the width in its own name and misdescribes itself to a reviewer who
  // cannot measure a PNG in a GitHub diff.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect
    .soft(scrollWidth, `the ${name} frame fits its ${String(frame.width)}px viewport`)
    .toBeLessThanOrEqual(frame.width);

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  formId = (await createRailFixture(page, RUN)).formId;
  await page.close();
});

/** The unvalidated state at the narrow width: the panel's sentence, Issues column dropped. */
test("unchecked-390", async ({ page }) => {
  await capture(page, "unchecked-390", { width: 390, height: 1400 });
});

/** The unvalidated state at the standing wide width: the sentence and "Not checked" per pin. */
test("unchecked-1280", async ({ page }) => {
  await capture(page, "unchecked-1280", { width: 1280, height: 1000 });
});

/** The control at 390: one change later, a real count from a real dry run. */
test("checked-390", async ({ page }) => {
  await capture(page, "checked-390", { width: 390, height: 1400, edited: true });
});

/** The control at 1280: the count, the issue against its pin, and the step rail's badge. */
test("checked-1280", async ({ page }) => {
  await capture(page, "checked-1280", { width: 1280, height: 1000, edited: true });
});

/** The seeded form this issue was filed on, for comparison with `docs/gates/pr-561/`. */
test("seeded-1280", async ({ page }) => {
  await capture(page, "seeded-1280", { width: 1280, height: 1000, seeded: true });
});
