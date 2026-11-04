import type { Page } from "@playwright/test";

import { NOW } from "../../../api/e2e/support/index.js";

export const PROPOSAL_WINDOW_MS = 10 * 60 * 1000;

// Match the API clock but keep time advancing: frozen time makes consecutive autosave stamps identical.
export async function pinProposalClock(page: Page): Promise<void> {
  await page.clock.install({ time: NOW });
  await page.clock.resume();
}

export async function runOutProposalWindow(page: Page): Promise<void> {
  await page.clock.fastForward(PROPOSAL_WINDOW_MS + 60_000);
}
