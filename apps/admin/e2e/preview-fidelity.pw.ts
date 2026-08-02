import { readFileSync } from "node:fs";

import type { Locator, Page } from "@playwright/test";

import { FIXTURES_PATH, PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { domShape } from "./support/dom-shape.js";
import { enrollNewAdmin } from "./support/flow.js";

/**
 * Preview fidelity: the admin's preview of a step is the portal's rendering of it
 * (task 034, exit criterion 3).
 *
 * ## What is actually being compared, and why it is the same document
 *
 * The harness seeds the vehicle-insurance form and publishes v1 (029's fixture, which every
 * portal spec walks). Two things then render that same definition:
 *
 * - the **portal**, serving a respondent the compiled documents stored at publish time
 *   (ADR-18), projected onto the API's `visibleQuestions` and drawn by `A2UIStepRenderer`;
 * - the **admin preview**, compiling the form's draft - which, for a published form with no
 *   open draft, is the newest published definition the API seeds back (`draftSource:
 *   "seeded"`) - and drawing it with the same projection and the same renderer.
 *
 * Same definition in, same compiler, same projection, same renderer. If those four are
 * genuinely shared, the two DOM subtrees are the same, and this test says so. If a future
 * change gives the admin its own renderer, its own projection, or its own compiler, this is
 * the test that fails - which is the point, because a screenshot could not tell.
 *
 * ## Why it is not a screenshot
 *
 * Exit criterion 3 asks for a deep match rather than an image, and rightly: the two apps
 * legitimately differ in theme tokens, fonts and surrounding chrome (ADR-30), so a pixel
 * comparison would fail for reasons that have nothing to do with fidelity while still
 * missing a swapped control that happened to look similar. The comparison is therefore of
 * the rendered *structure*: elements, classes, semantic and state attributes, and text,
 * with generated ids normalized away (see `support/dom-shape.ts`).
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("fidelity");

/** The seeded insurance form's slug, as the harness wrote it for the portal specs. */
function seededSlug(): string {
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as { slug: string };
  return fixtures.slug;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the preview's step DOM deep-matches the portal's (exit criterion 3)", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const slug = seededSlug();

  // --- the respondent's side ------------------------------------------------
  const portal = await context.newPage();
  await portal.goto(`http://localhost:${String(PORTAL_PORT)}/f/${slug}`);
  await portal.getByRole("button", { name: "Start" }).click();
  await portal.waitForURL(/\/s\/ses_/);
  const portalForm = rendererRoot(portal);
  await expect(portalForm).toBeVisible({ timeout: 60_000 });
  const respondent = await domShape(portalForm);
  await portal.close();

  // --- the author's side ----------------------------------------------------
  await enrollNewAdmin(page, EMAIL);
  await page.goto("/forms");
  await page.getByRole("row").filter({ hasText: slug }).first().click();
  await page.waitForURL(/\/forms\/frm_/);
  const formId = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(formId).toMatch(/^frm_/u);

  await page.goto(`/forms/${formId}/preview`);
  const previewForm = page.getByTestId("qcms-draft-preview").locator("form").first();
  await expect(previewForm).toBeVisible({ timeout: 60_000 });
  const author = await domShape(previewForm);

  // --- the same document ----------------------------------------------------
  // A sanity check first, so a failure below is read as a divergence rather than as an
  // empty comparison of two empty trees.
  expect(author.children.length, "the preview should render controls").toBeGreaterThan(0);
  expect(author).toEqual(respondent);
});

/**
 * The portal's rendered step: the `form` the A2UI root node produces.
 *
 * `.last()` rather than `.first()`: before hydration the page carries the no-JS fallback
 * form (task 044), and React replaces rather than adopts it, so taking the first match can
 * catch the pre-hydration document. The renderer's own form is the one inside the flow's
 * field container, which is what this narrows to.
 */
function rendererRoot(page: Page): Locator {
  return page.locator("form").last();
}
