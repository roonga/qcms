import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { CAPTURE_ENABLED, hideDevChrome, waitForHydration } from "./support/capture.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * Screenshot evidence for issue 679's design gate.
 *
 * ```
 * QCMS_PORT_SEAT=<0-9> QCMS_ADMIN_CAPTURE_GATE=1 pnpm exec playwright test \
 *   --project=admin-chromium apps/admin/e2e/gate-679.pw.ts
 * ```
 *
 * ## What is being approved
 *
 * Six sibling screens of one form used to render one heading between them, the form's slug,
 * so Preview, Version history, Links, Responses and Webhooks were five pages a screen reader
 * user could not tell apart by the one landmark heading they navigate by. Five of them now
 * name their section before the form. The approved drawing for two of the five composes both
 * parts the same way (`plan/admin-shell-poc/preview-versions-poc.html`: "Draft preview: Life
 * insurance", "Version history: Life insurance").
 *
 * **The sixth is in frame on purpose.** `/forms/{id}` keeps the bare slug, because the `<h1>`
 * names the page's subject and on the builder the subject IS the form. The reviewer is being
 * asked to confirm that asymmetry as a decision, not to spot it as a gap.
 *
 * ## One frame per `test`
 *
 * Issue 559's precedent and its reason: with every frame in one test, re-shooting a single
 * frame is inexpressible. Here `--grep versions-390` re-shoots exactly that one, and the
 * account is enrolled once in `beforeAll` on a page of its own so a single-frame run still
 * has somewhere to sign in from.
 *
 * ## Why the seeded form
 *
 * `frm_auto_quote` ships with a published version, links, responses and webhook state on it,
 * so all six screens have something under the heading rather than five empty states. Its slug
 * is `auto`, which is what the frames show after each colon.
 */

test.skip(!CAPTURE_ENABLED, "gate capture runs only with QCMS_ADMIN_CAPTURE_GATE=1");

const OUT_DIR = "docs/gates/pr-679";
const EMAIL = uniqueAdminEmail("gate679");

/** The seeded insurance fixture, and the slug its heading names. */
const FORM_ID = "frm_auto_quote";
const SLUG = "auto";

/** Set by `beforeAll`, so any single frame can be re-shot on its own. */
let totpSecret = "";

/**
 * Shoot one screen, asserting the heading the frame is evidence for before the shutter.
 *
 * `path` is appended to the form's base URL, so the empty string is the builder.
 */
async function capture(
  page: Page,
  name: string,
  width: number,
  path: string,
  expected: string,
): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/forms/${FORM_ID}${path}`);
  await expect(page.locator("main#main-content")).toHaveCount(1);
  await waitForHydration(page);
  await hideDevChrome(page);

  // The claim the frame is evidence for, asserted rather than left to the reviewer's eye.
  // The first `<h1>` is the page's own: a stored version's body renders the compiled A2UI
  // document, which carries a heading of its own, so a role query by level is ambiguous
  // elsewhere in this route family and the first-match form is used everywhere here.
  await expect(page.locator("h1").first()).toHaveText(expected);

  // A full-page PNG is sized to the DOCUMENT, so an overflowing screen produces a file wider
  // than the width in its own filename and misdescribes itself in a diff.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `the ${name} frame fits its ${String(width)}px viewport`).toBeLessThanOrEqual(
    width,
  );

  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, fullPage: true, caret: "initial" });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

/** The Code Owner's standing narrow width, where the rail is a disclosure above the page. */
test("preview-390", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "preview-390", 390, "/preview", `Preview: ${SLUG}`);
});

/** The desk width, where the rail is the 15rem column beside the heading. */
test("preview-1280", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "preview-1280", 1280, "/preview", `Preview: ${SLUG}`);
});

/** The section renamed by this change: "History" alone did not say a history of what. */
test("versions-390", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "versions-390", 390, "/versions", `Version history: ${SLUG}`);
});

/**
 * The frame the rename was decided on: the rail at its 15rem column, carrying the longer
 * label. The row's height is asserted below, because the rail wraps rather than truncates
 * and "does it still fit on one line" was the open question rather than a matter of taste.
 */
test("versions-1280", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "versions-1280", 1280, "/versions", `Version history: ${SLUG}`);

  const row = page.getByTestId("qcms-rail").getByRole("link", { name: "Version history" });
  const height = await row.evaluate((element) => element.getBoundingClientRect().height);
  // One line of 0.875rem text inside 0.4rem of block padding is a little over 30px; a second
  // line would add roughly 17 more. The threshold is between the two rather than on either.
  expect(height, "the rail's version-history row stays on one line").toBeLessThan(40);
});

/** A section with no drawing of its own: the construction is what governs it. */
test("links-390", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "links-390", 390, "/links", `Links: ${SLUG}`);
});

/** The same, at the desk width. */
test("links-1280", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "links-1280", 1280, "/links", `Links: ${SLUG}`);
});

/** The one section whose other POC drew a preposition ("Responses to Life insurance"). */
test("responses-390", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "responses-390", 390, "/responses", `Responses: ${SLUG}`);
});

/** The same, at the desk width. */
test("responses-1280", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "responses-1280", 1280, "/responses", `Responses: ${SLUG}`);
});

/** The last of the five, and the second with no drawing of its own. */
test("webhooks-390", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "webhooks-390", 390, "/webhooks", `Webhooks: ${SLUG}`);
});

/** The same, at the desk width. */
test("webhooks-1280", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "webhooks-1280", 1280, "/webhooks", `Webhooks: ${SLUG}`);
});

/**
 * The sixth sibling, unchanged and deliberately so: on the builder the page's subject is the
 * form, so the heading is the form and nothing is prefixed onto it.
 */
test("builder-390", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "builder-390", 390, "", SLUG);
});

/** The same, at the desk width, beside the five that did change. */
test("builder-1280", async ({ page }) => {
  test.setTimeout(300_000);
  await capture(page, "builder-1280", 1280, "", SLUG);
});
