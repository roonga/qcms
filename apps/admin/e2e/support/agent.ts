import type { Page } from "@playwright/test";

import { NOW } from "../../../api/e2e/support/index.js";

/**
 * The composed API runs on the suite's pinned clock, so a proposal is issued at {@link NOW}
 * and its ten-minute window closes ten minutes later on that clock. A card reads the
 * window against the browser's own wall time, which is the real instant, so without this
 * every card would arrive expired and no Confirm path would be reachable here.
 *
 * Installed and resumed rather than fixed: the page's clock starts at the API's instant and
 * then runs at the natural rate, so everything the screens derive from wall time - a save
 * stamp that has to differ from the one before it, a debounce - behaves as it does without
 * this, and only the window's starting point moves.
 */
export async function pinProposalClock(page: Page, offsetMs = 0): Promise<void> {
  await page.clock.install({ time: new Date(NOW.getTime() + offsetMs) });
  await page.clock.resume();
}

/** Past the ten-minute window, for the one state a fresh proposal cannot reach. */
export const PAST_PROPOSAL_WINDOW_MS = 11 * 60 * 1000;
