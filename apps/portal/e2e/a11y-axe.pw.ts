/**
 * Automated accessibility scan (axe) across EVERY portal page state in the
 * vehicle-insurance fixture walkthrough (task 030, exit criterion 1), not just
 * the first render: entry, initial flow, post-branch-INSERTION, post-branch-
 * REMOVAL, the blocked-submit error-summary state, and completion. axe runs
 * inside the real, cookie-bearing Playwright browser context, which is why it -
 * not Lighthouse - is the tool that covers the interactive (JS-only) states.
 *
 * Each scan asserts zero violations AND that axe actually ran real rules
 * (`passes` is non-empty), so a misconfigured builder can never pass vacuously.
 *
 * WHICH RENDER EACH SCAN AUDITS (issue #160)
 * The portal server-renders a real native no-JS form which React then replaces
 * WHOLESALE on hydration (029, #121), so "the entry page" and "the flow page" each
 * name two different DOMs. Every scan below now says which one it is looking at:
 *
 * - The flow, error-summary, kitchen-sink and completion scans audit the HYDRATED
 *   render. They always did in practice - each enters through a helper that waits
 *   for hydration, or interacts in a way only the React render supports - but the
 *   completion scan was relying on a navigation rather than on a wait, so it now
 *   asks explicitly.
 * - The entry page is audited TWICE, once per render. It could not be audited at
 *   all in its hydrated state until #159, because the wait keyed on a step control
 *   this page does not render. Auditing only the hydrated one would have been the
 *   wrong trade: a respondent with JavaScript off sees the fallback, and WCAG
 *   applies to them too.
 * - A STEP's fallback render is audited too, since issue #920, clean and in its
 *   missing-required state. The entry page was the only fallback scanned before, and
 *   it carries no input control, so two things had no axe pass anywhere: the native
 *   day input a date question renders on this transport, whose label, description and
 *   error slot are qcms-owned markup rather than the vendored control's; and the
 *   per-field missing-required message, which only this transport draws.
 *
 * Each scan records the rule counts it observed as a test annotation, so a report
 * reader can see that both renders were really exercised rather than that one of
 * them silently scanned an empty page.
 */

import AxeBuilder from "@axe-core/playwright";
import { rulesNotRun } from "@roonga/qcms-e2e-support/axe";
import { expect, test } from "./support/gates.js";
import type { Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { COUNT_LABEL, answerCount, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { submitStep } from "./support/no-js.js";
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
 * Rules run **in addition** to the tag set above (issue #943).
 *
 * `label-content-name-mismatch` is the WCAG 2.5.3 label-in-name check: where a control
 * carries visible text, that text has to be part of its accessible name, or a speech-input
 * operator saying what they can read targets nothing and a screen-reader operator hears a
 * name no sighted colleague can point at. It is kept out of a tag-selected run **by tag,
 * not by a disabled rule**: in axe-core 4.13.0 its descriptor carries `wcag21a` and
 * `wcag253` and no `enabled` key at all, and what keeps it out is the `experimental` tag,
 * which `axe._audit.tagExclude` subtracts from every tag-selected run. (`axe.getRules()`
 * reports `enabled: false` for it, but that field is DERIVED from the same tag exclusion,
 * so reading it is what makes the rule look like a rule someone turned off.)
 *
 * The defect class is real in this codebase - the admin's pin control painted `v3` and
 * answered to "Move pin for q_at_fault_accident" until issue #879, with this sweep's
 * admin twin watching and silent - and it is a class the portal can grow at any time,
 * because `kit.Menu` turns `triggerLabel` into an `aria-label` and an `aria-label`
 * REPLACES the content it sits on in the name computation. Verified falsifiable before it
 * was switched on: on that exact pre-#879 markup the rule reports a violation with this
 * hook and reports nothing without it, and the markup #879 shipped passes.
 *
 * `runOnly` and `rules` go in one `options()` call rather than through `withTags`:
 * `AxeBuilder#options` **replaces** its accumulated option object, so
 * `.withTags(...).options(...)` would silently drop the tags, and `withRules` is
 * documented as mutually exclusive with `withTags`. Inside axe-core `ruleShouldRun`
 * consults an explicit `rules[id].enabled` BEFORE the `runOnly` tag filter, which is what
 * lets a tag-excluded rule join a tag-selected run.
 */
const EXTRA_RULES = { "label-content-name-mismatch": { enabled: true } };

/**
 * Run axe on the current page state; fail on any violation, prove it ran.
 *
 * The label names the page state AND the render, because a scan that does not say
 * which of the two DOMs it audited is not reproducible evidence. The rule counts go
 * into the test report for the same reason: `passes.length > 0` proves axe ran, and
 * the recorded number is what lets a reader compare two renders after the fact.
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
  // Guard against a vacuous pass: axe must have exercised real rules here.
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
  // And against the narrower vacuous pass the extra rules can have on their own
  // (issue #943). A misspelt id is not the hole this closes - axe itself throws "unknown
  // rule `x` in options.rules", verified by misspelling one. The hole is the option map
  // going missing while the id in it stays correct: `AxeBuilder#options` REPLACES the
  // accumulated option object, so an edit that reaches back for `.withTags(TAGS)` takes
  // `rules` with it, the extra rule silently leaves the run, and this sweep stays green
  // while measuring less than its comments say it does. That failure was reproduced
  // against this assertion before it was committed.
  expect(
    rulesNotRun(results, Object.keys(EXTRA_RULES)),
    `axe did not load these rules at "${label}": the tag selection alone drops them, so EXTRA_RULES is what puts them in the run and it is not reaching axe`,
  ).toEqual([]);
}

test("axe: the entry page's HYDRATED render has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  // The render a JS respondent audits against. Impossible to ask for here before
  // #159: this page renders no `primary-action`, so the old testid probe could only
  // time out on it, which is precisely why this scan used to measure whichever
  // render happened to be on screen.
  await waitForHydration(page);
  await expectNoAxeViolations(page, "entry (hydrated render)");
});

test("axe: the entry page's no-JS FALLBACK render has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  // Scripts starved rather than `javaScriptEnabled: false`, because axe itself runs
  // by injecting and evaluating script in the page: with scripting off there is
  // nothing to scan with. Starving only the app bundle leaves axe working while
  // React never runs. See `support/script-starve.ts`.
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

  // The no-JS render of a STEP, which no scan reached before issue #920: the entry
  // page's fallback was the only one audited, and the entry page carries no input
  // control at all. Two things on this render exist nowhere else and so were never
  // scanned. The date question is a qcms-owned `<input type="date">` rather than the
  // vendored picker (`packages/ui/src/native-date-field.tsx`), with a hand-written
  // label association, description and error slot - markup that a manual read found
  // correct and that nothing was watching. And the missing-required report draws a
  // summary plus a per-field message on this transport only.
  //
  // Scripts starved rather than `javaScriptEnabled: false`, because axe runs by
  // injecting and evaluating script in the page: with scripting off there is nothing to
  // scan with (see `support/script-starve.ts`, and the entry-page fallback scan above).
  const starvation = await starveScripts(page);
  await page.goto(`/f/${kitchenSinkSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  const day = page.locator('[data-qcms-field] input[type="date"]');
  await expect(day).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this scans the hydrated render",
  ).toBeGreaterThan(0);
  // Which render is on screen, asserted rather than assumed: the hydrated one has
  // spinbutton segments and no day input.
  await expect(page.locator('[data-qcms-field] [role="spinbutton"]')).toHaveCount(0);

  await expectNoAxeViolations(page, "step 1 clean (no-JS fallback render)");

  // The missing-required state, reached by posting the step with the required date
  // empty. It takes a hand-built post because the ruling KEPT browser validation, so
  // the browser refuses this submission from the page itself (issue #920,
  // `no-js-required.pw.ts`) - the state is real, and a client that ignores `required`
  // is how a respondent reaches it.
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
  await expect(page.locator('[data-qcms-field] input[type="date"]')).toBeVisible();
  await expectNoAxeViolations(page, "step 1 missing required (no-JS fallback render)");
});

test("axe: the no-JS FALLBACK step holding a required group and a native number is clean", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  // The step the scan above could not reach, and the two controls issues #974 and #18
  // changed. The multi-choice group's boxes now carry `aria-required` rather than the
  // native attribute, which is an ARIA change and therefore exactly the kind axe has
  // an opinion about; the number question is a qcms-owned `<input type="number">` with
  // a hand-written label association, description and error slot
  // (`packages/ui/src/native-number-field.tsx`), the same markup class the day input
  // above is scanned for. Both are scanned clean and in the state the server's report
  // puts them in.
  const starvation = await starveScripts(page);
  await page.goto(`/f/${kitchenSinkSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  await page.locator('input[name="q_full_name"]').fill("Ada Lovelace");
  await page.locator('input[name="q_dob"]').fill("1990-05-17");
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

  // Answer the branch question and submit with the required group still blank. Both
  // halves of the state arrive in one round trip: the number follow-up appears, and
  // the server reports the group nobody answered. Before issue #974 this submission
  // never left the page, so neither state existed to scan.
  await page.getByText("Yes", { exact: true }).click();
  await submitStep(page);
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expect(page.locator('input[type="number"][name="q_accident_count"]')).toBeVisible();
  await expectNoAxeViolations(page, "step 2 missing required (no-JS fallback render)");
});

test("axe: flow initial, branch-inserted, and branch-removed states have zero violations", async ({
  page,
}) => {
  const { slug } = readFixtures();
  // `startAnonymousFlow` waits for hydration, so every scan in this test audits the
  // hydrated render. The fallback's own geometry and structure are covered by
  // `a11y-visual.pw.ts` and the no-JS specs.
  await startAnonymousFlow(page, slug);
  await expectNoAxeViolations(page, "flow initial (hydrated render)");

  // Branch INSERTION: choosing "Yes" makes the follow-up count question visible.
  await chooseAccident(page, "Yes");
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
  await expectNoAxeViolations(page, "branch inserted (count visible)");

  // Branch REMOVAL: changing to "No" drops the follow-up again.
  await chooseAccident(page, "No");
  await expect(page.getByText(COUNT_LABEL)).toHaveCount(0);
  await expectNoAxeViolations(page, "branch removed (count gone)");
});

test("axe: blocked-submit error-summary state has zero violations", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  // The required accident question is unanswered, so the primary action surfaces
  // the error summary instead of submitting.
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  await expectNoAxeViolations(page, "blocked submit (error summary)");
});

test("axe: kitchen-sink flow states (six of seven types + a branch) have zero violations", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  // Step 1: short text + date.
  await expectNoAxeViolations(page, "kitchen-sink step 1 (short text + date)");

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  // Step 2: boolean + number + multi-choice + (revealed) long text.
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
  // Shortest complete path: "Yes" then a count, then submit.
  await chooseAccident(page, "Yes");
  await answerCount(page, "1");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);
  await expect(page.getByTestId("content-hash")).toBeVisible();
  // The completion screen is a fresh navigation, so the wait is asked for
  // explicitly rather than inherited from the entry helper (issue #160). `/done`
  // has no primary action either, so this is a second scan the old testid probe
  // could not have served.
  await waitForHydration(page);
  await expectNoAxeViolations(page, "completion (hydrated render)");
});
