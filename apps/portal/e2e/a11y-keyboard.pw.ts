import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, COUNT_LABEL } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import {
  KS,
  answerNumber,
  checkOption,
  chooseRadio,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

/** Select an at-fault-accident radio by keyboard and await the recorded answer. */
async function keyboardChoose(page: Page, answer: "Yes" | "No"): Promise<void> {
  const radio = page.getByRole("radio", { name: answer, exact: true });
  const recorded = page.waitForResponse(
    (r) => r.url().includes("/answers") && r.request().method() === "POST" && r.status() === 200,
  );
  await expect(async () => {
    await radio.press("Space");
    await expect(radio).toBeChecked({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await recorded;
}

test("skip link is the first Tab stop, is visible on focus, and jumps to the content", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  const outlineWidth = await skip.evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(outlineWidth).not.toBe("0px");
  await expect(skip).toBeInViewport();

  await page.keyboard.press("Enter");
  const movedIntoMain = await page.evaluate(() => {
    const main = document.getElementById("portal-main");
    return (
      main !== null && (main.contains(document.activeElement) || location.hash === "#portal-main")
    );
  });
  expect(movedIntoMain).toBe(true);
});

test("keyboard-only flow: insertion keeps focus + announces, removal announces, submit completes", async ({
  page,
}) => {
  const { slug } = readFixtures();

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
  await waitForHydration(page);

  const announcer = page.getByTestId("flow-announcer");

  await keyboardChoose(page, "Yes");
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeFocused();
  await expect(announcer).toHaveText("1 question was added below.");
  await expect(page.getByRole("textbox", { name: /how many/i })).toBeEnabled();

  await keyboardChoose(page, "No");
  await expect(page.getByText(COUNT_LABEL)).toHaveCount(0);
  await expect(announcer).toHaveText("You have answered everything. You can now submit.");

  const primary = page.getByTestId("primary-action");
  await expect(primary).toHaveText("Submit");
  await expect(primary).toBeEnabled();
  await expect(async () => {
    await primary.press("Enter");
    await expect(page).toHaveURL(/\/done/, { timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await expect(page.getByText("Thank you, your responses were received")).toBeVisible();
});

test("keyboard: kitchen-sink Continue gate is keyboard-operable", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  const primary = page.getByTestId("primary-action");
  await expect(primary).toHaveText("Continue");
  await expect(page.getByTestId("back-action")).toHaveCount(0);

  await primary.focus();
  await expect(primary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.getByRole("heading", { name: "About you" })).toBeVisible();
});

test("keyboard: a later step's radio group is still reachable after Continue (#144)", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await chooseRadio(page, "Yes");
  await answerNumber(page, "10");
  await checkOption(page, "Breakdown");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();

  const first = page.getByRole("radio").first();
  await expect(first).toHaveAttribute("tabindex", "0");
  const recorded = page.waitForResponse(
    (r) => r.url().includes("/answers") && r.request().method() === "POST" && r.status() === 200,
  );
  await first.press("Space");
  await expect(first).toBeChecked();
  await recorded;
});
