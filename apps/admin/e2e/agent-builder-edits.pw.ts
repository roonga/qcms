import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { card } from "./support/agent-card.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { t } from "../lib/i18n/en.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("builder115");
const RUN = Date.now().toString(36);
const NEEDLE = "accident";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let totpSecret = "";

async function axeClean(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS } })
    .analyze();
  expect(results.violations, `axe violations on ${where}`).toEqual([]);
}

async function say(page: Page, message: string): Promise<void> {
  await fillStable(page.getByTestId("qcms-assistant-composer"), message);
  await page.getByTestId("qcms-assistant-send").locator("button").click();
}

function slugFor(word: string): string {
  return `fake-new-${word}`;
}

function formIdFor(word: string): string {
  return `frm_fake_new_${word}`;
}

function edits(page: Page): Locator {
  return page.getByTestId("qcms-builder-edit");
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("abandoning the New form builder before Confirm leaves no form", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  const word = `gone${RUN}`;

  await page.goto("/forms/new/build");
  await waitForHydration(page);
  await say(page, `#qcms-fake:propose-form-create a form #qcms-fake-new:${word}`);
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
  await Promise.all([
    page.waitForURL(/\/forms\/new$/u),
    page.getByRole("link", { name: t("shell.mode.builder.exit") }).click(),
  ]);

  const gone = await page.request.get(`/forms/${formIdFor(word)}/build`);
  expect(gone.status()).toBe(404);
});

test("creates through the card, edits with no card, undoes twice and reviews the diff", async ({
  page,
}) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  const word = `made${RUN}`;
  const formId = formIdFor(word);
  const build = `/forms/${formId}/build`;

  await page.goto("/forms/new/build");
  await waitForHydration(page);
  await say(page, `#qcms-fake:propose-form-create a form #qcms-fake-new:${word}`);
  await expect(card(page)).toBeVisible({ timeout: 30_000 });
  await expect(card(page)).toContainText(slugFor(word));
  await expect(card(page)).toContainText("Workspace");
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  await axeClean(page, "the create card");

  await Promise.all([
    page.waitForURL(new RegExp(`${build}$`, "u"), { timeout: 60_000 }),
    card(page)
      .getByRole("button", { name: /^Confirm/u })
      .click(),
  ]);
  await waitForHydration(page);

  await say(page, `#qcms-fake:builder-first-edits start it #qcms-fake-search:${NEEDLE}`);
  await expect(edits(page)).toHaveCount(3, { timeout: 60_000 });
  await expect(card(page)).toHaveCount(0);
  for (const index of [0, 1, 2]) {
    await expect(edits(page).nth(index)).toHaveAttribute("data-state", "applied");
  }
  await expect(edits(page).nth(0).getByRole("button", { name: /^Undo/u })).toBeDisabled();
  await expect(edits(page).nth(1).getByRole("button", { name: /^Undo/u })).toBeDisabled();
  await axeClean(page, "three applied edits");

  await edits(page).nth(2).getByRole("button", { name: /^Undo/u }).click();
  await expect(edits(page).nth(2)).toHaveAttribute("data-state", "undone", { timeout: 30_000 });
  await expect(edits(page).nth(1).getByRole("button", { name: /^Undo/u })).toBeEnabled();
  await edits(page).nth(1).getByRole("button", { name: /^Undo/u }).click();
  await expect(edits(page).nth(1)).toHaveAttribute("data-state", "undone", { timeout: 30_000 });
  await expect(edits(page).nth(0)).toHaveAttribute("data-state", "applied");
  await axeClean(page, "two undone edits");

  await Promise.all([
    page.waitForURL(new RegExp(`/forms/${formId}/publish`, "u")),
    page.getByRole("link", { name: "Publish" }).click(),
  ]);
  const changes = page.getByTestId("qcms-publish-changes");
  await expect(changes).toBeVisible();
  await expect(
    changes.getByRole("heading", { name: "Every change since the last publish" }),
  ).toBeVisible();
  await expect(changes.getByTestId("qcms-publish-change-list")).toContainText("First step");
  const steps = changes.getByTestId("qcms-publish-assistant-steps").getByRole("listitem");
  await expect(steps).toHaveCount(5);
  await expect(steps.filter({ hasText: "Undid an edit" })).toHaveCount(2);
  await axeClean(page, "the wizard's diff");

  await Promise.all([
    page.waitForURL(new RegExp(`${build}$`, "u")),
    page.getByTestId("qcms-publish-cancel").click(),
  ]);
});
