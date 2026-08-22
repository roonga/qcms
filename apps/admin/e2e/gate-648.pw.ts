import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";

/**
 * Screenshot evidence for the design gate on issues 648 and 657.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-648.pw.ts
 * ```
 *
 * ## What is being approved
 *
 * Two changes that are visible on every authenticated screen:
 *
 * - **The column and the chrome left-anchor** (issue 648). The topbar took `mx-auto
 *   max-w-5xl` until now, so at 1280 the wordmark sat about 145px in from the page edge
 *   while a railed content column started at the rail. Every POC that draws the shell
 *   writes the bar with neither a cap nor an auto margin, so both come off and the
 *   wordmark, the first nav item, the content column and the footer share one left edge.
 * - **Each route's cap is re-sourced from its own POC** (issue 657). Eight of the sixteen
 *   screens move.
 *
 * ## One frame per `test`, so a re-shoot can be one frame
 *
 * The precedent is `gate-559.pw.ts`: every frame is its own test named after the file it
 * writes, so `--grep webhooks-1280` re-shoots exactly that one. The account is enrolled
 * and the response subject created once in `beforeAll`, on a page of its own, which is
 * what lets a single-frame run still have something to point at.
 *
 * ## Why these eleven screens
 *
 * Issue 648 asks for one form-scoped screen, Settings, and one screen with no rail, at
 * both widths, so the shared left edge is visible with a rail and without one. Issue 657
 * asks for 1280 frames of the routes whose cap moves most. The four largest moves are the
 * form-scoped responses list and its detail screen (1024 to 1600), the new-question form
 * (1024 to 640) and the question editor (1024 to 720); the site-wide responses list (1024
 * to 900) and the erasure log (1024 to 1180) are here because they move in OPPOSITE
 * directions from the same old value, which is the clearest single demonstration that the
 * caps are per-screen rather than one number. `/webhooks` is here for issue 648 rather
 * than 657: its cap does not move, because the 1820 its POC draws is wider than any token
 * the app has, and it is the screen with no rail where the shared left edge is cleanest.
 */

test.describe.configure({ mode: "serial" });
test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-648";
const EMAIL = uniqueAdminEmail("gate648");

/** The seeded insurance fixture: published v1, four secure links, no webhook endpoint. */
const FORM_ID = "frm_auto_quote";
const SLUG = "auto";
const QUESTION_ID = "q_at_fault_accident";
/** Answering the accident question `true` reveals this one, which is then required. */
const COUNT_ID = "q_accident_count";

/** Set by `beforeAll`, which enrolls the account and creates the response subject. */
let totpSecret = "";

/** One frame: the path it is shot at, and the viewport it is shot in. */
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
  // cannot measure a PNG in a GitHub diff.
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
  // One submitted response, purely so the form-scoped responses list has a row in it.
  await submitResponse(SLUG, [
    [QUESTION_ID, true],
    [COUNT_ID, 3],
  ]);
  await page.close();
});

/** 648: no rail, so the wordmark, the first nav item and the column share one edge. */
test("webhooks-1280", async ({ page }) => {
  await capture(page, "webhooks-1280", { path: "/webhooks", width: 1280 });
});

/** 648 at 390: a cap is fluid below itself, so the phone sees the anchoring and nothing else. */
test("webhooks-390", async ({ page }) => {
  await capture(page, "webhooks-390", { path: "/webhooks", width: 390 });
});

/** 648 with a rail, and 657's largest widening: the column starts at the rail's edge, at 1600. */
test("form-responses-1280", async ({ page }) => {
  await capture(page, "form-responses-1280", {
    path: `/forms/${FORM_ID}/responses`,
    width: 1280,
  });
});

/** 648 at 390: the rail is a disclosure stacked above the column, which is full width. */
test("form-responses-390", async ({ page }) => {
  await capture(page, "form-responses-390", { path: `/forms/${FORM_ID}/responses`, width: 390 });
});

/** 648: the 40rem column against the Settings rail, which is where issue 655 first drew it. */
test("settings-1280", async ({ page }) => {
  await capture(page, "settings-1280", { path: "/settings", width: 1280 });
});

/** 648 at 390: Settings below `--bp-sidebar`, rail stacked, column fluid. */
test("settings-390", async ({ page }) => {
  await capture(page, "settings-390", { path: "/settings", width: 390 });
});

/** 657's largest narrowing: the new-question form takes its POC's 40rem, from 1024. */
test("questions-new-1280", async ({ page }) => {
  await capture(page, "questions-new-1280", { path: "/questions/new", width: 1280 });
});

/** 657: the question editor takes the 720px editor column its POC draws, from 1024. */
test("question-detail-1280", async ({ page }) => {
  await capture(page, "question-detail-1280", { path: `/questions/${QUESTION_ID}`, width: 1280 });
});

/** 657: the site-wide responses list narrows to 900, the deployment-ops POC's own number. */
test("responses-1280", async ({ page }) => {
  await capture(page, "responses-1280", { path: "/responses", width: 1280 });
});

/** 657: the erasure log widens to 1180 from the same 1024 the responses list narrowed from. */
test("erasures-1280", async ({ page }) => {
  await capture(page, "erasures-1280", { path: "/responses/erasures", width: 1280 });
});

/** 657: the forms list takes the library POC's 1080. */
test("forms-1280", async ({ page }) => {
  await capture(page, "forms-1280", { path: "/forms", width: 1280 });
});
