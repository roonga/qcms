import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createQuestionRailFixture, type QuestionRailFixture } from "./support/question-rail.js";

/**
 * The question detail screen's rail in a browser (issue 650, built to
 * `plan/admin-shell-poc/question-editor-poc.html`).
 *
 * The markup and the contents are pinned without a browser
 * (`components/questions/question-versions-rail.test.tsx`,
 * `lib/questions/version-rail.test.ts`). What is left is everything that is a computed
 * style, a measured box, a navigation or a thing rendered by two React trees at once, and
 * that is what this file is: the 240px track appearing at `--bp-sidebar` and not one pixel
 * below it, the collapsed-only version indicator, the marked row agreeing with the editor
 * beside it, the version list no longer being on this screen twice, and the lifecycle
 * actions still working from where the POC puts them.
 *
 * ## The 1023 / 1024 pair
 *
 * Same shape `rail.pw.ts` takes and for the same reason: a boundary is only pinned by
 * measuring both sides of it, so a rail that collapsed at 1000 or at 1100 would be a third
 * breakpoint nobody wrote down.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("qrail650");
const RUN = Date.now().toString(36);

/** `--bp-sidebar` is 64rem, and the browser's default root size makes that 1024px. */
const SIDEBAR = 1024;

/** Set by the first test; every later one signs in and reuses the fixture it built. */
let totpSecret = "";
let fixture: QuestionRailFixture = {
  questionId: "",
  draftVersion: 0,
  publishedVersion: 0,
  deprecatedVersion: 0,
};

function detailPath(query = ""): string {
  return `/questions/${fixture.questionId}${query}`;
}

/** The boxes the geometry assertions are about, read in one round trip. */
async function boxes(page: Page): Promise<{
  readonly railWidth: number;
  readonly railRight: number;
  readonly mainLeft: number;
  readonly mainTop: number;
}> {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-question-rail"]');
    const main = document.querySelector("main#main-content");
    if (rail === null || main === null) throw new Error("the rail and the column must both exist");
    const railBox = rail.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    return {
      railWidth: railBox.width,
      railRight: railBox.right,
      mainLeft: mainBox.left,
      mainTop: mainBox.top,
    };
  });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("650 puts a 240px version rail beside the column at --bp-sidebar, and above it below", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  fixture = await createQuestionRailFixture(page, RUN);

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto(detailPath());
  await expect(page.getByTestId("qcms-question-rail")).toBeVisible();
  const at = await boxes(page);
  expect(at.railWidth, "the rail is the same 240px track the other two rails take").toBe(240);
  expect(at.railRight, "the rail is beside the content column, not over it").toBeLessThanOrEqual(
    at.mainLeft,
  );

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto(detailPath());
  const below = await boxes(page);
  expect(below.railWidth, "one pixel below the boundary it is full width").toBe(SIDEBAR - 1);
  expect(below.mainTop, "and the column is stacked under it rather than beside it").toBeGreaterThan(
    0,
  );
});

test("650 shows which version is selected in the summary only while the rail is shut and narrow", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  const indicator = page.locator(".qcms-question-rail__summary-version");

  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  await expect(indicator, "open, the list below already says which row is current").toBeHidden();

  await page.locator("summary.qcms-rail__summary").click();
  await expect(page.locator("details.qcms-rail__disclosure")).not.toHaveAttribute("open", "");
  await expect(indicator, "shut, this line is the whole rail").toBeVisible();
  await expect(indicator).toHaveText(`/Version ${String(fixture.publishedVersion)}`);

  // Above the boundary the rail is a permanent sidebar, so the same indicator would only
  // repeat the marked row that is already on screen.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  await expect(indicator).toBeHidden();
});

test("650 marks the row the address selects, and the editor beside it shows that version", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const marked = page.locator('.qcms-question-rail__version[aria-current="page"]');
  await expect(marked, "exactly one row is current").toHaveCount(1);
  await expect(marked).toHaveAttribute("data-rail-version", String(fixture.draftVersion));

  // The rail and the screen are two React trees rendered from one URL. This is the assertion
  // that they read it through the same function: a click on a row moves both.
  await page
    .locator(
      `.qcms-question-rail__version[data-rail-version="${String(fixture.publishedVersion)}"]`,
    )
    .click();
  await page.waitForURL(new RegExp(`\\?v=${String(fixture.publishedVersion)}$`, "u"));
  await expect(
    page.locator('.qcms-question-rail__version[aria-current="page"]'),
    "the rail follows the address",
  ).toHaveAttribute("data-rail-version", String(fixture.publishedVersion));
  await expect(
    page.getByRole("heading", {
      name: `Version ${String(fixture.publishedVersion)}`,
      exact: true,
    }),
    "and so does the editor",
  ).toBeVisible();
});

test("650 spells out each version's status and digests the group above them", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  await expect(rail.locator(".qcms-question-rail__digest")).toHaveText(
    `3 versions, v${String(fixture.publishedVersion)} published`,
  );
  const row = (version: number) =>
    rail.locator(`.qcms-question-rail__version[data-rail-version="${String(version)}"]`);
  await expect(row(fixture.draftVersion).locator(".qcms-tag")).toHaveAttribute(
    "data-status",
    "draft",
  );
  await expect(row(fixture.publishedVersion).locator(".qcms-tag")).toHaveAttribute(
    "data-status",
    "published",
  );
  await expect(row(fixture.deprecatedVersion).locator(".qcms-tag")).toHaveAttribute(
    "data-status",
    "deprecated",
  );
});

test("650 leaves the version list on this screen exactly once", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  // The regression this guards is the one the rail was built to avoid: a navigation rendered
  // twice on one screen is two lists that can disagree and two sets of links to walk. The
  // card this replaced lived in the content column, so the column is where it is looked for.
  await expect(
    page.getByRole("navigation", { name: `Versions of ${fixture.questionId}` }),
    "one version navigation on the screen",
  ).toHaveCount(1);
  await expect(
    page.locator(`main#main-content a[href*="?v="]`),
    "and no second copy of its rows in the content column",
  ).toHaveCount(0);
});

test("650 keeps the lifecycle actions working from the rail the POC puts them in", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(detailPath());

  const rail = page.getByTestId("qcms-question-rail");
  // Pinned ABOVE the list, which is the POC's own reason for putting them there: the list is
  // the one thing on this screen that grows without bound.
  const actionsBottom = await rail
    .locator(".qcms-question-rail__lifecycle")
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const listTop = await rail
    .locator(".qcms-rail__group")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(actionsBottom).toBeLessThanOrEqual(listTop);

  // The buttons are the version's, not the question's: the draft offers Publish, and the
  // published version offers Deprecate instead.
  await expect(
    rail.getByRole("button", { name: `Publish version ${String(fixture.draftVersion)}` }),
  ).toBeVisible();
  await page.goto(detailPath(`?v=${String(fixture.publishedVersion)}`));
  await expect(
    rail.getByRole("button", { name: `Deprecate version ${String(fixture.publishedVersion)}` }),
  ).toBeVisible();
  await expect(rail.getByRole("button", { name: "New version" })).toBeVisible();
});
