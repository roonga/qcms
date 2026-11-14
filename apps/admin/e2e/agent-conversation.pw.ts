import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { card, cardChip, openPanel, propose } from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { t } from "../lib/i18n/en.js";

/**
 * One conversation at the app level: it follows the operator between screens, the panel
 * says which screen the next turn will use, New conversation ends it, and a waiting card
 * does not outlive the screen it was proposed on.
 */

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentconversation1206");

const RUN = Date.now().toString(36);

/** The seeded insurance fixture, as the other agent specs address it. */
const FORM_ID = "frm_auto_quote";

/** Where the rail, the dock and the content column fit together. */
const WIDE = 1280;

/** The tag set `e2e/a11y-axe.pw.ts` sweeps with, so the panel is measured at the same bar. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

function turns(page: Page) {
  return page.getByTestId("qcms-assistant-turns");
}

function chip(page: Page) {
  return page.getByTestId("qcms-assistant-context");
}

async function ask(page: Page, message: string): Promise<void> {
  await fillStable(
    page.getByTestId("qcms-assistant-composer"),
    `#qcms-fake:no-proposal ${message}`,
  );
  await page.getByTestId("qcms-assistant-send").locator("button").click();
  await expect(turns(page)).toContainText(message);
  await expect(turns(page)).toContainText("more detail");
}

async function navigate(page: Page, item: string, url: string): Promise<void> {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: item }).click();
  await page.waitForURL(url);
}

interface ReplyFit {
  readonly overflowing: boolean;
  readonly fromBottom: number;
  readonly replyBottom: number;
  readonly listBottom: number;
  readonly composerTop: number;
}

async function newestReply(page: Page): Promise<ReplyFit> {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="qcms-assistant-turns"]');
    const replies = list?.querySelectorAll('.qcms-assistant__turn[data-role="assistant"]') ?? [];
    const last = replies[replies.length - 1];
    const listBox = list?.getBoundingClientRect();
    const composer = document.querySelector(".qcms-assistant__composer")?.getBoundingClientRect();
    return {
      overflowing: (list?.scrollHeight ?? 0) > (list?.clientHeight ?? 0) + 1,
      fromBottom: Math.round(
        (list?.scrollHeight ?? 0) - (list?.scrollTop ?? 0) - (list?.clientHeight ?? 0),
      ),
      replyBottom: Math.round(last?.getBoundingClientRect().bottom ?? 0),
      listBottom: Math.round(listBox?.bottom ?? 0),
      composerTop: Math.round(composer?.top ?? 0),
    };
  });
}

async function expectNewestReplyInView(page: Page, when: string): Promise<ReplyFit> {
  await expect
    .poll(async () => (await newestReply(page)).fromBottom, {
      message: `the conversation should rest at its newest turn ${when}`,
    })
    .toBeLessThanOrEqual(16);
  const fit = await newestReply(page);
  expect(
    fit.replyBottom,
    `the newest reply should end inside the conversation ${when}`,
  ).toBeLessThanOrEqual(fit.listBottom + 1);
  expect(
    fit.replyBottom,
    `the newest reply should end above the composer ${when}`,
  ).toBeLessThanOrEqual(fit.composerTop + 1);
  return fit;
}

async function expectPanelAxeClean(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include('[data-testid="qcms-assistant-panel"]')
    .options({ runOnly: { type: "tag", values: TAGS } })
    .analyze();
  expect(
    results.violations.map((violation) => `${violation.id}: ${violation.help}`),
    `axe violations on the panel showing ${state}`,
  ).toEqual([]);
}

test("follows the operator from the library to a builder and on, naming each screen", async ({
  page,
}) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");
  await openPanel(page);

  await ask(page, "what can you see here");
  await expect(chip(page)).toHaveText(t("agent.context.questions"));

  await navigate(page, "Forms", "**/forms");
  await expect(turns(page), "the question library's turn is still here").toContainText(
    "what can you see here",
  );
  await expect(chip(page)).toHaveText(t("agent.context.forms"));

  await page.goto(`/forms/${FORM_ID}`);
  await waitForHydration(page);
  await expect(turns(page), "the builder keeps the same conversation").toContainText(
    "what can you see here",
  );
  await expect(chip(page)).toContainText("draft");

  await ask(page, "and from the builder");

  await navigate(page, "Workspace", "**/workspaces");
  await expect(turns(page), "both turns survive leaving the form").toContainText(
    "what can you see here",
  );
  await expect(turns(page)).toContainText("and from the builder");
  await expect(chip(page)).toHaveText(t("agent.context.workspaces"));

  await expectPanelAxeClean(page, "a conversation carried from another screen");
});

test("ends on New conversation and starts empty on the screen the operator is on", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/questions");
  await openPanel(page);

  await ask(page, "something to forget");
  await navigate(page, "Forms", "**/forms");
  await expect(turns(page)).toContainText("something to forget");

  await page.getByTestId("qcms-assistant-new").click();
  await expect(page.getByTestId("qcms-assistant-empty")).toBeVisible();
  await expect(turns(page)).not.toContainText("something to forget");

  await page.reload();
  await waitForHydration(page);
  await expect(
    page.getByTestId("qcms-assistant-empty"),
    "a new conversation stays empty across a reload",
  ).toBeVisible();
});

test("expires a waiting card when the operator leaves the screen it was proposed on", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto(`/forms?q=fake-new-${RUN}`);
  await openPanel(page);

  await propose(page, "propose-form-create", `start a form here #qcms-fake-new:${RUN}`);
  await expect(cardChip(page)).toHaveText("Proposed");

  await navigate(page, "Workspace", "**/workspaces");
  await expect(cardChip(page), "the card can no longer be confirmed").toHaveText("Expired");
  await expect(card(page).getByRole("button", { name: /^Confirm/u })).toBeDisabled();
  await expect(turns(page), "the dialogue itself is untouched").toContainText("start a form here");
});

test("holds the newest reply in view as the conversation outgrows the panel", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Short enough that a handful of turns no longer fit, which is the case under test.
  await page.setViewportSize({ width: WIDE, height: 620 });
  await page.goto("/questions");
  await openPanel(page);

  for (const message of ["one", "two", "three", "four", "five"]) {
    await ask(page, `tell me ${message}`);
  }

  const fit = await expectNewestReplyInView(page, "after a run of turns");
  expect(
    fit.overflowing,
    "the conversation should be longer than the panel, or this proves nothing",
  ).toBe(true);

  await turns(page).evaluate((list) => {
    list.scrollTop = 0;
  });
  await ask(page, "and one more");
  await expectNewestReplyInView(page, "after sending from further up the conversation");
});
