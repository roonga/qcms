/**
 * The hydration wait every entry helper owns, tested as harness plumbing in its own
 * right. Three things have to hold, none of them visible from a passing flow spec.
 *
 * The marker cannot lie: it is stamped from a mount effect, so it is absent from a
 * server render by construction, and the first test asserts that against the real SSR
 * bytes, because "an effect cannot run on the server" stops being the whole story the
 * moment someone hand-adds the attribute to a rendered element.
 *
 * It cannot pass vacuously: the portal server-renders a fillable fallback form, so a
 * wait that polled for something already true of that markup would protect nothing. The
 * negative half is driven against the real step with its script requests starved over
 * the network, which an earlier version faked by editing the SSR HTML string, fragile
 * and flagged as unsafe HTML handling.
 *
 * And an entry helper's first interaction is not silently discarded: the last test
 * throttles the CPU to widen the gap before React attaches. The mechanism, for whoever
 * debugs this next, is that the pre-hydration click checks the fallback form's native
 * radio, React replaces that markup, the checked state goes with it and no answer is
 * ever posted. Nothing fails at the click; the red arrives as a timeout inside whichever
 * helper awaited the first post.
 */

import { expect, test } from "./support/gates.js";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, COUNT_LABEL, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { starveScripts } from "./support/script-starve.js";
import { HYDRATED_ATTRIBUTE } from "../lib/hydration.js";

/**
 * Hydration is scheduled work, so throttling the CPU stretches the window from
 * sub-frame to seconds without touching the network or the helper under test. Emulated
 * slowness is the point: it makes an intermittent race deterministic, and at this rate
 * the un-waited helper handed back an inert page every run.
 */
const CPU_THROTTLE_RATE = 6;

/** How long the wait is given on a page that must never satisfy it. */
const REJECTION_BUDGET_MS = 3_000;

/**
 * How long the wait is given on a page that MUST satisfy it. Deliberately far below
 * the suite default: a positive half that leaned on the default timeout would still
 * pass if the marker only ever arrived at the last possible moment, which is not the
 * claim being made.
 */
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
