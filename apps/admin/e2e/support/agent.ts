import type { Page } from "@playwright/test";

import { NOW } from "../../../api/e2e/support/index.js";

/** The window every proposal is issued with, which a card counts from its own arrival. */
export const PROPOSAL_WINDOW_MS = 10 * 60 * 1000;

/**
 * Aligns the page's clock with the composed API's pinned clock ({@link NOW}), so what a
 * screen derives from wall time - an age, a relative stamp, a save stamp that has to
 * differ from the one before it - reads against the same instant the API's own rows carry.
 *
 * Installed and resumed rather than fixed: a frozen `Date` makes two autosaves stamp the
 * same instant and `waitForSaveAfter` can then no longer tell them apart. Installing it is
 * also what lets a spec run a card's waiting window out.
 */
export async function pinProposalClock(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
  await page.clock.resume();
}

/**
 * Runs a waiting card's window out. The window is counted from the card's arrival, so
 * letting it pass is the only way to reach the Expired state.
 */
export async function runOutProposalWindow(page: Page): Promise<void> {
  await page.clock.fastForward(PROPOSAL_WINDOW_MS + 60_000);
}
