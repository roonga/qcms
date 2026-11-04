import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import {
  createRailFixture,
  RAIL_FORM_TITLE,
  RAIL_LONG_STEP_TITLE,
  RAIL_SHORT_STEP_TITLE,
} from "./support/rail.js";

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("rail559");
const RUN = Date.now().toString(36);

const SIDEBAR = 1024;

let totpSecret = "";
let formId = "";

let railSlug = "";

// An editor section, because this spec measures the editor's rail frame. Secure links was
// the reference screen and is Operations' now, whose rail is a different component.
function sectionPath(): string {
  return `/forms/${formId}/versions`;
}

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
  railSlug = fixture.slug;

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto(sectionPath());
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
  await page.goto(sectionPath());
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
  await page.goto(sectionPath());

  const disclosure = page.locator("details.qcms-rail__disclosure");
  const summary = page.locator("summary.qcms-rail__summary");

  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeHidden();

  await summary.focus();
  expect(
    await page.evaluate(() => document.activeElement?.tagName.toLowerCase()),
    "the summary takes keyboard focus",
  ).toBe("summary");

  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeHidden();
});

test("the rail opens by default at --bp-sidebar and stays shut one pixel below it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const disclosure = page.locator("details.qcms-rail__disclosure");

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto(sectionPath());
  await expect(disclosure, "at the boundary the sidebar is open").toHaveAttribute("open", "");
  await expect(page.locator('[data-rail-group="sections"]')).toBeVisible();

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto(sectionPath());
  await expect(disclosure, "one pixel below it the band is shut").not.toHaveAttribute("open", "");

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await expect(disclosure).toHaveAttribute("open", "");
});

test("559 names the form in the summary and keeps it on one line at 390", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(sectionPath());

  await expect(page.locator(".qcms-rail__summary-text")).toHaveText(RAIL_FORM_TITLE);
  await expect(page.locator(".qcms-rail__summary-text")).not.toHaveText(railSlug);

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
  await page.goto(sectionPath());

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
  // Wrap long step titles: their ends may be the only distinguishing text, with no other untruncated copy.
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
  await page.goto(sectionPath());

  const badged = page
    .locator('[data-rail-group="steps"] a')
    .filter({ hasText: RAIL_LONG_STEP_TITLE })
    .locator("[data-rail-issues]");
  await expect(badged, "the step holding the deprecated pin carries its count").toBeVisible();
  await expect(badged).toHaveText(/^\d+ issues?$/u);

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

  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(sectionPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  await waitForBarMeasurement(page);
  const filled = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-rail"]');
    const main = document.querySelector("main#main-content");
    const body = rail?.querySelector(".qcms-rail__body");
    const shell = main?.parentElement?.parentElement;
    if (rail == null || main == null || body == null || shell == null) {
      throw new Error("the shell, the rail, its body and the column must all exist");
    }
    return {
      contentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      shellBottom: shell.getBoundingClientRect().bottom,
      railBottom: rail.getBoundingClientRect().bottom,
      mainBottom: main.getBoundingClientRect().bottom,
      railContentBottom: body.getBoundingClientRect().bottom,
    };
  });

  expect(
    filled.contentHeight,
    "the fixture screen has to be shorter than the viewport for this to mean anything",
  ).toBeLessThanOrEqual(filled.viewportHeight);

  expect(filled.shellBottom, "the shell fills the viewport").toBeCloseTo(filled.viewportHeight, 0);
  expect(filled.railBottom, "and the rail's own surface ends where the column does").toBeCloseTo(
    filled.mainBottom,
    0,
  );
  expect(
    filled.railBottom - filled.railContentBottom,
    "which is well below where the rail's own content stops",
  ).toBeGreaterThan(100);

  expect(
    filled.railBottom,
    "and it reaches the bottom of the screen, not just the body",
  ).toBeCloseTo(filled.viewportHeight, 0);
  expect(filled.mainBottom, "with nothing left below either track").toBeCloseTo(
    filled.viewportHeight,
    0,
  );
});

test("1117 starts the content column where the rail's track ends", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/questions");

  await expect(page.locator(".qcms-rail")).toHaveCount(1);
  const offset = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    if (main === null) throw new Error("the authenticated shell must be on screen");
    const rail = document.querySelector(".qcms-rail");
    if (rail === null) throw new Error("the rail must be on screen");
    const box = main.getBoundingClientRect();
    return {
      left: box.left,
      railRight: rail.getBoundingClientRect().right,
      railWidth: rail.getBoundingClientRect().width,
    };
  });
  expect(offset.left, "the column starts where the rail's track ends").toBeCloseTo(
    offset.railRight,
    0,
  );

  expect(offset.railWidth, "the rail takes its own 240px track").toBeCloseTo(240, 0);
});

test("559 gives every rail row a real destination, which is what anchors-not-buttons buys", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(sectionPath());

  const hrefs = await page
    .locator(".qcms-rail__link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));

  expect(hrefs, "the form, its two steps, and the four authoring screens beside it").toHaveLength(
    7,
  );
  expect(
    hrefs.filter((href) => href.endsWith("/publish")),
    "the publish row points at the wizard's route",
  ).toHaveLength(1);
  expect(
    hrefs.filter((href) => href.endsWith("/rules")),
    "the rules row points at the rules route",
  ).toHaveLength(1);
  expect(hrefs.every((href) => href.startsWith("/forms/"))).toBe(true);
});

const scrollState = async (
  page: Page,
): Promise<{
  readonly pageOverflows: boolean;
  readonly railOverflows: boolean;
  readonly railScrollTop: number;
  readonly railTop: number;
  readonly railBottom: number;
  readonly pageScrollY: number;
  readonly barHeight: number;
  readonly barToken: number;
}> =>
  page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-rail"]');
    const header = document.querySelector("header");
    if (rail === null || header === null) throw new Error("the shell must be on screen");
    const root = document.documentElement;

    const probe = document.createElement("div");
    probe.style.blockSize = "var(--admin-topbar-layout-h, var(--admin-topbar-h))";
    probe.style.position = "absolute";
    root.append(probe);
    const barToken = probe.getBoundingClientRect().height;
    probe.remove();
    return {
      pageOverflows: root.scrollHeight > root.clientHeight,
      railOverflows: rail.scrollHeight > rail.clientHeight,
      railScrollTop: rail.scrollTop,
      railTop: rail.getBoundingClientRect().top,
      railBottom: rail.getBoundingClientRect().bottom,
      pageScrollY: window.scrollY,
      barHeight: header.getBoundingClientRect().height,
      barToken,
    };
  });

async function waitForBarMeasurement(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const state = await scrollState(page);
      return Math.abs(state.barHeight - state.barToken);
    })
    .toBeLessThan(0.01);
}

test("pins the rail to the viewport below the bar, at the height the token claims", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(sectionPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  await waitForBarMeasurement(page);
  const at = await scrollState(page);
  // Use the measured sticky-header height; wrapped navigation exceeds the derived single-row height.
  expect(at.barHeight, "the effective height includes the entire header").toBeCloseTo(
    at.barToken,
    0,
  );
  expect(at.railTop, "the rail starts where the bar ends").toBeCloseTo(at.barHeight, 0);
  expect(at.railBottom, "and ends on the bottom of the screen").toBeCloseTo(900, 0);
});

test("gives neither the rail nor the page a scrollbar when both fit", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Use a tall viewport to distinguish auto overflow from an always-reserved scrollbar gutter.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto(sectionPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  await waitForBarMeasurement(page);
  const at = await scrollState(page);
  expect(at.pageOverflows, "the screen fits, so the page offers no scrollbar").toBe(false);
  expect(at.railOverflows, "and the rail's rows fit, so neither does it").toBe(false);
});

test("leaves the rail where it is while the screen beside it is scrolled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Overflow both screen and rail to verify that scrolling either leaves the other fixed.
  await page.setViewportSize({ width: 1280, height: 400 });
  await page.goto(sectionPath());
  await expect(page.getByTestId("qcms-rail")).toBeVisible();

  await waitForBarMeasurement(page);
  const at = await scrollState(page);
  expect(at.pageOverflows, "this screen is taller than 400px, so the page scrolls").toBe(true);
  expect(at.railScrollTop).toBe(0);

  await page.mouse.wheel(0, 400);
  await expect.poll(async () => (await scrollState(page)).pageScrollY).toBeGreaterThan(0);
  const scrolled = await scrollState(page);

  expect(scrolled.railTop, "the rail stayed under the bar").toBeCloseTo(at.railTop, 0);
  expect(scrolled.railScrollTop, "and its own rows did not move with the page").toBe(0);
});
