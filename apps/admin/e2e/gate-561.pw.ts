import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * Screenshot evidence for issue 561's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-561.pw.ts
 * ```
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * The shape issue 559's gate set, for the reason issue 607 tracks: a capture that writes
 * every frame inside one `test` makes "re-shoot only what moved" inexpressible, and the
 * only way to replace two frames is to shoot fifteen and keep two. Here every frame is its
 * own test named after the file it writes, so `--grep versions-1024` re-shoots exactly
 * that one. The fixture is the seeded insurance form plus one submitted response, built in
 * `beforeAll` on a page of its own, which is what lets a single-frame run still have
 * something to point at.
 *
 * ## What the set is claiming
 *
 * Six screens gained the rail (the seventh, secure links, was issue 559's reference screen
 * and is unchanged by this issue, so its frames are not re-shot). Each is shown at the
 * Code Owner's standing pair, 390 and 1280. The `--bp-sidebar` boundary pair is shot on
 * the history screen, because that is the screen where the contract's one genuine trap is
 * visible: the rail's children are the form's STEPS while the column beside it is a table
 * of VERSIONS, and a reviewer can see in one frame that the rail is not repeating the
 * page's own body (`plan/admin-ux-audit.md` §3.2 and §5.4).
 *
 * The builder is shot too, at 1280, and it is the one frame in the set showing NO rail.
 * That is the escalation this issue made rather than settled: the builder already carries
 * a step list that is an editor, and reconciling it with §7's read-only step group is a
 * layout ruling nobody has recorded. The frame is here so the gate can see what was left
 * alone.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-561";
const EMAIL = uniqueAdminEmail("gate561");

/** The seeded insurance fixture: one step, a published v1, four secure links. */
const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const ACCIDENT = "q_at_fault_accident";

/** Set by `beforeAll`, which enrolls the account and makes the response subject exist. */
let totpSecret = "";
let sessionId = "";

/** One frame: the path it opens and the viewport it is shot at. */
interface Frame {
  readonly path: string;
  readonly width: number;
  readonly height?: number;
}

async function capture(page: Page, name: string, frame: Frame): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: frame.width, height: frame.height ?? 900 });
  await page.goto(frame.path);
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await waitForHydration(page);
  await hideDevChrome(page);

  // A full-page PNG is sized to the DOCUMENT, so a screen that scrolls sideways produces a
  // file wider than the width in its own name and misdescribes itself to a reviewer who
  // cannot measure a PNG in a GitHub diff. Soft, so one screen's overflow reports itself
  // without costing the rest of the set its evidence.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect
    .soft(scrollWidth, `the ${name} frame fits its ${String(frame.width)}px viewport`)
    .toBeLessThanOrEqual(frame.width);

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  sessionId = await submitResponse(SLUG, [[ACCIDENT, false]]);
  await page.close();
});

/** §7 / the escalation: the builder is the one form-scoped screen still without a rail. */
test("builder-1280", async ({ page }) => {
  await capture(page, "builder-1280", { path: `/forms/${FORM_ID}`, width: 1280 });
});

/** §7 collapsed: below `--bp-sidebar` the preview's rail is a disclosure. */
test("preview-390", async ({ page }) => {
  await capture(page, "preview-390", { path: `/forms/${FORM_ID}/preview`, width: 390 });
});

/** §7 with §3.4: the rail beside a respondent-facing render that keeps its narrow measure. */
test("preview-1280", async ({ page }) => {
  await capture(page, "preview-1280", { path: `/forms/${FORM_ID}/preview`, width: 1280 });
});

/** §7 collapsed on the history screen. */
test("versions-390", async ({ page }) => {
  await capture(page, "versions-390", { path: `/forms/${FORM_ID}/versions`, width: 390 });
});

/** §1 / §7: one pixel below `--bp-sidebar`, still a disclosure and not a column. */
test("versions-1023", async ({ page }) => {
  await capture(page, "versions-1023", { path: `/forms/${FORM_ID}/versions`, width: 1023 });
});

/** §1 / §7: at `--bp-sidebar`, the 240px column, both groups, one divider. */
test("versions-1024", async ({ page }) => {
  await capture(page, "versions-1024", { path: `/forms/${FORM_ID}/versions`, width: 1024 });
});

/** §7 with §3.2: the children are the form's steps, beside a table of versions. */
test("versions-1280", async ({ page }) => {
  await capture(page, "versions-1280", { path: `/forms/${FORM_ID}/versions`, width: 1280 });
});

/** §7 collapsed on one stored version. */
test("version-detail-390", async ({ page }) => {
  await capture(page, "version-detail-390", { path: `/forms/${FORM_ID}/versions/1`, width: 390 });
});

/** §7: a detail route marks the section it lives under, and keeps §3.4's narrow measure. */
test("version-detail-1280", async ({ page }) => {
  await capture(page, "version-detail-1280", { path: `/forms/${FORM_ID}/versions/1`, width: 1280 });
});

/** §7 collapsed on the responses list. */
test("responses-390", async ({ page }) => {
  await capture(page, "responses-390", { path: `/forms/${FORM_ID}/responses`, width: 390 });
});

/** §7 with §5.4: the children are the form's steps, not the responses in the column. */
test("responses-1280", async ({ page }) => {
  await capture(page, "responses-1280", { path: `/forms/${FORM_ID}/responses`, width: 1280 });
});

/** §7 collapsed on one collected response. */
test("response-detail-390", async ({ page }) => {
  await capture(page, "response-detail-390", {
    path: `/forms/${FORM_ID}/responses/${sessionId}`,
    width: 390,
  });
});

/** §7 with §3.7: the rail carries no action, so the erasure door stays in the column. */
test("response-detail-1280", async ({ page }) => {
  await capture(page, "response-detail-1280", {
    path: `/forms/${FORM_ID}/responses/${sessionId}`,
    width: 1280,
  });
});

/** §7 collapsed on the per-form webhooks screen. */
test("webhooks-390", async ({ page }) => {
  await capture(page, "webhooks-390", { path: `/forms/${FORM_ID}/webhooks`, width: 390 });
});

/** §7 with §6: the widest screen in the subtree, with the 240px track taken off the shell. */
test("webhooks-1280", async ({ page }) => {
  await capture(page, "webhooks-1280", { path: `/forms/${FORM_ID}/webhooks`, width: 1280 });
});
