import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";
import { LEGIBILITY_FONT_KEYS, fontByKey } from "@roonga/qcms-ui/fonts";

import {
  FONT_COOKIE,
  MODE_COOKIE,
  TEXT_SCALES,
  TEXT_SIZE_COOKIE,
  textSizePx,
} from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import { appearanceOf, publishAppearance } from "./support/form-appearance.js";
import { expect, test } from "./support/gates.js";
import { waitForHydration } from "./support/hydration.js";
import { HARNESS_FONTS, PORTAL_PORT } from "./support/harness-config.js";

const ORIGIN = `http://localhost:${PORTAL_PORT}`;

/** A face the harness deployment does not list and that is not a legibility face. */
const FORM_FACE = "roboto";

/** The largest admin base, which reaches the 32px cap from 150 percent upward. */
const LARGEST_BASE = 24;

async function pin(page: Page, cookies: Readonly<Record<string, string>>): Promise<void> {
  await page
    .context()
    .addCookies(Object.entries(cookies).map(([name, value]) => ({ name, value, url: ORIGIN })));
}

async function startSession(page: Page, slug: string): Promise<string> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/u);
  await expect(page.getByTestId("step-card")).toBeVisible();
  return new URL(page.url()).pathname;
}

async function openMenu(page: Page): Promise<void> {
  const menu = page.getByTestId("appearance");
  if (!(await menu.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('[data-testid="appearance"] > summary').click();
  }
  await expect(page.getByTestId("appearance-textSize")).toBeVisible();
}

async function rootFontSize(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
}

/** WCAG 1.4.10: nothing scrolls sideways at 320 CSS px, the menu panel included. */
async function expectReflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const panel = document.querySelector(".qcms-appearance__panel");
    const box = panel?.getBoundingClientRect();
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      panelLeft: box?.left ?? 0,
      panelRight: box?.right ?? 0,
    };
  });
  expect(overflow.scrollWidth, `${label}: page scrolls sideways`).toBeLessThanOrEqual(
    overflow.viewport,
  );
  expect(overflow.panelLeft, `${label}: menu starts off-screen`).toBeGreaterThanOrEqual(0);
  expect(overflow.panelRight, `${label}: menu ends off-screen`).toBeLessThanOrEqual(
    overflow.viewport,
  );
}

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  await settleTransitions(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
}

test("the menu offers the legibility faces and the form's face, and each one applies", async ({
  page,
}) => {
  for (const key of [FORM_FACE, "lexend", "opendyslexic"]) expect(HARNESS_FONTS).not.toContain(key);
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.menu;
  await publishAppearance(fixtures, formId, appearanceOf(fixtures.looks.teal, { face: FORM_FACE }));

  await startSession(page, slug);
  await waitForHydration(page);
  await openMenu(page);
  const select = page.getByTestId("appearance-font");
  await expect(select).toHaveValue(FORM_FACE);
  const offered = await select
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(offered).toEqual(expect.arrayContaining([...LEGIBILITY_FONT_KEYS, FORM_FACE]));

  for (const key of [...LEGIBILITY_FONT_KEYS, FORM_FACE]) {
    await select.selectOption(key);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\bfont-${key}\\b`, "u"));
    const family = fontByKey(key)?.family ?? "ui-sans-serif";
    expect(
      await page.evaluate(() => getComputedStyle(document.body).fontFamily),
      `${key}: body face`,
    ).toContain(family);
  }

  const saved = (await page.context().cookies()).find((cookie) => cookie.name === FONT_COOKIE);
  expect(saved?.value).toBe(FORM_FACE);
});

test("every scale over the largest base stays within 32px and reflows at 320px", async ({
  page,
}) => {
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.textSize;
  await publishAppearance(
    fixtures,
    formId,
    appearanceOf(fixtures.looks.crimson, { textSize: LARGEST_BASE }),
  );
  await page.setViewportSize({ width: 320, height: 640 });

  await pin(page, { [MODE_COOKIE]: "light" });
  const started = await startSession(page, slug);
  for (const scale of TEXT_SCALES) {
    await pin(page, { [TEXT_SIZE_COOKIE]: scale });
    await page.goto(started);
    await expect(page.getByTestId("step-card")).toBeVisible();
    expect(await rootFontSize(page), `${scale}%`).toBe(textSizePx(LARGEST_BASE, scale));
    await waitForHydration(page);
    await openMenu(page);
    await expectReflow(page, `${String(LARGEST_BASE)}px x ${scale}%`);
  }

  for (const mode of ["light", "dark", "hc"] as const) {
    await pin(page, { [MODE_COOKIE]: mode, [TEXT_SIZE_COOKIE]: "200" });
    await page.goto(started);
    await waitForHydration(page);
    await openMenu(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${mode}\\b`, "u"));
    await expectNoAxeViolations(page, `${mode} at 32px, 320px wide, menu open`);
  }
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the menu opens and applies a text size on a themed form", async ({ page }) => {
    const { formAppearance: fixtures } = readFixtures();
    const { formId, slug } = fixtures.forms.textSizeNoJs;
    await publishAppearance(
      fixtures,
      formId,
      appearanceOf(fixtures.looks.crimson, { textSize: LARGEST_BASE }),
    );
    await page.setViewportSize({ width: 320, height: 640 });

    await startSession(page, slug);
    expect(await rootFontSize(page)).toBe(LARGEST_BASE);
    await page.locator('[data-testid="appearance"] > summary').click();
    await page.locator('[data-testid="appearance-textSize"] label[data-value="200"]').click();
    const served = page.waitForResponse(
      (response) => response.request().isNavigationRequest() && response.status() === 200,
    );
    await page.locator("button.qcms-appearance__apply").click();
    await served;

    expect(await rootFontSize(page)).toBe(32);
    const saved = (await page.context().cookies())
      .filter((cookie) => cookie.name.startsWith("qcms-"))
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    expect(saved).toEqual([`${TEXT_SIZE_COOKIE}=200`]);
    await expectReflow(page, "no-JS at 32px");
  });
});
