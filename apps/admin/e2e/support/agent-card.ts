import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { rulesNotRun } from "@roonga/qcms-e2e-support/axe";

import { openDbHandle } from "../../../api/e2e/support/index.js";
import { expect } from "../../../portal/e2e/support/gates.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

import { fillStable } from "./flow.js";
import { waitForHydration } from "./hydration.js";

// Use the same accessibility rule set as the full-screen sweep.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EXTRA_RULES = { "heading-order": { enabled: true } };

export function panel(page: Page): Locator {
  return page.getByTestId("qcms-assistant-panel");
}

export function card(page: Page): Locator {
  return page.locator(".qcms-acard");
}

export function cardChip(page: Page): Locator {
  return card(page).locator(".qcms-acard__head .qcms-acard__state");
}

export function cardSteps(page: Page): Locator {
  return card(page).locator(".qcms-acard__step");
}

export function stepChips(page: Page): Locator {
  return cardSteps(page).locator(".qcms-acard__state");
}

export async function openPanel(page: Page): Promise<void> {
  await waitForHydration(page);
  if (!(await panel(page).isVisible())) await page.getByTestId("qcms-assistant-button").click();
  await expect(panel(page)).toBeVisible();
}

// The fake model derives action arguments from the current screen's fixtures.
export async function propose(page: Page, script: string, message: string): Promise<void> {
  await fillStable(page.getByTestId("qcms-assistant-composer"), `#qcms-fake:${script} ${message}`);
  await page.getByTestId("qcms-assistant-send").locator("button").click();
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
  await expect(cardChip(page)).toHaveText("Proposed");
}

export function confirmButton(page: Page): Locator {
  return card(page).getByRole("button", { name: /^Confirm/u });
}

export async function confirm(page: Page, expected: RegExp): Promise<void> {
  await confirmButton(page).click();
  await expect(card(page).locator(".qcms-acard__result")).toHaveText(expected, {
    timeout: 60_000,
  });
}

export async function typeConfirmation(page: Page, value: string): Promise<void> {
  await expect(confirmButton(page)).toBeDisabled();
  await fillStable(card(page).getByRole("textbox", { name: /^Type the/u }), value);
  await expect(confirmButton(page)).toBeEnabled();
}

export function createdLink(page: Page): Locator {
  return card(page).getByRole("link", { name: "Open what this created" });
}

export function irreversibleBand(page: Page): Locator {
  return card(page).locator(".qcms-acard__band[data-kind='irreversible']");
}

export async function cancel(page: Page): Promise<void> {
  await card(page).getByRole("button", { name: "Cancel" }).click();
  await expect(card(page).locator(".qcms-acard__result")).toHaveText(
    "Cancelled by you. Nothing was sent.",
  );
}

// Waiting steps expose their state to assistive technology without rendering visible state chips.
export async function expectWaitingStepStates(page: Page, word: string): Promise<void> {
  await expect(stepChips(page)).toHaveCount(0);
  const steps = cardSteps(page);
  for (let index = 0; index < (await steps.count()); index += 1) {
    await expect(steps.nth(index)).toContainText(word);
  }
}

export async function expectStepChips(page: Page, words: readonly string[]): Promise<void> {
  await expect(stepChips(page)).toHaveText([...words]);
}

async function layout(locator: Locator): Promise<{ x: number; width: number }> {
  const found = await locator.boundingBox();
  expect(found, "the element should be laid out").not.toBeNull();
  return { x: found?.x ?? 0, width: found?.width ?? 0 };
}

// A step detail auto-placed into the icon track renders as a sliver at the card's left edge.
export async function expectStepDetailsFillStep(page: Page): Promise<void> {
  const steps = cardSteps(page);
  let checked = 0;
  for (let index = 0; index < (await steps.count()); index += 1) {
    const step = steps.nth(index);
    const detail = step.locator(".qcms-acard__definition");
    if ((await detail.count()) === 0) continue;
    const detailBox = await layout(detail);
    const titleBox = await layout(step.locator(".qcms-acard__what"));
    const stepBox = await layout(step);
    expect(
      Math.abs(detailBox.x - titleBox.x),
      `step ${String(index + 1)} detail should start under the step text`,
    ).toBeLessThanOrEqual(1);
    expect(
      detailBox.width,
      `step ${String(index + 1)} detail should use the step's width`,
    ).toBeGreaterThan(stepBox.width * 0.6);
    checked += 1;
  }
  expect(checked, "the card should show at least one step detail").toBeGreaterThan(0);
}

async function auditedKinds(): Promise<readonly string[]> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    const rows = await handle.query(`select kind from control."agent_actions"`);
    return rows.rows.map((row) => String((row as Record<string, unknown>)["kind"]));
  } finally {
    await handle.close();
  }
}

// Pinned timestamps can tie across actions; compare counts instead of assuming row order.
export async function auditTally(): Promise<Readonly<Record<string, number>>> {
  const tally: Record<string, number> = {};
  for (const kind of await auditedKinds()) tally[kind] = (tally[kind] ?? 0) + 1;
  return tally;
}

export function auditDelta(
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const delta: Record<string, number> = {};
  for (const kind of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const added = (after[kind] ?? 0) - (before[kind] ?? 0);
    if (added !== 0) delta[kind] = added;
  }
  return delta;
}

export async function expectAxeClean(
  page: Page,
  state: string,
  root = ".qcms-acard",
): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const results = await new AxeBuilder({ page })
    .include(root)
    .options({ runOnly: { type: "tag", values: TAGS }, rules: EXTRA_RULES })
    .analyze();
  expect(
    rulesNotRun(results, Object.keys(EXTRA_RULES)),
    `axe did not load these rules on the ${state} card`,
  ).toEqual([]);
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} [${violation.nodes
          .map((node) => `${node.target.join(" ")} - ${node.failureSummary ?? ""}`)
          .join(" | ")}]`,
    ),
    `axe violations on the ${state} card`,
  ).toEqual([]);
}
