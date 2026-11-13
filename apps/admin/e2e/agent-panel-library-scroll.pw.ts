import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { openPanel, propose } from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

// A library screen hosts the same panel as the builder, so a card longer than the panel has to stay
// inside it there too rather than growing the document behind it.

test.use({ storageState: TEST_ENVIRONMENT_STORAGE });

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentpanel083library");

const RUN = Date.now().toString(36);

let totpSecret = "";

interface Fit {
  readonly pageHeight: number;
  readonly cardOverflow: number;
  readonly panelTop: number;
  readonly panelBottom: number;
  readonly barBottom: number;
  readonly viewport: number;
  readonly scrollers: readonly string[];
}

async function fit(page: Page): Promise<Fit> {
  return page.evaluate(() => {
    const root = document.getElementById("qcms-assistant-panel");
    const box = root?.getBoundingClientRect();
    const card = document.querySelector(".qcms-acard")?.getBoundingClientRect();
    const inside = root === null ? [] : [root, ...root.querySelectorAll("*")];
    return {
      pageHeight: Math.round(document.documentElement.scrollHeight),
      cardOverflow: Math.round((card?.height ?? 0) - (box?.height ?? 0)),
      panelTop: Math.round(box?.top ?? 0),
      panelBottom: Math.round(box?.bottom ?? 0),
      barBottom: Math.round(
        document.querySelector("header.qcms-topbar")?.getBoundingClientRect().bottom ?? 0,
      ),
      viewport: window.innerHeight,
      scrollers: inside
        .filter((node): node is HTMLElement => node instanceof HTMLElement)
        .filter((node) => {
          const style = window.getComputedStyle(node);
          return (
            /auto|scroll/u.test(`${style.overflowY} ${style.overflowX}`) &&
            (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
          );
        })
        .map((node) => node.dataset["testid"] ?? node.className),
    };
  });
}

/** The panel fills the space under the top bar, and the card scrolls inside the conversation. */
async function expectContained(page: Page, where: string): Promise<Fit> {
  const found = await fit(page);
  expect(
    found.scrollers,
    `the ${where} conversation should be the panel's one scroll container`,
  ).toEqual(["qcms-assistant-turns"]);
  expect(found.panelTop, `the ${where} panel should start under the top bar`).toBe(found.barBottom);
  expect(found.panelBottom, `the ${where} panel should end at the foot of the viewport`).toBe(
    found.viewport,
  );
  return found;
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("holds a long card inside the panel on the forms library", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`/forms?q=fake-new-${RUN}f`);
  await openPanel(page);
  await propose(page, "plan-forms-create", `start two #qcms-fake-new:${RUN}f`);

  const found = await expectContained(page, "forms");
  expect(
    found.pageHeight,
    "a card on the forms library should not make the page scroll",
  ).toBeLessThanOrEqual(found.viewport + 1);
});

test("holds a long card inside the panel on the question library", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Short enough that the card is several times the panel's own height.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(`/questions?q=fake-new-${RUN}q`);
  await openPanel(page);
  await propose(page, "plan-questions-create", `add two #qcms-fake-new:${RUN}q`);

  const found = await expectContained(page, "questions");
  expect(
    found.cardOverflow,
    "the question card should be longer than the panel, or this proves nothing",
  ).toBeGreaterThan(0);
});
