import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { censusConsole } from "./support/console-census.js";
import { readFixtures } from "./support/fixtures.js";
import { browserConsoleFault } from "./support/gates.js";
import { waitForHydration } from "./support/hydration.js";
import { KS, startKitchenSink } from "./support/kitchen-sink.js";

/** The questionId of the field wrapper the focused control sits in, if any. */
function focusedQuestion(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.activeElement?.closest<HTMLElement>("[data-qcms-field]")?.dataset.qcmsField ?? null,
  );
}

test("error summary: each link names its own field and jumps to it", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();

  const census = censusConsole(page);

  await startKitchenSink(page, kitchenSinkSlug);

  await page.getByTestId("primary-action").click();
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();

  const links = summary.getByRole("link");
  await expect(links).toHaveCount(2);
  const fullName = summary.getByRole("link", { name: `${KS.fullName} needs an answer.` });
  const dob = summary.getByRole("link", { name: `${KS.dob} needs an answer.` });
  await expect(fullName).toHaveCount(1);
  await expect(dob).toHaveCount(1);

  await expect(fullName).toHaveAttribute("href", "#q_full_name");
  await expect(dob).toHaveAttribute("href", "#q_dob");

  await fullName.click();
  expect(await focusedQuestion(page)).toBe("q_full_name");
  await expect(page.getByRole("textbox", { name: KS.fullName })).toBeFocused();

  await page.evaluate(() => {
    console.info("qcms-census-probe");
  });
  expect(
    census.of("info"),
    "the census must observe messages, and must type the level rather than parse it",
  ).toContain("qcms-census-probe");

  test.info().annotations.push({ type: "console-census", description: census.report() });

  const wouldFail = census
    .messages()
    .filter((message) => browserConsoleFault(message.level, message.text) !== null)
    .map((message) => `${message.level}: ${message.text}`);
  expect(wouldFail, "console messages this spec produced that the gate would fail on").toEqual([]);
});

test("error summary: identical custom messages still have distinct accessible names", async ({
  page,
}) => {
  const { authorMessagesSlug } = readFixtures();
  await page.goto(`/f/${authorMessagesSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByRole("textbox", { name: "Registration plate" })).toBeVisible();
  await waitForHydration(page);

  await page.getByTestId("primary-action").click();
  const summary = page.getByTestId("error-summary");
  await expect(summary).toBeVisible();

  const plate = summary.getByRole("link", {
    name: "Registration plate: Check the vehicle paperwork",
  });
  const vin = summary.getByRole("link", { name: "VIN: Check the vehicle paperwork" });
  await expect(plate).toHaveCount(1);
  await expect(vin).toHaveCount(1);
  await expect(plate).toHaveAttribute("href", "#q_am_plate");
  await expect(vin).toHaveAttribute("href", "#q_am_vin");

  const names = await summary
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.textContent?.trim() ?? ""));
  expect(names).toHaveLength(4);
  expect(new Set(names).size).toBe(4);

  await vin.click();
  expect(await focusedQuestion(page)).toBe("q_am_vin");
});
