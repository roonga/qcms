/**
 * Keyboard-only walkthrough of the vehicle-insurance fixture (task 030, exit
 * criterion 2), including a branch INSERTION and a branch REMOVAL, plus the skip
 * link, the focus-stays-put insertion policy, the live-region announcements, and
 * a visible focus indicator. Nothing here uses a pointer for a flow action:
 * controls are reached by Tab/focus and operated by Space/Enter/typing.
 */

import { expect, test, type Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, COUNT_LABEL } from "./support/flow.js";

/** Select an at-fault-accident radio by keyboard and await the recorded answer. */
async function keyboardChoose(page: Page, answer: "Yes" | "No"): Promise<void> {
  const recorded = page.waitForResponse(
    (r) => r.url().includes("/answers") && r.request().method() === "POST" && r.status() === 200,
  );
  await page.getByRole("radio", { name: answer, exact: true }).focus();
  await page.keyboard.press("Space");
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
  // Visible on focus (slides into view) with a real focus outline (WCAG 2.4.11).
  const outlineWidth = await skip.evaluate((el) => getComputedStyle(el).outlineWidth);
  expect(outlineWidth).not.toBe("0px");
  // Slides into view on focus (retries past the 0.15s transition).
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

  // Start the session by keyboard (Enter on the Start control).
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/s\/ses_/);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();

  const announcer = page.getByTestId("flow-announcer");

  // Branch INSERTION via keyboard: choosing "Yes" reveals the count follow-up.
  await keyboardChoose(page, "Yes");
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
  // Policy: focus STAYS on the answered control after an insertion (never yanked
  // forward to the new question).
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeFocused();
  // The insertion is announced.
  await expect(announcer).toHaveText("1 question was added below.");
  // The inserted question is a real, keyboard-operable control: reachable (in the
  // tab order) and enabled. The tab-order policy is DOM order (docs/a11y.md), so
  // it follows the answered control. We assert reachability without entering the
  // field: focusing then leaving it would post an (empty) answer and add a
  // projection, making the removal sequence below nondeterministic.
  await expect(page.getByRole("textbox", { name: /how many/i })).toBeEnabled();

  // Branch REMOVAL via keyboard: choosing "No" drops the count follow-up. Focus
  // moves from the "Yes" radio to the "No" radio WITHIN the same radio group, so
  // the count field is never blurred and nothing is posted for it: the only post
  // is this accident=false answer. On the two-question fixture that single
  // projection both removes the follow-up AND completes the step, so it announces
  // readiness. Being the one completing projection, the announcement is
  // deterministic (no earlier ready-collapse to race with).
  await keyboardChoose(page, "No");
  await expect(page.getByText(COUNT_LABEL)).toHaveCount(0);
  await expect(announcer).toHaveText("You have answered everything. You can now submit.");

  // Ready to submit; complete by keyboard. Wait for the button to settle (no
  // answer post in flight), then activate it with Enter. Retry the keypress: in
  // the dev server a late re-render can momentarily steal focus to <body>,
  // swallowing a single keystroke. `press` re-focuses the button each attempt, so
  // this is still pure keyboard activation.
  const primary = page.getByTestId("primary-action");
  await expect(primary).toHaveText("Submit");
  await expect(primary).toBeEnabled();
  await expect(async () => {
    await primary.press("Enter");
    await expect(page).toHaveURL(/\/done/, { timeout: 3000 });
  }).toPass({ timeout: 20000 });
  await expect(page.getByText("Thank you, your responses were received")).toBeVisible();
});
