import { readFile } from "node:fs/promises";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";
import { PORTAL_PORT } from "../../portal/e2e/support/harness-config.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  card,
  cardChip,
  confirm,
  expectAxeClean,
  expectStepChips,
  expectWaitingStepStates,
  heldCard,
  openPanel,
  propose,
  revealedAddresses,
  revealList,
} from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";

// Use forms with no links so ordering cannot select another spec's link.
// The empty second form makes the planned revoke fail through the real route with an absent id.

// Serial tests get fresh contexts; set test explicitly so link actions cannot fall back to production.
test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083links");

const RUN = Date.now().toString(36);

let totpSecret = "";

const PORTAL_ORIGIN = `http://localhost:${String(PORTAL_PORT)}`;

const SEEDED_QUESTION = "q_accident_count";

let formId = "";
let emptyFormId = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

function linkRows(page: Page): Locator {
  return page.getByTestId("qcms-links-table").locator("tbody tr");
}

function expectAddressShape(addresses: readonly string[]): void {
  for (const address of addresses) {
    expect(new URL(address).pathname, "a minted address addresses the test environment").toMatch(
      /^\/test\/l\//u,
    );
  }
}

async function csvOfTheReveal(page: Page, scope: Locator): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    scope.getByRole("button", { name: "Download all as CSV" }).click(),
  ]);
  const path = await download.path();
  return readFile(path, "utf8");
}

test("confirms a mint and a revoke alone, changing the screen and recording each act", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  formId = await createForm(page, `agent-links-${RUN}`, "Agent links");

  await page.goto(`/operations/forms/${formId}/links`);
  await openPanel(page);
  await expect(page.getByTestId("qcms-links-empty")).toBeVisible();

  const before = await auditTally();
  await propose(page, "propose-link-mint", "mint two links for this form");
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expectAxeClean(page, "done");
  await expect(linkRows(page)).toHaveCount(2, { timeout: 30_000 });

  const addresses = await revealedAddresses(card(page));
  expect(addresses, "the card shows every address the mint produced").toHaveLength(2);
  expectAddressShape(addresses);

  await card(page).getByRole("button", { name: "Copy 1", exact: true }).click();
  // A refused clipboard is as acceptable an outcome as a successful one, and says so either way.
  await expect(card(page).getByTestId("qcms-acard-reveal-note")).toHaveText(
    /copied to the clipboard|could not be copied/u,
  );

  const csv = await csvOfTheReveal(page, card(page));
  expect(csv).toContain('"linkId","url","expiresAt"');
  for (const address of addresses) expect(csv).toContain(address);

  await propose(page, "propose-link-revoke", "revoke one of them again");
  // The settled card keeps the addresses the next proposal would otherwise have swept away.
  expect(await revealedAddresses(heldCard(page))).toEqual(addresses);
  await confirm(page, /^Done\./u);
  await expect(page.getByTestId("qcms-links-table").getByText("Revoked")).toBeVisible({
    timeout: 30_000,
  });

  expect(await revealedAddresses(heldCard(page))).toEqual(addresses);
  await heldCard(page).getByRole("button", { name: "Hide", exact: true }).click();
  await expect(heldCard(page)).toHaveCount(0);

  expect(auditDelta(before, await auditTally())).toEqual({ "link.mint": 1, "link.revoke": 1 });
});

test("mints nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${formId}/links`);
  await openPanel(page);

  const before = await auditTally();
  const rows = await linkRows(page).count();
  await propose(page, "propose-link-mint", "mint two links for this form");
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(linkRows(page)).toHaveCount(rows);
});

test("confirms both kinds inside one plan", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/operations/forms/${formId}/links`);
  await openPanel(page);

  const before = await auditTally();
  const rows = await linkRows(page).count();
  await propose(page, "plan-links", "mint two more and revoke the one still working");
  await expectWaitingStepStates(page, "Proposed");

  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");
  await expect(linkRows(page)).toHaveCount(rows + 2, { timeout: 30_000 });

  expect(auditDelta(before, await auditTally())).toEqual({ "link.mint": 1, "link.revoke": 1 });
});

test("stops at the step that failed and runs nothing after it", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  emptyFormId = await createForm(page, `agent-links-empty-${RUN}`, "Agent links empty");

  await page.goto(`/operations/forms/${emptyFormId}/links`);
  await openPanel(page);
  await expect(page.getByTestId("qcms-links-empty")).toBeVisible();

  const before = await auditTally();
  await propose(page, "plan-fails-at-2", "mint one, revoke a link, then mint three");
  await confirm(page, /^Stopped at step 2\./u);

  await expect(cardChip(page)).toHaveText("Stopped at step 2");
  await expectStepChips(page, ["Done", "Failed", "Not run"]);
  await expectAxeClean(page, "failed plan");

  expect(auditDelta(before, await auditTally())).toEqual({ "link.mint": 1 });
  await expect(linkRows(page)).toHaveCount(1, { timeout: 30_000 });
});

test("shows a full batch on the card, and one of its addresses starts a session", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const batchFormId = await createForm(page, `agent-links-batch-${RUN}`, "Agent links batch");
  await addStep(page, "Start");
  await pinQuestion(page, SEEDED_QUESTION, 1);
  await waitForSaved(page);

  await openPanel(page);
  await propose(page, "propose-form-publish", "publish this form to test");
  await confirm(page, /^Done\./u);

  await page.goto(`/operations/forms/${batchFormId}/links`);
  await openPanel(page);
  await propose(page, "propose-link-mint-batch", "mint a hundred links for this form");
  await confirm(page, /^Done\./u);

  const addresses = await revealedAddresses(card(page));
  expect(addresses, "the card lists every address, with no threshold").toHaveLength(100);
  expectAddressShape(addresses);
  await expect(card(page).getByRole("button", { name: /^Copy \d+$/u })).toHaveCount(100);

  await page.setViewportSize({ width: 360, height: 760 });
  const layout = await revealList(card(page)).evaluate((list) => ({
    scrolls: list.scrollHeight > list.clientHeight,
    overflow: getComputedStyle(list).overflowY,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrolls, "a hundred addresses scroll inside the card").toBe(true);
  expect(layout.overflow).toBe("auto");
  expect(layout.pageScrollWidth, "the card adds no sideways page scroll").toBeLessThanOrEqual(
    layout.pageClientWidth + 1,
  );
  await expectAxeClean(page, "a hundred minted addresses");
  await page.setViewportSize({ width: 1280, height: 900 });

  await card(page).getByRole("button", { name: "Hide", exact: true }).click();
  await expect(revealList(card(page))).toHaveCount(0);
  await expect(card(page)).toBeVisible();

  const first = new URL(addresses[0] ?? "");
  await page.goto(`${PORTAL_ORIGIN}${first.pathname}`);
  await page.waitForURL(/\/test\/s\/ses_[^/]+$/u, { timeout: 60_000 });
});
