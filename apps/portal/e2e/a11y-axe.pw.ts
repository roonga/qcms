/**
 * An axe scan of every portal page state in the fixture walkthrough, not just the first
 * render. axe runs inside the real cookie-bearing browser context, which is why it, not
 * Lighthouse, covers the scripted states.
 *
 * Each scan asserts zero violations and that axe really ran rules, so a misconfigured
 * builder cannot pass vacuously, and records the rule counts as an annotation so a
 * report reader can see both renders were exercised.
 *
 * The portal server-renders a native no-JS form that React replaces wholesale on
 * hydration, so each page names two DOMs and every scan below says which it audits. The
 * entry page and each step are audited in both renders: a respondent with scripting off
 * sees the fallback, and WCAG applies to them too. The fallback scans are what cover the
 * qcms-owned markup no vendored control provides, such as the native date boxes, the
 * per-field missing-required message and the required checkbox group's ARIA encoding.
 */

import AxeBuilder from "@axe-core/playwright";
import { rulesNotRun } from "@roonga/qcms-e2e-support/axe";
import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { COUNT_LABEL, answerCount, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { fillNativeDate, submitStep, walkToCoverStep } from "./support/no-js.js";
import { starveScripts } from "./support/script-starve.js";
import {
  KS,
  answerNumber,
  chooseRadio,
  checkOption,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

/** WCAG 2.2 AA, the same rule set the admin gate uses. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * Rules run in addition to the tag set above.
 *
 * `label-content-name-mismatch` is WCAG 2.5.3's label-in-name check, and axe keeps it out
 * of a tag-selected run by its `experimental` tag rather than by being disabled, so it
 * has to be named explicitly. The class is live here, because `kit.Menu` turns a trigger
 * label into an `aria-label` and an `aria-label` replaces the content it sits on in the
 * name computation.
 *
 * `runOnly` and `rules` go in one `options()` call rather than through `withTags`:
 * `AxeBuilder#options` replaces its accumulated option object, so `withTags` before it
 * would be silently dropped, and axe consults an explicit `rules[id].enabled` before the
 * tag filter, which is what lets a tag-excluded rule join the run.
 */
const EXTRA_RULES = { "label-content-name-mismatch": { enabled: true } };

/**
 * The label names the page state and the render, because a scan that does not say which
 * of the two DOMs it audited is not reproducible evidence.
 */
async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS }, rules: EXTRA_RULES })
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  test.info().annotations.push({
    type: "axe",
    description: `${label}: ${results.passes.length} rules passed, ${results.violations.length} violations, ${results.incomplete.length} incomplete`,
  });
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
  expect(
    rulesNotRun(results, Object.keys(EXTRA_RULES)),
    `axe did not load these rules at "${label}": the tag selection alone drops them, so EXTRA_RULES is what puts them in the run and it is not reaching axe`,
  ).toEqual([]);
}

test("axe: the entry page's HYDRATED render has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await waitForHydration(page);
  await expectNoAxeViolations(page, "entry (hydrated render)");
});

test("axe: the entry page's no-JS FALLBACK render has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  const starvation = await starveScripts(page);
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this scans the hydrated render",
  ).toBeGreaterThan(0);
  await expectNoAxeViolations(page, "entry (no-JS fallback render)");
});

test("axe: the no-JS FALLBACK step, with the native date input, has zero violations", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await page.goto(`/f/${kitchenSinkSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  const day = page.locator('[data-qcms-field] input[data-qcms-date-part="day"]');
  await expect(day).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this scans the hydrated render",
  ).toBeGreaterThan(0);
  await expect(page.locator('[data-qcms-field] [role="spinbutton"]')).toHaveCount(0);

  await expectNoAxeViolations(page, "step 1 clean (no-JS fallback render)");

  const sessionId = new URL(page.url()).pathname.split("/")[2] ?? "";
  const posted = await page.request.post(`/s/${sessionId}/step`, {
    headers: { "sec-fetch-site": "same-origin" },
    form: {
      __qk__q_full_name: "string",
      q_full_name: "Ada Lovelace",
      __qk__q_dob: "string",
      q_dob: "",
    },
    maxRedirects: 0,
  });
  expect(posted.status()).toBe(303);

  await page.goto(`/s/${sessionId}`);
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.locator('[data-qcms-field] input[data-qcms-date-part="day"]')).toBeVisible();
  await expectNoAxeViolations(page, "step 1 missing required (no-JS fallback render)");
});

test("axe: the no-JS FALLBACK step holding a required group and a native number is clean", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await page.goto(`/f/${kitchenSinkSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await page.locator('input[name="q_full_name"]').fill("Ada Lovelace");
  await fillNativeDate(page, "q_dob", "1990-05-17");
  await submitStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this scans the hydrated render",
  ).toBeGreaterThan(0);

  const boxes = page.locator('input[type="checkbox"][name="q_optional_cover"]');
  await expect(boxes).toHaveCount(3);
  await expect(boxes.first()).toHaveAttribute("aria-required", "true");
  await expectNoAxeViolations(page, "step 2 clean (no-JS fallback render)");

  await page.getByText("Yes", { exact: true }).click();
  await submitStep(page);
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.locator('input[type="number"][name="q_accident_count"]')).toBeVisible();
  await expectNoAxeViolations(page, "step 2 missing required (no-JS fallback render)");
});

test("axe: the no-JS FALLBACK step holding the native single-choice selects is clean", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await walkToCoverStep(page, kitchenSinkSlug);
  await expect(page.getByRole("heading", { name: "Your cover" })).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this scans the hydrated render",
  ).toBeGreaterThan(0);

  await expect(page.locator('select[name="q_body_type"]')).toBeVisible();
  await expect(page.locator('[aria-haspopup="listbox"]')).toHaveCount(0);

  await expectNoAxeViolations(page, "step 3 clean (no-JS fallback render)");

  const sessionId = new URL(page.url()).pathname.split("/")[2] ?? "";
  const posted = await page.request.post(`/s/${sessionId}/step`, {
    headers: { "sec-fetch-site": "same-origin" },
    form: {
      __qk__q_coverage_level: "radio",
      q_coverage_level: "opt_standard",
      __qk__q_body_type: "string",
      q_body_type: "",
    },
    maxRedirects: 0,
  });
  expect(posted.status()).toBe(303);

  await page.goto(`/s/${sessionId}`);
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.locator('select[name="q_body_type"][aria-invalid="true"]')).toBeVisible();
  await expectNoAxeViolations(page, "step 3 missing required (no-JS fallback render)");
});

test("axe: flow initial, branch-inserted, and branch-removed states have zero violations", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  await expectNoAxeViolations(page, "flow initial (hydrated render)");

  await chooseAccident(page, "Yes");
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
  await expectNoAxeViolations(page, "branch inserted (count visible)");

  await chooseAccident(page, "No");
  await expect(page.getByText(COUNT_LABEL)).toHaveCount(0);
  await expectNoAxeViolations(page, "branch removed (count gone)");
});

test("axe: blocked-submit error-summary state has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expectNoAxeViolations(page, "blocked submit (error summary)");
});

test("axe: kitchen-sink flow states (six of seven types + a branch) have zero violations", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  await expectNoAxeViolations(page, "kitchen-sink step 1 (short text + date)");

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await chooseRadio(page, "Yes");
  await answerNumber(page, "10");
  await checkOption(page, "Breakdown");
  await checkOption(page, "Windscreen");
  await expect(page.getByRole("textbox", { name: KS.extraDetail })).toBeVisible();
  await expectNoAxeViolations(page, "kitchen-sink step 2 branch-inserted (all four types)");
});

test("axe: completion page has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  await chooseAccident(page, "Yes");
  await answerCount(page, "1");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toBeVisible();
  await waitForHydration(page);
  await expectNoAxeViolations(page, "completion (hydrated render)");
});

/**
 * Asserts the roster write's status rather than waiting for a 200, which would turn a
 * belt refusal or a rate limit into a bare timeout with nothing to act on.
 */
async function pressRoster(page: Page, name: string): Promise<void> {
  const written = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/roster$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name }).click();
  expect((await written).status(), `POST /roster for "${name}"`).toBe(200);
}

test("a repeating group is axe-clean at one instance, at three, and after a removal", async ({
  page,
}) => {
  const { repeatFleetSlug } = readFixtures();
  await page.goto(`/f/${repeatFleetSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Vehicle 1" })).toBeVisible();
  await expectNoAxeViolations(page, "repeating group at min (hydrated)");

  await pressRoster(page, "Add Vehicle");
  await pressRoster(page, "Add Vehicle");
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Add Vehicle" })).toBeDisabled();
  await expectNoAxeViolations(page, "repeating group at max, three instances");

  await pressRoster(page, "Remove Vehicle 2");
  await expect(page.locator("fieldset[data-qcms-instance]")).toHaveCount(2);
  await expectNoAxeViolations(page, "repeating group after a removal, renumbered");
});

test("a FILLED table-presented group is axe-clean at every viewport project", async ({ page }) => {
  const { repeatTableSlug } = readFixtures();
  await page.goto(`/f/${repeatTableSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await waitForHydration(page);
  await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(1);

  await pressRoster(page, "Add Vehicle");
  await expect(page.locator("tbody tr[data-qcms-instance]")).toHaveCount(2);

  const fill = async (ordinal: number, column: string, label: string, value: string) => {
    const posted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.status() === 200 &&
        /\/answers$/.test(new URL(response.url()).pathname),
    );
    const field = page
      .locator("tbody tr[data-qcms-instance]")
      .nth(ordinal - 1)
      .locator(`td[data-qcms-column="${column}"]`)
      .getByRole("textbox", { name: `Vehicle ${String(ordinal)}, ${label}` });
    await field.fill(value);
    await field.blur();
    await posted;
  };
  await fill(1, "q_rt_plate", "Registration plate", "AAA111");
  await fill(1, "q_rt_odometer", "Odometer reading", "1200");
  await fill(2, "q_rt_plate", "Registration plate", "BBB222");
  await expect(page.locator('tfoot td[data-qcms-column="q_rt_odometer"]')).toContainText("1,200");
  await expectNoAxeViolations(page, "table presentation, filled, with a column total");
});
