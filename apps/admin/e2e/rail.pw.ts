import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { createRailFixture, RAIL_LONG_STEP_TITLE, RAIL_SHORT_STEP_TITLE } from "./support/rail.js";

/**
 * The form-subtree rail in a browser (`plan/admin-design-contracts.md` §7, issue 559).
 *
 * The markup and the contents are pinned without a browser
 * (`components/forms/form-subtree-rail.test.tsx`, `lib/forms/subtree-rail.test.ts`). What
 * is left is everything that is a computed style, a measured box or an interaction, and
 * that is what this file is: the 240px track appearing at `--bp-sidebar` and not one pixel
 * below it, the disclosure being operable from the keyboard, a long title behaving the way
 * this change says it behaves, the badge arriving from a real API verdict, N2's
 * viewport-fill, and the whole thing working with no JavaScript at all.
 *
 * ## The 1023 / 1024 pair
 *
 * Same shape issue 557's pair takes, and for the same reason: a boundary is only pinned by
 * measuring both sides of it. §1 gives the app two breakpoints and `--bp-sidebar` is the
 * one the rail turns at, so a rail that collapsed at 1000 or at 1100 would be a third
 * boundary nobody wrote down.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("rail559");
const RUN = Date.now().toString(36);

/** `--bp-sidebar` is 64rem, and the browser's default root size makes that 1024px. */
const SIDEBAR = 1024;

/** Set by the first test; every later one signs in and reuses the fixture it built. */
let totpSecret = "";
let formId = "";

/** The reference screen: the rail is wired on the secure-links route (issue 559). */
function linksPath(): string {
  return `/forms/${formId}/links`;
}

/** The boxes the geometry assertions are about, read in one round trip. */
async function boxes(page: Page): Promise<{
  readonly railWidth: number;
  readonly railRight: number;
  readonly railBottom: number;
  readonly mainLeft: number;
  readonly mainTop: number;
  readonly mainBottom: number;
  readonly viewportWidth: number;
}> {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-rail"]');
    const main = document.querySelector("main#main-content");
    if (rail === null || main === null) throw new Error("the rail and the column must both exist");
    const railBox = rail.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    return {
      railWidth: railBox.width,
      railRight: railBox.right,
      railBottom: railBox.bottom,
      mainLeft: mainBox.left,
      mainTop: mainBox.top,
      mainBottom: mainBox.bottom,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("559 turns the rail into a 240px column at --bp-sidebar, and not one pixel below", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  const fixture = await createRailFixture(page, RUN);
  formId = fixture.formId;

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto(linksPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();
  const at = await boxes(page);
  expect(at.railWidth, "the rail is the 240px track §7 asks for").toBe(240);
  expect(at.railRight, "the rail is beside the content column, not over it").toBeLessThanOrEqual(
    at.mainLeft,
  );
  expect(at.railBottom, "the two tracks share a row, so they end together").toBeCloseTo(
    at.mainBottom,
    0,
  );

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto(linksPath());
  const below = await boxes(page);
  expect(below.railWidth, "one pixel below the boundary the rail is the full width").toBe(
    below.viewportWidth,
  );
  expect(
    below.railBottom,
    "and it is stacked above the column rather than beside it",
  ).toBeLessThanOrEqual(below.mainTop);
});

test("559 collapses into a disclosure that works from the keyboard and says which state it is in", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(linksPath());

  const disclosure = page.locator("details.qcms-rail__disclosure");
  const summary = page.locator("summary.qcms-rail__summary");
  await expect(disclosure).toHaveAttribute("open", "");

  // Focusable by construction rather than by a tabindex we added: `focus()` moves nothing
  // if the element cannot take focus, so this is the check and not a formality.
  await summary.focus();
  expect(
    await page.evaluate(() => document.activeElement?.tagName.toLowerCase()),
    "the summary takes keyboard focus",
  ).toBe("summary");

  // A native `<details>` is what carries the announced state, so Enter is the browser's
  // own toggle and there is no `aria-expanded` of ours that could drift from it.
  await page.keyboard.press("Enter");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeVisible();
});

test("559 names the active item in the summary and keeps it on one line at 390", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(linksPath());

  // The reference screen IS the Links section, so that is what the summary names.
  await expect(page.locator(".qcms-rail__summary-text")).toHaveText("Links");

  const summary = await page.locator(".qcms-rail__summary-text").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      textOverflow: style.textOverflow,
      overflow: style.overflowX,
      whiteSpace: style.whiteSpace,
      overflows: element.scrollWidth > element.clientWidth,
    };
  });
  expect(summary.textOverflow, "§7's ellipsis").toBe("ellipsis");
  expect(summary.overflow).toBe("hidden");
  expect(summary.whiteSpace).toBe("nowrap");
  // "Links" is short, so the row it sits in must not be scrolling sideways at 390 either.
  expect(summary.overflows).toBe(false);
  const row = page.locator("summary.qcms-rail__summary");
  const fits = await row.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits, "the summary row fits the 390px viewport").toBe(true);
});

test("559 wraps a long step title inside the column rather than hiding its end", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(linksPath());

  const long = page
    .locator('[data-rail-group="steps"] a')
    .filter({ hasText: RAIL_LONG_STEP_TITLE });
  const short = page
    .locator('[data-rail-group="steps"] a')
    .filter({ hasText: RAIL_SHORT_STEP_TITLE });
  const longBox = await long.boundingBox();
  const shortBox = await short.boundingBox();
  expect(longBox, "the long-titled step renders").not.toBeNull();
  expect(shortBox, "the short-titled step renders").not.toBeNull();
  // The decision this change makes, measured: in a permanent 240px sidebar a long title
  // takes more lines rather than losing its end, because the end is often the only thing
  // that tells two steps apart and nothing here carries the untruncated text.
  expect(longBox?.width ?? 0, "the row stays inside the 240px track").toBeLessThanOrEqual(240);
  expect(longBox?.height ?? 0, "and it wraps rather than truncating").toBeGreaterThan(
    shortBox?.height ?? 0,
  );
});

test("559 badges the step whose pin the library deprecated, from the API's own verdict", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(linksPath());

  const badged = page
    .locator('[data-rail-group="steps"] a')
    .filter({ hasText: RAIL_LONG_STEP_TITLE })
    .locator("[data-rail-issues]");
  await expect(badged, "the step holding the deprecated pin carries its count").toBeVisible();
  await expect(badged).toHaveText(/^\d+ issues?$/u);
  // The other step's pin is untouched, so it carries nothing: a badge on every row would
  // mean the count was decoration rather than a verdict.
  await expect(
    page
      .locator('[data-rail-group="steps"] a')
      .filter({ hasText: RAIL_SHORT_STEP_TITLE })
      .locator(".qcms-tag"),
  ).toHaveCount(0);
});

test("559 lets a short screen's rail reach the bottom of the shell (N2)", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Taller than this screen's content on purpose: N2 is invisible at a viewport the
  // content already fills, which is why `plan/admin-redesign-implementation-plan.md` §1
  // records it as a thing to verify at a viewport taller than the content.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(linksPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  const filled = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-rail"]');
    const main = document.querySelector("main#main-content");
    const body = rail?.querySelector(".qcms-rail__body");
    const shell = main?.parentElement?.parentElement;
    if (rail == null || main == null || body == null || shell == null) {
      throw new Error("the shell, the rail, its body and the column must all exist");
    }
    return {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      shellBottom: shell.getBoundingClientRect().bottom,
      railBottom: rail.getBoundingClientRect().bottom,
      mainBottom: main.getBoundingClientRect().bottom,
      railContentBottom: body.getBoundingClientRect().bottom,
    };
  });

  expect(
    filled.documentHeight,
    "the fixture screen has to be shorter than the viewport for this to mean anything",
  ).toBeLessThanOrEqual(filled.viewportHeight);
  // The property issue 522 found untested, stated the way its own comment asks for.
  expect(filled.shellBottom, "the shell fills the viewport").toBeCloseTo(filled.viewportHeight, 0);
  expect(filled.railBottom, "and the rail's own surface ends where the column does").toBeCloseTo(
    filled.mainBottom,
    0,
  );
  expect(
    filled.railBottom - filled.railContentBottom,
    "which is well below where the rail's own content stops",
  ).toBeGreaterThan(100);
});

test("559 leaves a screen with no rail exactly as wide as it was", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/questions");

  await expect(page.locator(".qcms-rail")).toHaveCount(0);
  // The regression this guards is specific: a grid that declared its 240px track
  // unconditionally would leave an empty one here and push the column right by 240px.
  //
  // ISSUE 648 CHANGED WHAT "AS IT WAS" MEANS, and this test is the place that says so. It
  // asserted equal gutters either side, because the column was centred; the column is now
  // left-anchored on every screen, so equal gutters is exactly the thing that must NOT be
  // true. The claim this test exists to make is untouched: no phantom track pushes a
  // railless column right. Stated as "the column starts at the viewport's origin", which
  // fails on a 240px phantom track just as loudly as the old assertion did and does not
  // also re-assert a layout the app no longer has.
  const offset = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    if (main === null) throw new Error("the authenticated shell must be on screen");
    const box = main.getBoundingClientRect();
    return { left: box.left, right: document.documentElement.clientWidth - box.right };
  });
  expect(offset.left, "no phantom rail track pushes the column right").toBe(0);
  expect(offset.right, "and the column is left-anchored rather than centred").toBeGreaterThan(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("559 leaves the whole rail working, which is what anchors-not-buttons buys", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signInWithTotp(page, EMAIL, totpSecret);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(linksPath());

    // Every row is a real anchor with a real destination, so middle-click, open-in-new-tab
    // and a scriptless browser all work. A rail built out of buttons would be inert here.
    const hrefs = await page
      .locator(".qcms-rail__link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs).toHaveLength(8);
    expect(hrefs.every((href) => href.startsWith("/forms/"))).toBe(true);

    // And the disclosure is the browser's own, so it opens and closes with nothing loaded.
    const disclosure = page.locator("details.qcms-rail__disclosure");
    await page.locator("summary.qcms-rail__summary").click();
    await expect(disclosure).not.toHaveAttribute("open", "");
    await page.locator("summary.qcms-rail__summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
  });
});
