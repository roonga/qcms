import { expect, test } from "./support/gates.js";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, COUNT_LABEL, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { starveScripts } from "./support/script-starve.js";
import { HYDRATED_ATTRIBUTE } from "../lib/hydration.js";

const CPU_THROTTLE_RATE = 6;

/** How long the wait is given on a page that must never satisfy it. */
const REJECTION_BUDGET_MS = 3_000;

const RESOLUTION_BUDGET_MS = 15_000;

test("the hydration wait rejects on server-rendered markup and resolves once React attaches", async ({
  page,
}) => {
  const { slug } = readFixtures();

  const starvation = await starveScripts(page);

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  const stepUrl = page.url();

  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved",
  ).toBeGreaterThan(0);

  const served = await page.request.get(stepUrl);
  expect(served.ok(), "the step page must be served successfully to be inspected").toBe(true);
  expect(
    await served.text(),
    "the hydration marker must never appear in server-rendered HTML",
  ).not.toContain(HYDRATED_ATTRIBUTE);

  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeAttached();
  await expect(page.getByTestId("step-card").locator("button[type='submit']")).toBeVisible();

  let failure = "";
  try {
    await waitForHydration(page, { timeout: REJECTION_BUDGET_MS });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure, "the wait must fail on markup React never attached to").toMatch(/timeout/i);

  starvation.restore();
  await page.goto(stepUrl);
  await waitForHydration(page, { timeout: RESOLUTION_BUDGET_MS });

  await expect(page.getByTestId("primary-action")).toBeVisible();
});

test("the hydration wait works on the entry page, which has no primary action", async ({
  page,
}) => {
  const { slug } = readFixtures();

  const starvation = await starveScripts(page);
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved",
  ).toBeGreaterThan(0);

  let failure = "";
  try {
    await waitForHydration(page, { timeout: REJECTION_BUDGET_MS });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure, "the entry page must not report hydration it never performed").toMatch(
    /timeout/i,
  );

  starvation.restore();
  await page.goto(`/f/${slug}`);
  await waitForHydration(page, { timeout: RESOLUTION_BUDGET_MS });
});

test("startAnonymousFlow's first interaction still posts when hydration is slow", async ({
  page,
}) => {
  const { slug } = readFixtures();

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE });
  try {
    await startAnonymousFlow(page, slug);
    await chooseAccident(page, "Yes");
  } finally {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }

  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
});
