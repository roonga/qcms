import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  auditDelta,
  auditTally,
  cancel,
  confirm,
  createdLink,
  expectAxeClean,
  expectStepChips,
  expectWaitingStepStates,
  openPanel,
  propose,
} from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

// Lifecycle actions require fresh draft-v1 fixtures: publish and deprecate refuse incompatible states.

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentcards083questions");

const RUN = Date.now().toString(36);

const CREATED = `${RUN}c`;
const LIFECYCLE = `${RUN}l`;
const PLANNED = `${RUN}p`;

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

function library(word: string): string {
  return `/questions?q=fake-new-${word}`;
}

function versionLink(page: Page, version: number): Locator {
  return page.getByRole("link", { name: new RegExp(`Version ${String(version)}`, "u") });
}

async function createAndOpen(page: Page, word: string): Promise<void> {
  await page.goto(library(word));
  await openPanel(page);
  await propose(page, "propose-question-create", `add a question #qcms-fake-new:${word}`);
  await confirm(page, /^Done\./u);
  const href = await createdLink(page).getAttribute("href");
  expect(href, "the create card should link the question it made").toMatch(/^\/questions\/q_/u);
  await page.goto(href ?? "");
  await waitForHydration(page);
}

test("confirms a create alone, listing the new question and linking to it", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.goto(library(CREATED));
  await openPanel(page);
  await expect(page.getByTestId("qcms-questions-table")).toHaveCount(0);

  const before = await auditTally();
  await propose(page, "propose-question-create", `add a question #qcms-fake-new:${CREATED}`);
  await expectWaitingStepStates(page, "Proposed");
  await expectAxeClean(page, "proposed");

  await confirm(page, /^Done\./u);
  await expectStepChips(page, ["Done"]);
  await expect(createdLink(page)).toHaveAttribute("href", /^\/questions\/q_/u);
  await expectAxeClean(page, "done");

  await expect(
    page.getByTestId("qcms-questions-table").getByRole("row").filter({ hasText: CREATED }),
  ).toHaveCount(1, { timeout: 30_000 });
  expect(auditDelta(before, await auditTally())).toEqual({ "question.create": 1 });
});

test("creates nothing when the card is cancelled", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(library(CREATED));
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "propose-question-create", `add another #qcms-fake-new:${CREATED}`);
  await cancel(page);
  await expectAxeClean(page, "cancelled");

  expect(auditDelta(before, await auditTally())).toEqual({});
  await expect(
    page.getByTestId("qcms-questions-table").getByRole("row").filter({ hasText: CREATED }),
  ).toHaveCount(1);
});

test("confirms two creates inside one plan", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(library(PLANNED));
  await openPanel(page);

  const before = await auditTally();
  await propose(page, "plan-questions-create", `add two #qcms-fake-new:${PLANNED}`);
  await confirm(page, /^Done\. All 2 steps ran/u);
  await expectStepChips(page, ["Done", "Done"]);
  await expectAxeClean(page, "done plan");

  await expect(
    page.getByTestId("qcms-questions-table").getByRole("row").filter({ hasText: PLANNED }),
  ).toHaveCount(2, { timeout: 30_000 });
  expect(auditDelta(before, await auditTally())).toEqual({ "question.create": 2 });
});

test("confirms a save, a publish, a next draft and a deprecation, one card at a time", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createAndOpen(page, LIFECYCLE);

  const before = await auditTally();
  await openPanel(page);
  await propose(page, "propose-question-save-draft", "write the label you suggested");
  await confirm(page, /^Done\./u);
  await expect(page.getByRole("textbox", { name: "Label", exact: true })).toHaveValue(
    "What the assistant proposed",
    { timeout: 30_000 },
  );

  await propose(page, "propose-question-publish", "publish that draft");
  await confirm(page, /^Done\./u);
  await expect(versionLink(page, 1)).toContainText("Published", { timeout: 30_000 });

  await propose(page, "propose-question-new-version", "open the next draft");
  await confirm(page, /^Done\./u);
  await expect(createdLink(page)).toBeVisible();
  await expect(versionLink(page, 2)).toContainText("Draft", { timeout: 30_000 });

  await propose(page, "propose-question-deprecate", "retire the published one");
  await confirm(page, /^Done\./u);
  await expect(versionLink(page, 1)).toContainText("Deprecated", { timeout: 30_000 });

  expect(auditDelta(before, await auditTally())).toEqual({
    "question.saveDraft": 1,
    "question.publish": 1,
    "question.newVersion": 1,
    "question.deprecate": 1,
  });
});

test("confirms all four lifecycle kinds inside one plan", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createAndOpen(page, `${RUN}q`);

  const before = await auditTally();
  await openPanel(page);
  await propose(page, "plan-question-lifecycle", "take this draft all the way through");
  await expectWaitingStepStates(page, "Proposed");

  await confirm(page, /^Done\. All 4 steps ran/u);
  await expectStepChips(page, ["Done", "Done", "Done", "Done"]);
  await expectAxeClean(page, "done plan");

  await expect(versionLink(page, 1)).toContainText("Deprecated", { timeout: 30_000 });
  await expect(versionLink(page, 2)).toContainText("Draft");
  expect(auditDelta(before, await auditTally())).toEqual({
    "question.saveDraft": 1,
    "question.publish": 1,
    "question.newVersion": 1,
    "question.deprecate": 1,
  });
});
