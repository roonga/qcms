import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { card, cardChip, openPanel, propose } from "./support/agent-card.js";
import { TEST_ENVIRONMENT_STORAGE } from "./support/environment.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";

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

interface Decision {
  readonly confirmBottom: number;
  readonly cancelBottom: number;
  readonly confirmTop: number;
  readonly listTop: number;
  readonly listBottom: number;
  readonly cardFits: boolean;
  readonly cardHeight: number;
  readonly cardBottom: number;
  readonly listClientHeight: number;
  readonly listScrollTop: number;
  readonly listScrollHeight: number;
}

/* Where the card's own decision sits against the conversation's visible box. A card shorter
   than the panel has no reason to leave its Confirm below the fold. */
async function decision(page: Page): Promise<Decision> {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="qcms-assistant-turns"]');
    const foot = document.querySelector(".qcms-acard:not([data-held]) .qcms-acard__foot");
    const buttons = [...(foot?.querySelectorAll("button") ?? [])];
    const named = (word: string) =>
      buttons.find((button) => (button.textContent ?? "").trim().startsWith(word));
    const box = list?.getBoundingClientRect();
    const cardBox = document.querySelector(".qcms-acard:not([data-held])")?.getBoundingClientRect();
    return {
      confirmBottom: Math.round(named("Confirm")?.getBoundingClientRect().bottom ?? 0),
      cancelBottom: Math.round(named("Cancel")?.getBoundingClientRect().bottom ?? 0),
      confirmTop: Math.round(named("Confirm")?.getBoundingClientRect().top ?? 0),
      listTop: Math.round(box?.top ?? 0),
      listBottom: Math.round(box?.bottom ?? 0),
      cardFits: (cardBox?.height ?? 0) <= (box?.height ?? 0),
      cardHeight: Math.round(cardBox?.height ?? 0),
      cardBottom: Math.round(cardBox?.bottom ?? 0),
      listClientHeight: list instanceof HTMLElement ? list.clientHeight : 0,
      listScrollTop: list instanceof HTMLElement ? Math.round(list.scrollTop) : 0,
      listScrollHeight: list instanceof HTMLElement ? list.scrollHeight : 0,
    };
  });
}

test("brings an arriving card's Confirm and Cancel into view on the forms library", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Tall enough that a one-step card fits the panel, which is the case where its foot has no
  // business being below the fold, and short enough that the turns above it do not.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/forms?q=fake-new-${RUN}d`);
  await openPanel(page);

  for (const message of ["one", "two", "three"]) {
    await fillStable(
      page.getByTestId("qcms-assistant-composer"),
      `#qcms-fake:no-proposal tell me ${message}`,
    );
    await page.getByTestId("qcms-assistant-send").locator("button").click();
    await expect(page.getByTestId("qcms-assistant-turns")).toContainText(`tell me ${message}`);
  }

  await propose(page, "propose-form-create", `start one here #qcms-fake-new:${RUN}d`);
  await expect(card(page)).toBeVisible();

  await expect
    .poll(async () => (await decision(page)).confirmBottom - (await decision(page)).listBottom, {
      message: "the arriving card's Confirm should settle inside the conversation",
    })
    .toBeLessThanOrEqual(1);

  const found = await decision(page);
  expect(
    found.cardFits,
    `the card should fit the panel, or its top wins over its foot: ${JSON.stringify(found)}`,
  ).toBe(true);
  expect(found.cancelBottom, "Cancel should sit inside the conversation too").toBeLessThanOrEqual(
    found.listBottom + 1,
  );
  expect(
    found.confirmTop,
    "the decision should not be scrolled above the panel",
  ).toBeGreaterThanOrEqual(found.listTop - 1);
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

test("pins the decision at the panel's foot for a card taller than the panel", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  // Short enough that a multi-step card cannot fit, which is the case the pinned bar exists for.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(`/questions?q=fake-new-${RUN}p`);
  await openPanel(page);
  await propose(page, "plan-questions-create", `add two #qcms-fake-new:${RUN}p`);

  const overflow = await expectContained(page, "questions");
  expect(
    overflow.cardOverflow,
    "the card should be longer than the panel, or this proves nothing",
  ).toBeGreaterThan(0);

  const pinned = page.getByTestId("qcms-assistant-pinned-decision");
  await expect(pinned).toBeVisible();

  // The card's own Confirm and Cancel are the controls: one of each in the accessibility tree,
  // never two, and the pinned pair is out of the tab order as well as out of that tree.
  await expect(page.getByRole("button", { name: /^Confirm/u })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(1);
  expect(await pinned.getAttribute("aria-hidden")).toBe("true");
  await expect(pinned.locator("button")).toHaveCount(2);
  for (const index of [0, 1]) {
    expect(await pinned.locator("button").nth(index).getAttribute("tabindex")).toBe("-1");
  }

  const placed = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="qcms-assistant-pinned-decision"]');
    const list = document.querySelector('[data-testid="qcms-assistant-turns"]');
    const root = document.getElementById("qcms-assistant-panel");
    return {
      barTop: Math.round(bar?.getBoundingClientRect().top ?? 0),
      barBottom: Math.round(bar?.getBoundingClientRect().bottom ?? 0),
      listBottom: Math.round(list?.getBoundingClientRect().bottom ?? 0),
      panelBottom: Math.round(root?.getBoundingClientRect().bottom ?? 0),
    };
  });
  expect(placed.barTop, "the pinned bar sits below the conversation").toBeGreaterThanOrEqual(
    placed.listBottom - 1,
  );
  expect(placed.barBottom, "and inside the panel").toBeLessThanOrEqual(placed.panelBottom + 1);

  // It belongs to the waiting card alone, so cancelling that card takes it away.
  await card(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(cardChip(page)).toHaveText("Cancelled");
  await expect(pinned).toBeHidden();
});
