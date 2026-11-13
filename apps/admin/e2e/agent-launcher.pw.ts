import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment } from "./support/environment.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";
import { waitForHydration } from "./support/hydration.js";
import { TOPBAR_SELECTOR } from "../lib/topbar.js";

// Each test gets a fresh context; write panel and sidebar cookies per test to avoid ordering dependencies.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentlauncher082");

let totpSecret = "";

const WIDE = 1280;

const HELD = 1100;

const COMPACT = 640;

const DEFAULT_WIDTH = 400;

const FORM_ID = "frm_auto_quote";

const WORKSPACE_ID = "org_default_workspace";

const VERSION = 1;

const QUESTION_ID = "q_at_fault_accident";

const SLUG = "auto";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

const SHELL_PAGES: readonly string[] = [
  "/questions",
  "/questions/new",
  `/questions/${QUESTION_ID}`,
  "/forms",
  "/forms/new",
  `/forms/${FORM_ID}`,
  `/forms/${FORM_ID}/rules`,
  `/forms/${FORM_ID}/preview`,
  `/forms/${FORM_ID}/versions`,
  `/forms/${FORM_ID}/versions/${String(VERSION)}`,
  `/forms/${FORM_ID}/publish`,
  `/operations/forms/${FORM_ID}/links`,
  `/operations/forms/${FORM_ID}/webhooks`,
  `/operations/forms/${FORM_ID}/responses`,
  "/me/access",
  "/operations",
  "/responses",
  "/responses/erasures",
  "/settings",
  "/webhooks",
  "/workspaces",
  `/workspaces/${WORKSPACE_ID}/members`,
  `/workspaces/${WORKSPACE_ID}/access-groups`,
  `/workspaces/${WORKSPACE_ID}/settings`,
  `/workspaces/${WORKSPACE_ID}/audit`,
  `/workspaces/${WORKSPACE_ID}/assistant-actions`,
];

const UNAUTHENTICATED_PAGES: readonly string[] = [
  "/sign-in",
  "/two-factor/challenge",
  "/change-password",
];

const PANEL_COOKIE = "qcms-assistant";
const SIDEBAR_COOKIE = "qcms-sidebar";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function button(page: Page) {
  return page.getByTestId("qcms-assistant-button");
}

function panel(page: Page) {
  return page.getByTestId("qcms-assistant-panel");
}

function composer(page: Page) {
  return page.getByTestId("qcms-assistant-composer");
}

async function withPanelCookie(page: Page, value: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: PANEL_COOKIE, value, domain: "localhost", path: "/", sameSite: "Lax" as const },
    ]);
}

async function tracks(
  page: Page,
): Promise<{ readonly rail: number; readonly content: number; readonly panel: number }> {
  return page.evaluate(() => {
    const width = (selector: string): number =>
      Math.round(document.querySelector(selector)?.getBoundingClientRect().width ?? 0);
    return {
      rail: width("aside.qcms-rail"),
      content: width("main#main-content"),
      panel: width("#qcms-assistant-panel"),
    };
  });
}

async function open(page: Page): Promise<void> {
  await waitForHydration(page);
  if (!(await panel(page).isVisible())) await button(page).click();
  await expect(panel(page)).toBeVisible();
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("puts the button first in the trailing group on every shell screen, and on none outside it (exit criterion 2)", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.setViewportSize({ width: WIDE, height: 900 });

  const sessionId = await submitResponse(SLUG, [
    [ACCIDENT, true],
    [COUNT, 1],
  ]);

  for (const path of [...SHELL_PAGES, `/operations/forms/${FORM_ID}/responses/${sessionId}`]) {
    await page.goto(path);
    await expect(button(page), `${path} carries the assistant button`).toBeVisible();
    await expect.soft(button(page), `${path} carries exactly one`).toHaveCount(1);

    // Compare document order: the top bar wraps, so x coordinates can describe different rows.
    // Use locators so navigation retries the read instead of destroying evaluate's execution context.
    const group = page.locator('[data-testid="account-menu"]').locator("xpath=..");
    await expect(
      group.locator(':scope > *:first-child [data-testid="qcms-assistant-button"]'),
      `${path} puts the button first in the top bar's trailing group`,
    ).toHaveCount(1);
    await expect(
      group.locator(':scope > [data-testid="account-menu"]'),
      `${path} keeps the account control in that same group`,
    ).toHaveCount(1);

    await expect
      .soft(page.locator(".qcms-assist-launcher"), `${path} has no floating launcher`)
      .toHaveCount(0);
  }

  await page.context().clearCookies();
  for (const path of UNAUTHENTICATED_PAGES) {
    await page.goto(path);
    await expect(button(page), `${path} is outside (shell) and carries no button`).toHaveCount(0);
  }
});

test("opens with Alt+Shift+A, and leaves the chord alone while a page input has focus (exit criterion 4)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/forms/new");
  await waitForHydration(page);

  await page.keyboard.press("Alt+Shift+A");
  await expect(panel(page)).toBeVisible();
  await expect(composer(page)).toBeFocused();

  await page.locator("main#main-content").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Alt+Shift+A");
  await expect(composer(page)).toBeFocused();

  await page.getByTestId("qcms-assistant-close").click();
  await expect(panel(page)).toBeHidden();

  await page.goto("/questions");
  await waitForHydration(page);
  const title = page.locator("aside.qcms-rail").getByRole("textbox").first();
  await expect(title).toBeVisible();
  await title.click();
  await expect(title).toBeFocused();
  await page.keyboard.press("Alt+Shift+A");
  await expect(panel(page), "the chord is ignored while a page input has focus").toBeHidden();
});

test("1133 shows the Working text beside the closed button while a turn runs (exit criteria 3, 15)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/operations");
  await page.route("**/assist", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });
  await open(page);
  await fillStable(composer(page), "What is on this screen?");
  await page.getByTestId("qcms-assistant-send").locator("button").click();

  await button(page).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.getByTestId("qcms-assistant-badge")).toHaveText("Working");
  await page.unroute("**/assist");
});

test("renders an open panel docked on the first paint, with no shift after hydration (exit criterion 3)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await withPanelCookie(page, "open:400");
  await page.goto("/operations");

  await expect(panel(page)).toBeVisible();
  const first = await tracks(page);
  expect(first.panel, "the cookie's width is the first paint's width").toBe(DEFAULT_WIDTH);

  await waitForHydration(page);
  const settled = await tracks(page);
  expect(settled, "hydration moves no track").toEqual(first);

  expect(settled.rail, "the rail stays beside the dock at 1280").toBeGreaterThan(200);
  expect(settled.content, "the content column keeps 640px").toBeGreaterThanOrEqual(COMPACT);
});

test("holds the rail hidden between 1024 and 1279 px without touching the operator's setting (exit criterion 3)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: HELD, height: 900 });
  await page.goto("/operations");
  await waitForHydration(page);

  const shown = await tracks(page);
  expect(shown.rail, "the rail is the operator's own shown setting").toBeGreaterThan(200);

  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-sidebar-hold", "hidden");
  const held = await tracks(page);
  expect(held.rail, "the rail gives up its track to the panel").toBe(0);
  expect(held.content, "the content column keeps 640px").toBeGreaterThanOrEqual(COMPACT);
  expect(held.panel, "the panel is capped at 400px in this range").toBeLessThanOrEqual(
    DEFAULT_WIDTH,
  );

  const cookies = await page.context().cookies();
  expect(
    cookies.find((one) => one.name === SIDEBAR_COOKIE),
    "the hold writes no sidebar cookie",
  ).toBeUndefined();

  await page.getByTestId("qcms-assistant-close").click();
  await expect(panel(page)).toBeHidden();
  await expect(page.locator("html")).not.toHaveAttribute("data-sidebar-hold", "hidden");
  const restored = await tracks(page);
  expect(restored.rail, "closing the panel returns the rail").toBeGreaterThan(200);
});

test("1133 the rail toggle expands the held rail, closes the panel and says so (ruling O2)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: HELD, height: 900 });
  await page.goto("/operations");
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-sidebar-hold", "hidden");

  await page.getByTestId("qcms-rail-toggle").click();
  await expect(panel(page), "expanding closes the panel").toBeHidden();
  await expect
    .poll(async () => (await tracks(page)).rail, "expanding shows the rail")
    .toBeGreaterThan(200);
  await expect(page.getByTestId("qcms-announcer")).toContainText(
    "Showed the sidebar and closed the assistant.",
  );
});

test("returns focus and the dock state from Escape in all three modes (exit criterion 4)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/operations");
  await open(page);

  await composer(page).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page), "Escape does not close the dock").toBeVisible();
  await expect(page.locator("main#main-content")).toBeFocused();

  const expand = page.getByTestId("qcms-assistant-expand");
  await expect(expand).toHaveAttribute("aria-label", "Expand the assistant");
  await expand.click();
  await expect(panel(page)).toHaveAttribute("data-mode", "expanded");
  await expect(panel(page)).toHaveRole("dialog");
  await expect(expand).toHaveAttribute("aria-pressed", "true");
  await expect(expand, "the toggle names the action it now offers").toHaveAttribute(
    "aria-label",
    "Collapse the assistant",
  );
  await expect(page.locator("main#main-content")).toHaveAttribute("inert", "");
  await expand.press("Escape");
  await expect(panel(page)).toHaveAttribute("data-mode", "dock");
  await expect(expand).toHaveAttribute("aria-label", "Expand the assistant");
  await expect(page.locator("main#main-content")).not.toHaveAttribute("inert", "");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page)).toHaveAttribute("data-mode", "sheet");
  await expect(panel(page)).toHaveAttribute("aria-modal", "true");
  await composer(page).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(button(page), "closing returns focus to the top-bar button").toBeFocused();
});

test("traps focus in the sheet and scrolls nothing sideways at 320 px (exit criteria 3, 5)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/operations");
  await open(page);
  await expect(panel(page)).toHaveAttribute("data-mode", "sheet");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the sheet reflows at 320px with no horizontal scroll").toBeLessThanOrEqual(1);

  await composer(page).focus();
  for (let press = 0; press < 20; press += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() =>
      document.getElementById("qcms-assistant-panel")?.contains(document.activeElement),
    );
    expect(inside, `tab ${String(press + 1)} stayed inside the sheet`).toBe(true);
  }
});

test("resizes the dock from the keyboard and from the width menu (exit criterion 5)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/operations");
  await open(page);

  const edge = page.getByTestId("qcms-assistant-edge");
  await edge.focus();
  await expect(edge).toHaveAttribute("aria-valuenow", "400");
  await edge.press("ArrowLeft");
  await expect(edge, "one arrow press is 40px").toHaveAttribute("aria-valuenow", "440");
  await edge.press("ArrowRight");
  await expect(edge).toHaveAttribute("aria-valuenow", "400");
  await edge.press("End");
  await expect(edge, "End goes to the maximum").toHaveAttribute("aria-valuenow", "560");
  await edge.press("Home");
  await expect(edge, "Home goes to the minimum").toHaveAttribute("aria-valuenow", "320");
  expect((await tracks(page)).panel, "the track follows the value").toBe(320);

  await page.getByTestId("qcms-assistant-help").click();
  await page.getByTestId("qcms-assistant-width-560").click();
  await expect(edge).toHaveAttribute("aria-valuenow", "560");
  await expect(page.getByTestId("qcms-assistant-width-560")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await tracks(page)).panel).toBe(560);

  await page.reload();
  await expect(page.getByTestId("qcms-assistant-edge")).toHaveAttribute("aria-valuenow", "560");
});

test("names the screen in the context chip, and keeps the conversation across a form's subtree (exit criteria 3, 9)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/settings");
  await open(page);
  const chip = page.getByTestId("qcms-assistant-context");
  await expect(chip).toHaveText("Workspace settings");

  await page.goto(`/operations/forms/${FORM_ID}/responses`);
  await expect(chip).toContainText("no answers");
  await page.goto(`/forms/${FORM_ID}/publish`);
  await expect(chip).toContainText("publish");

  // The conversation lives in this tab's session storage so a reload keeps it, and in no
  // other store: `localStorage` would outlive the tab and reach every other one.
  const stored = await page.evaluate(() => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
  }));
  for (const key of stored.local) {
    expect(key, "no assistant key in localStorage").not.toMatch(/assist|agent|conversation/iu);
  }
  expect(stored.session, "the conversation is in this tab's session storage").toContain(
    "qcms-assistant-conversation",
  );
});

test("drops the stored conversation when a session ends without the account menu", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto(`/forms/${FORM_ID}`);
  await open(page);
  await fillStable(composer(page), "#qcms-fake:no-proposal what is on this screen");
  await page.getByTestId("qcms-assistant-send").locator("button").click();
  await expect(page.getByTestId("qcms-assistant-turns")).toContainText("what is on this screen");
  expect(
    await page.evaluate(() => Object.keys(window.sessionStorage)),
    "the turn is stored before the session ends",
  ).toContain("qcms-assistant-conversation");

  // An expiry, not a sign-out: the account menu clears the tab on its way out, and it is
  // not the only way a session ends.
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await waitForHydration(page);

  await expect
    .poll(async () => page.evaluate(() => Object.keys(window.sessionStorage)))
    .not.toContain("qcms-assistant-conversation");
});

test("carries one conversation across the form's subtree and out of it, and a reload keeps it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto(`/forms/${FORM_ID}`);

  await chooseEnvironment(page, "test");
  await open(page);

  await fillStable(
    page.getByTestId("qcms-assistant-composer"),
    "#qcms-fake:no-proposal what is on this screen",
  );
  await page.getByTestId("qcms-assistant-send").locator("button").click();
  await expect(page.getByTestId("qcms-assistant-turns")).toContainText("more detail");

  const turns = page.getByTestId("qcms-assistant-turns");
  await page.locator("aside.qcms-rail").getByRole("link", { name: "Publish", exact: true }).click();
  await page.waitForURL(`**/forms/${FORM_ID}/publish`);
  await expect(turns, "the builder's turns are still here").toContainText("what is on this screen");
  await expect(turns).toContainText("more detail");

  await page.locator("header").getByRole("link", { name: "Workspace", exact: true }).click();
  await page.waitForURL("**/workspaces");
  await expect(turns, "leaving the form keeps the conversation").toContainText(
    "what is on this screen",
  );

  await page.reload();
  await waitForHydration(page);
  await expect(
    page.getByTestId("qcms-assistant-turns"),
    "a reload of the same tab keeps it",
  ).toContainText("what is on this screen");

  await page.getByTestId("qcms-assistant-new").click();
  await expect(page.getByTestId("qcms-assistant-empty")).toBeVisible();
});

test("prints the shortcut in a dismissible, hoverable, persistent tooltip (SC 1.4.13)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/operations");
  await waitForHydration(page);

  await expect(button(page)).not.toHaveAttribute("title", /.*/u);

  await button(page).hover();
  const tip = page.getByTestId("qcms-assist-tip");
  await expect(tip).toBeVisible();
  await expect(tip, "the tooltip prints the chord").toContainText("Alt+Shift+A");

  await tip.hover();
  await expect(tip).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
});

test("keeps the dock the height of the viewport, with the composer inside it", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 800 });
  await page.goto(`/forms/${FORM_ID}`);
  await chooseEnvironment(page, "test");
  await open(page);

  const geometry = await page.evaluate(() => {
    const dock = document.getElementById("qcms-assistant-panel")?.getBoundingClientRect();
    const composer = document
      .querySelector("#qcms-assist-composer, #qcms-assistant-composer")
      ?.getBoundingClientRect();
    return {
      dock: Math.round(dock?.height ?? 0),
      composerBottom: Math.round(composer?.bottom ?? 0),
      viewport: window.innerHeight,
    };
  });
  expect(geometry.dock, "the dock is the viewport's height, not the page's").toBeLessThanOrEqual(
    geometry.viewport,
  );
  expect(geometry.dock, "the dock fills the area below the top bar").toBeGreaterThan(
    geometry.viewport - 120,
  );
  expect(geometry.composerBottom, "the composer is within the viewport").toBeLessThanOrEqual(
    geometry.viewport,
  );
  expect(geometry.composerBottom).toBeGreaterThan(0);
});

// Two nested scroll containers put two scrollbars side by side; the conversation owns the only one.
async function panelScrollers(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const root = document.getElementById("qcms-assistant-panel");
    if (root === null) return [];
    return [root, ...root.querySelectorAll("*")]
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .filter((node) => {
        const style = window.getComputedStyle(node);
        const scrolls = /auto|scroll/u.test(`${style.overflowY} ${style.overflowX}`);
        return (
          scrolls &&
          (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
        );
      })
      .map((node) => node.dataset["testid"] ?? node.className);
  });
}

async function expectOneScroller(page: Page, where: string): Promise<void> {
  const scrollers = await panelScrollers(page);
  expect(
    scrollers.filter((name) => name !== "qcms-assistant-turns"),
    `${where} should scroll in the conversation alone`,
  ).toEqual([]);
}

async function expectComposerRingShown(page: Page, where: string): Promise<void> {
  await composer(page).focus();
  const ring = await page.evaluate(() => {
    const area = document.querySelector('[data-testid="qcms-assistant-composer"]');
    const panel = document.getElementById("qcms-assistant-panel");
    if (!(area instanceof HTMLElement) || panel === null) return undefined;
    const style = window.getComputedStyle(area);
    const reach = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
    const box = area.getBoundingClientRect();
    const within = panel.getBoundingClientRect();
    return {
      width: Number.parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      inside:
        box.left - reach >= within.left - 1 &&
        box.right + reach <= within.right + 1 &&
        box.top - reach >= within.top - 1 &&
        box.bottom + reach <= within.bottom + 1,
    };
  });
  expect(ring?.style, `the composer shows a focus ring in ${where}`).not.toBe("none");
  expect(ring?.width ?? 0, `the ${where} focus ring is thick enough to see`).toBeGreaterThanOrEqual(
    2,
  );
  expect(ring?.inside, `the ${where} focus ring is not clipped by the panel`).toBe(true);
}

test("gives the panel one scroll container and holds the page still behind it", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 700 });
  await page.goto(`/forms/${FORM_ID}`);
  await chooseEnvironment(page, "test");
  await open(page);
  await expect(panel(page)).toHaveAttribute("data-mode", "dock");
  await expectOneScroller(page, "the dock");
  await expectComposerRingShown(page, "the dock");

  await page.getByTestId("qcms-assistant-expand").click();
  await expect(panel(page)).toHaveAttribute("data-mode", "expanded");
  await expectOneScroller(page, "the expanded panel");
  await expectComposerRingShown(page, "the expanded panel");

  await page.setViewportSize({ width: 700, height: 700 });
  await expect(panel(page)).toHaveAttribute("data-mode", "sheet");
  await expectOneScroller(page, "the sheet");

  // A programmatic scroll still moves a viewport whose overflow is hidden; only a gesture is blocked.
  await page.mouse.move(350, 350);
  await page.mouse.wheel(0, 1200);
  const fit = await page.evaluate(() => {
    const box = document.getElementById("qcms-assistant-panel")?.getBoundingClientRect();
    const bar = document.querySelector("header.qcms-topbar")?.getBoundingClientRect();
    const composer = document
      .querySelector('[data-testid="qcms-assistant-composer"]')
      ?.getBoundingClientRect();
    return {
      scrolled: Math.round(window.scrollY),
      top: Math.round(box?.top ?? 0),
      bottom: Math.round(box?.bottom ?? 0),
      barBottom: Math.round(bar?.bottom ?? 0),
      composerBottom: Math.round(composer?.bottom ?? 0),
      viewport: window.innerHeight,
    };
  });
  expect(fit.scrolled, "the page behind the sheet does not scroll").toBe(0);
  expect(
    Math.abs(fit.top - fit.barBottom),
    "the sheet starts under the top bar",
  ).toBeLessThanOrEqual(1);
  expect(fit.bottom, "the sheet reaches the foot of the viewport").toBe(fit.viewport);
  expect(fit.composerBottom, "the composer sits at the sheet's foot").toBeGreaterThan(
    fit.viewport - 120,
  );
  expect(fit.composerBottom).toBeLessThanOrEqual(fit.viewport);
});

test("runs no animation on open, close or expand under reduced motion (exit criterion 5)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/operations");
  await open(page);
  await page.getByTestId("qcms-assistant-expand").click();
  await expect(panel(page)).toHaveAttribute("data-mode", "expanded");

  const animated = await page.evaluate(() =>
    [...document.querySelectorAll("#qcms-assistant-panel, #qcms-assistant-panel *")]
      .flatMap((element) => element.getAnimations())
      .filter((animation) => animation.playState === "running")
      .filter(
        (animation) =>
          !(animation instanceof CSSTransition) ||
          /transform|opacity|inset|inline-size|block-size|translate|scale|margin/u.test(
            animation.transitionProperty,
          ),
      )
      .map((animation) => `${animation.constructor.name}:${animation.id}`),
  );
  expect(animated, "animations still running under prefers-reduced-motion: reduce").toEqual([]);
});

test("leaves no control wholly covered with the panel docked (SC 2.4.11, exit criterion 5)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });

  for (const path of ["/operations", `/forms/${FORM_ID}`, "/settings"]) {
    await page.goto(path);
    await open(page);

    // Normalise to the top before measuring focus overlap; the sticky bar otherwise covers transient scroll positions.
    await page.locator("main#main-content").click({ position: { x: 2, y: 2 } });
    for (let press = 0; press < 25; press += 1) {
      await page.keyboard.press("Tab");
      const covered = await page.evaluate(() => {
        const active = document.activeElement;

        if (!(active instanceof HTMLElement) || active === document.body) return null;
        const dock = document.getElementById("qcms-assistant-panel");
        if (dock === null || dock.contains(active)) return null;
        const box = active.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return null;
        const over = dock.getBoundingClientRect();
        const overlaps =
          box.left < over.right &&
          box.right > over.left &&
          box.top < over.bottom &&
          box.bottom > over.top;
        return overlaps ? (active.getAttribute("data-testid") ?? active.tagName) : null;
      });
      expect(covered, `${path}: the dock overlaps a focused control`).toBeNull();
    }
  }
});

test("is axe-green on the button, the dock, the expanded state, the sheet, the empty state and a streaming turn (exit criterion 5)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/operations");
  await waitForHydration(page);

  const sweep = async (where: string, include: string): Promise<void> => {
    const results = await new AxeBuilder({ page })
      .options({ runOnly: { type: "tag", values: TAGS } })
      .include(include)
      .analyze();
    expect(results.violations, `axe violations on ${where}`).toEqual([]);
  };

  await sweep("the closed top-bar button", TOPBAR_SELECTOR);
  await open(page);

  await expect(page.getByTestId("qcms-assistant-empty")).toBeVisible();
  await sweep("the dock and its empty state", '[data-testid="qcms-assistant-panel"]');

  await page.getByTestId("qcms-assistant-expand").click();
  await expect(panel(page)).toHaveAttribute("data-mode", "expanded");
  await sweep("the expanded state", '[data-testid="qcms-assistant-panel"]');
  await page.getByTestId("qcms-assistant-expand").click();

  // Hold the BFF response open so the streaming accessibility state survives long enough for axe.
  await page.route("**/assist", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });
  await fillStable(composer(page), "What is on this screen?");
  await page.getByTestId("qcms-assistant-send").locator("button").click();
  await expect(page.locator('#qcms-assistant-panel [aria-busy="true"]').first()).toBeVisible();
  await sweep("a streaming turn", '[data-testid="qcms-assistant-panel"]');
  await page.getByTestId("qcms-assistant-stop").locator("button").click();
  await page.unroute("**/assist");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel(page)).toHaveAttribute("data-mode", "sheet");
  await sweep("the sheet", '[data-testid="qcms-assistant-panel"]');
});
