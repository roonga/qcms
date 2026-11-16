import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./support/gates.js";
import { readFixtures } from "./support/fixtures.js";
import {
  KS,
  checkOption,
  chooseRadio,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
  stepServed,
} from "./support/kitchen-sink.js";
import { fillNativeDate, submitStep } from "./support/no-js.js";

const WIDE = { width: 1024, height: 900 };
const NARROW = { width: 390, height: 844 };
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS } })
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
}

function rail(page: Page): Locator {
  return page.getByTestId("step-rail");
}

function railItem(scope: Locator, label: string): Locator {
  return scope.locator("[data-rail-state]").filter({ hasText: label });
}

async function expectStates(scope: Locator, expected: Record<string, string>): Promise<void> {
  for (const [label, state] of Object.entries(expected)) {
    await expect(railItem(scope, label), label).toHaveAttribute("data-rail-state", state);
  }
}

async function walkToCoverHydrated(page: Page, slug: string): Promise<void> {
  await startKitchenSink(page, slug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await chooseRadio(page, "No");
  await checkOption(page, "Breakdown");
  await continueStep(page);
}

test.describe("side rail, scripted", () => {
  test("names every step, links the completed ones, and jumps back through the cursor", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    const { railSlug } = readFixtures();
    await startKitchenSink(page, railSlug);

    await expect(rail(page)).toBeVisible();
    await expect(page.getByTestId("progress")).toHaveCount(0);
    await expect(page.getByTestId("step-rail-fold")).toBeHidden();
    await expectStates(rail(page), {
      "About you": "current",
      "Driving history": "ahead",
      "Your cover": "notNeeded",
    });
    await expect(railItem(rail(page), "About you")).toHaveAttribute("aria-current", "step");
    await expect(railItem(rail(page), "Your cover")).toContainText("Not needed");
    await expect(rail(page).getByRole("link")).toHaveCount(2);
    await expectNoAxeViolations(page, "side rail, first step");

    await fillText(page, KS.fullName, "Ada Lovelace");
    await enterDate(page, "05171990");
    await continueStep(page);
    await chooseRadio(page, "No");
    await expectStates(rail(page), { "Your cover": "ahead" });
    await checkOption(page, "Breakdown");
    await continueStep(page);

    await expectStates(rail(page), {
      "About you": "completed",
      "Driving history": "completed",
      "Your cover": "current",
    });

    const served = stepServed(page);
    await rail(page)
      .getByRole("link", { name: /About you/ })
      .click();
    await served;
    await expect(page.getByRole("textbox", { name: KS.fullName })).toHaveValue("Ada Lovelace");
    await expectStates(rail(page), {
      "About you": "current",
      "Driving history": "completed",
      "Your cover": "ahead",
    });
    await expectNoAxeViolations(page, "side rail, after a back-jump");

    const forward = stepServed(page);
    await rail(page)
      .getByRole("link", { name: /Driving history/ })
      .click();
    await forward;
    await expectStates(rail(page), { "Driving history": "current", "Your cover": "ahead" });

    await chooseRadio(page, "Yes");
    await expectStates(rail(page), { "Driving history": "current", "Your cover": "notNeeded" });
    await expect(page.getByRole("textbox", { name: KS.count })).toBeVisible();
  });

  test("reaches every completed step from the keyboard", async ({ page }) => {
    await page.setViewportSize(WIDE);
    const { railSlug } = readFixtures();
    await walkToCoverHydrated(page, railSlug);

    const link = rail(page).getByRole("link", { name: /About you/ });
    await link.focus();
    await expect(link).toBeFocused();
    const served = stepServed(page);
    await page.keyboard.press("Enter");
    await served;
    await expect(railItem(rail(page), "About you")).toHaveAttribute("aria-current", "step");
  });

  test("folds into a top indicator with a disclosure below the breakpoint", async ({ page }) => {
    await page.setViewportSize(NARROW);
    const { railSlug } = readFixtures();
    await walkToCoverHydrated(page, railSlug);

    const fold = page.getByTestId("step-rail-fold");
    await expect(rail(page)).toBeHidden();
    await expect(fold).toBeVisible();
    await expect(page.getByTestId("progress-fold")).toHaveText("Step 3 of 3");
    const list = fold.getByRole("navigation", { name: "Steps" });
    await expect(list).toBeHidden();

    await fold.locator("summary").click();
    await expect(list).toBeVisible();
    await expectStates(list, {
      "About you": "completed",
      "Driving history": "completed",
      "Your cover": "current",
    });
    await expectNoAxeViolations(page, "narrow fold, open");

    const served = stepServed(page);
    await list.getByRole("link", { name: /About you/ }).click();
    await served;
    await expect(page.getByTestId("progress-fold")).toHaveText("Step 1 of 3");
    await expect(fold.getByRole("navigation", { name: "Steps" })).toBeHidden();
  });
});

test.describe("progress modes", () => {
  test("none shows no progress at either width", async ({ page }) => {
    const { railNoneSlug } = readFixtures();
    await page.setViewportSize(WIDE);
    await startKitchenSink(page, railNoneSlug);
    for (const size of [WIDE, NARROW]) {
      await page.setViewportSize(size);
      await expect(page.getByTestId("progress")).toHaveCount(0);
      await expect(page.getByTestId("step-rail")).toBeHidden();
      await expect(page.getByTestId("step-rail-fold")).toHaveCount(0);
    }
    await expectNoAxeViolations(page, "progress mode none");
  });

  test("top indicator is the default where the version carries no appearance", async ({ page }) => {
    const { kitchenSinkSlug } = readFixtures();
    await page.setViewportSize(WIDE);
    await startKitchenSink(page, kitchenSinkSlug);
    await expect(page.getByTestId("progress")).toHaveText("Step 1 of 3");
    await expect(page.getByTestId("step-rail")).toHaveCount(0);
    await expect(page.getByTestId("step-rail-fold")).toHaveCount(0);
  });
});

test.describe("side rail without scripting", () => {
  test.use({ javaScriptEnabled: false });

  async function start(page: Page, slug: string): Promise<string> {
    await page.goto(`/f/${slug}`);
    await page.getByRole("button", { name: "Start" }).click();
    await page.waitForURL(/\/s\/ses_/);
    return new URL(page.url()).pathname;
  }

  async function walkToHistory(page: Page, slug: string): Promise<string> {
    const flowPath = await start(page, slug);
    await page.locator('input[name="q_full_name"]').fill("Ada Lovelace");
    await fillNativeDate(page, "q_dob", "1990-05-17");
    await submitStep(page);
    return flowPath;
  }

  test("a completed step is a plain link back, and a forward cursor is refused", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    const { railSlug } = readFixtures();
    const fresh = await start(page, railSlug);
    await page.goto(`${fresh}?step=1`);
    await expectStates(rail(page), { "About you": "current", "Driving history": "ahead" });
    await expect(rail(page).getByRole("link")).toHaveCount(0);

    await walkToHistory(page, railSlug);
    await expectStates(rail(page), { "About you": "completed", "Driving history": "current" });

    await rail(page)
      .getByRole("link", { name: /About you/ })
      .click();
    await page.waitForURL(/\?step=0$/);
    await expect(page.locator('input[name="q_full_name"]')).toHaveValue("Ada Lovelace");
    await expectStates(rail(page), { "About you": "current", "Driving history": "ahead" });
    await expectNoAxeViolations(page, "no-JS side rail, after a back-jump");

    await page.locator('input[name="q_full_name"]').fill("");
    await submitStep(page);
    await expect(page).toHaveURL(/\?step=0$/);
    await expectStates(rail(page), { "About you": "current" });

    await page.locator('input[name="q_full_name"]').fill("Grace Hopper");
    await submitStep(page);
    await expectStates(rail(page), { "About you": "completed", "Driving history": "current" });
  });

  test("the narrow fold opens and links back without script", async ({ page }) => {
    await page.setViewportSize(NARROW);
    const { railSlug } = readFixtures();
    await walkToHistory(page, railSlug);
    const fold = page.getByTestId("step-rail-fold");
    await fold.locator("summary").click();
    const list = fold.getByRole("navigation", { name: "Steps" });
    await expect(list).toBeVisible();
    await list.getByRole("link", { name: /About you/ }).click();
    await page.waitForURL(/\?step=0$/);
    await expect(page.getByTestId("progress-fold")).toHaveText("Step 1 of 2");
  });
});
