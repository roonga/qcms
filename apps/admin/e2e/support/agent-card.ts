import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { rulesNotRun } from "@roonga/qcms-e2e-support/axe";

import { openDbHandle } from "../../../api/e2e/support/index.js";
import { expect } from "../../../portal/e2e/support/gates.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

import { fillStable } from "./flow.js";
import { waitForHydration } from "./hydration.js";

/**
 * What every screen group's action-card spec needs: the panel, one scripted proposal, the
 * card's own controls and states, the audit rows the confirmed act leaves, and axe.
 *
 * It lives here rather than in each spec because criterion 11 is the same walk on every
 * screen and only the fixtures and the "the screen changed" assertion differ: a second
 * copy of the walk is how two screen groups come to assert different things about the
 * same card.
 */

/** The tag set `e2e/a11y-axe.pw.ts` sweeps with, so a card is measured at the same bar. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const EXTRA_RULES = { "heading-order": { enabled: true } };

export function panel(page: Page): Locator {
  return page.getByTestId("qcms-assistant-panel");
}

export function card(page: Page): Locator {
  return page.locator(".qcms-acard");
}

/** The card's own heading chip, which says the card's state once. */
export function cardChip(page: Page): Locator {
  return card(page).locator(".qcms-acard__head .qcms-acard__state");
}

export function cardSteps(page: Page): Locator {
  return card(page).locator(".qcms-acard__step");
}

/** The state chips each step shows from Confirm onwards, and in no waiting state. */
export function stepChips(page: Page): Locator {
  return cardSteps(page).locator(".qcms-acard__state");
}

/** Opens the panel if the cookie did not bring it back open. */
export async function openPanel(page: Page): Promise<void> {
  await waitForHydration(page);
  if (!(await panel(page).isVisible())) await page.getByTestId("qcms-assistant-button").click();
  await expect(panel(page)).toBeVisible();
}

/**
 * Sends one scripted turn and waits for the card it proposes. The fake model takes the
 * kind's arguments from the screen facts the API already computed, so a spec only has to
 * be standing on the right screen with the right fixtures.
 */
export async function propose(page: Page, script: string, message: string): Promise<void> {
  await fillStable(page.getByTestId("qcms-assistant-composer"), `#qcms-fake:${script} ${message}`);
  await page.getByTestId("qcms-assistant-send").locator("button").click();
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
  await expect(cardChip(page)).toHaveText("Proposed");
}

export function confirmButton(page: Page): Locator {
  return card(page).getByRole("button", { name: /^Confirm/u });
}

/** Confirm, and wait for the card to settle on its own result line. */
export async function confirm(page: Page, expected: RegExp): Promise<void> {
  await confirmButton(page).click();
  await expect(card(page).locator(".qcms-acard__result")).toHaveText(expected, {
    timeout: 60_000,
  });
}

/** The typed confirmation a card asks for before its Confirm is enabled. */
export async function typeConfirmation(page: Page, value: string): Promise<void> {
  await expect(confirmButton(page)).toBeDisabled();
  await fillStable(card(page).getByRole("textbox", { name: /^Type the/u }), value);
  await expect(confirmButton(page)).toBeEnabled();
}

/** The link a create step's card offers to what it made. */
export function createdLink(page: Page): Locator {
  return card(page).getByRole("link", { name: "Open what this created" });
}

/** The card-level band a plan carrying an act with no inverse shows once. */
export function irreversibleBand(page: Page): Locator {
  return card(page).locator(".qcms-acard__band[data-kind='irreversible']");
}

export async function cancel(page: Page): Promise<void> {
  await card(page).getByRole("button", { name: "Cancel" }).click();
  await expect(card(page).locator(".qcms-acard__result")).toHaveText(
    "Cancelled by you. Nothing was sent.",
  );
}

/**
 * While a card waits, no step shows a visible chip and each step still carries its state
 * word for assistive technology (issue #1131).
 */
export async function expectWaitingStepStates(page: Page, word: string): Promise<void> {
  await expect(stepChips(page)).toHaveCount(0);
  const steps = cardSteps(page);
  for (let index = 0; index < (await steps.count()); index += 1) {
    await expect(steps.nth(index)).toContainText(word);
  }
}

/** Every step shows its own chip from Confirm onwards. */
export async function expectStepChips(page: Page, words: readonly string[]): Promise<void> {
  await expect(stepChips(page)).toHaveText([...words]);
}

/** The kinds this proposal recorded in `control.agent_actions`, in step order (Q12). */
export async function auditedKinds(proposalPrefix?: string): Promise<readonly string[]> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    const rows = await handle.query(
      `select kind, step_index, proposal_id from control."agent_actions"
         where ($1::text is null or proposal_id like $1 || '%')
         order by confirmed_at, step_index`,
      [proposalPrefix ?? null],
    );
    return rows.rows.map((row) => String((row as Record<string, unknown>)["kind"]));
  } finally {
    await handle.close();
  }
}

/** How many rows the audit holds now, which a cancel path compares against. */
export async function auditCount(): Promise<number> {
  return (await auditedKinds()).length;
}

/**
 * How many rows the audit holds per kind.
 *
 * A tally rather than the tail of the list, because the composed API stamps rows from one
 * pinned clock: two acts in the same run can share a `confirmed_at`, and the order of rows
 * inside one instant is the database's to choose. So "the last row is my act" is a claim
 * that holds until it does not.
 */
export async function auditTally(): Promise<Readonly<Record<string, number>>> {
  const tally: Record<string, number> = {};
  for (const kind of await auditedKinds()) tally[kind] = (tally[kind] ?? 0) + 1;
  return tally;
}

/** The rows one stretch of a spec added, by kind. */
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

/**
 * Zero axe violations on the state the card is in, with the rules shown to have run.
 *
 * Scoped to the card: what criterion 11 is about is each card state, and the panel around
 * it and the screen behind it have their own sweeps (`agent-launcher.pw.ts`'s axe test and
 * `a11y-axe.pw.ts`), whose debt a card spec must not re-report as its own.
 */
export async function expectAxeClean(page: Page, state: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  const results = await new AxeBuilder({ page })
    .include(".qcms-acard")
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
