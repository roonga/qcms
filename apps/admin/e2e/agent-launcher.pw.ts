import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { chooseEnvironment } from "./support/environment.js";
import { enrollNewAdmin, fillStable, signInWithTotp } from "./support/flow.js";
import { submitResponse } from "./support/ops.js";
import { waitForHydration } from "./support/hydration.js";
import { TOPBAR_SELECTOR } from "../lib/topbar.js";

/**
 * The assistant on every authenticated screen: the top-bar button, the dock, the expanded
 * state and the sheet (task 082, exit criteria 2 to 5).
 *
 * ## Why these claims are in a browser and not in Vitest
 *
 * Every one of them is geometry, a cookie read on the first paint, a focus move or a
 * computed animation, and jsdom has none of those. The dock is a grid track, so what the
 * criteria are actually about is what the three columns measure beside each other; the
 * panel's cookie is about the FIRST frame rather than the settled one; and the rail's
 * behaviour between 1024 and 1279 px is a width the harness has to be put at.
 *
 * ## The flag is on for the whole run, so "absent with the flag off" is not here
 *
 * `playwright.config.ts` starts the admin with `QCMS_FLAG_AGENT_AUTHORING=fake`, and one
 * Playwright run cannot hold both flag states. The flag-off stance - the component absent
 * from the document rather than hidden in it - is asserted in
 * `components/agent/assistant-dock.test.tsx`, which renders the slots with no provider,
 * which is exactly what the layout does when the flag is off.
 *
 * ## Each test sets its own state
 *
 * A Playwright test gets a fresh browser context, so the panel cookie and the sidebar
 * cookie are written per test rather than once in a `beforeAll`: a test that relied on a
 * neighbour's cookie would pass or fail on the ordering.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("agentlauncher082");

/** Set by the first test; every later test signs in with it. */
let totpSecret = "";

/** Where the rail and the dock both fit beside 640px of content (exit criterion 3). */
const WIDE = 1280;

/** The middle range: a rail, a panel and 640px of content do not fit together. */
const HELD = 1100;

/** `--bp-compact`: the floor the content column keeps with the panel open. */
const COMPACT = 640;

/** The dock's default and its cap in the held range. */
const DEFAULT_WIDTH = 400;

/** The seeded insurance fixture, as every form-scoped spec in this suite uses it. */
const FORM_ID = "frm_auto_quote";

/** The workspace a bootstrapped installation is seeded with. */
const WORKSPACE_ID = "org_default_workspace";

/** The seeded fixture's published version, which its history screen addresses. */
const VERSION = 1;

/** A question of the seeded fixture, which its detail screen addresses. */
const QUESTION_ID = "q_at_fault_accident";

/** The respondent path this spec submits one response through, for the detail screen. */
const SLUG = "auto";
const ACCIDENT = "q_at_fault_accident";
const COUNT = "q_accident_count";

/**
 * Every `(shell)` page pattern the button has to be on, Settings included (Q18). One entry
 * per row of `lib/agent/screens.ts`, so criterion 2 walks the whole table rather than the
 * screens that need no id; the response detail screen's id is submitted by the test.
 */
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
  `/forms/${FORM_ID}/links`,
  `/forms/${FORM_ID}/webhooks`,
  `/forms/${FORM_ID}/responses`,
  "/me/access",
  "/operations",
  "/responses",
  "/responses/erasures",
  "/settings",
  "/webhooks",
  "/workspaces",
  `/workspaces/${WORKSPACE_ID}`,
];

/** Screens outside `(shell)`: there is no signed-in user to act for (section 1.4). */
const UNAUTHENTICATED_PAGES: readonly string[] = [
  "/sign-in",
  "/two-factor/challenge",
  "/change-password",
];

const PANEL_COOKIE = "qcms-assistant";
const SIDEBAR_COOKIE = "qcms-sidebar";

/** The tag set `e2e/a11y-axe.pw.ts` sweeps with, so this file measures the same bar. */
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

/** Write the panel cookie before the first navigation, the way a returning tab carries it. */
async function withPanelCookie(page: Page, value: string): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: PANEL_COOKIE, value, domain: "localhost", path: "/", sameSite: "Lax" as const },
    ]);
}

/** The three tracks of the shell body, in CSS px. */
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

/** Open the panel if it is not already: the panel cookie carries an open panel across a
 * navigation, and a second press on the top-bar button would close it. */
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

  // One real submission, so the response detail screen has a session to address.
  const sessionId = await submitResponse(SLUG, [
    [ACCIDENT, true],
    [COUNT, 1],
  ]);

  for (const path of [...SHELL_PAGES, `/forms/${FORM_ID}/responses/${sessionId}`]) {
    await page.goto(path);
    await expect(button(page), `${path} carries the assistant button`).toBeVisible();
    await expect.soft(button(page), `${path} carries exactly one`).toHaveCount(1);

    // First in the trailing group, which is also what puts it before the account control:
    // both are children of that one group. Document order rather than x, because the bar
    // wraps at narrow widths and an x comparison would be reading two rows (issue #1011).
    //
    // The group is the account control's own parent, because `header .flex-shrink-0` also
    // matches the wordmark, which is a sibling of the whole group rather than part of it.
    // Asserted with locators rather than `page.evaluate`, so a navigation the admin makes
    // mid-walk retries instead of destroying the execution context under the read.
    const group = page.locator('[data-testid="account-menu"]').locator("xpath=..");
    await expect(
      group.locator(':scope > *:first-child [data-testid="qcms-assistant-button"]'),
      `${path} puts the button first in the top bar's trailing group`,
    ).toHaveCount(1);
    await expect(
      group.locator(':scope > [data-testid="account-menu"]'),
      `${path} keeps the account control in that same group`,
    ).toHaveCount(1);

    // Retired with the dock (issue #1133): no corner launcher anywhere.
    await expect
      .soft(page.locator(".qcms-assist-launcher"), `${path} has no floating launcher`)
      .toHaveCount(0);
  }

  // Signed out, so the unauthenticated screens render as themselves.
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

  // Focused again rather than toggled closed, which is what "opens or focuses" means.
  await page.locator("main#main-content").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Alt+Shift+A");
  await expect(composer(page)).toBeFocused();

  await page.getByTestId("qcms-assistant-close").click();
  await expect(panel(page)).toBeHidden();

  // A page text input holds the chord: `a` has to reach the field. The library's rail
  // filter is the input this uses, because it is a text box the screen owns rather than
  // one of the panel's, and it is present on a list screen without creating anything.
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

  // Closed, with the turn still running: the state is short text, never colour or motion
  // alone (ruling O3).
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

  // Before hydration: the server stamped the track from the cookie, so the panel is
  // already there and the content column is already narrowed.
  await expect(panel(page)).toBeVisible();
  const first = await tracks(page);
  expect(first.panel, "the cookie's width is the first paint's width").toBe(DEFAULT_WIDTH);

  await waitForHydration(page);
  const settled = await tracks(page);
  expect(settled, "hydration moves no track").toEqual(first);

  // At 1280 and wider the rail keeps its own track beside the dock and the content column
  // keeps `--bp-compact`.
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

  // A hold writes no cookie, so the operator's own Hide sidebar choice is untouched
  // (ruling O1). This is the half a `setSetting` call would silently break.
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

test("1133 Show sidebar shows the rail, closes the panel and says so (ruling O2)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: HELD, height: 900 });
  await page.goto("/operations");
  await open(page);
  await expect(page.locator("html")).toHaveAttribute("data-sidebar-hold", "hidden");

  await page.getByTestId("qcms-show-sidebar").click();
  await expect(panel(page), "Show sidebar closes the panel").toBeHidden();
  const after = await tracks(page);
  expect(after.rail, "Show sidebar shows the rail").toBeGreaterThan(200);
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

  // In the dock, Escape moves focus back to the page and the dock stays open.
  await composer(page).focus();
  await page.keyboard.press("Escape");
  await expect(panel(page), "Escape does not close the dock").toBeVisible();
  await expect(page.locator("main#main-content")).toBeFocused();

  // Expanded: a modal dialog over the whole area below the top bar, with everything
  // behind it inert, and Escape returns it to the dock.
  await page.getByTestId("qcms-assistant-expand").click();
  await expect(panel(page)).toHaveAttribute("data-mode", "expanded");
  await expect(panel(page)).toHaveRole("dialog");
  await expect(page.getByTestId("qcms-assistant-expand")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("main#main-content")).toHaveAttribute("inert", "");
  await page.getByTestId("qcms-assistant-expand").press("Escape");
  await expect(panel(page)).toHaveAttribute("data-mode", "dock");
  await expect(page.locator("main#main-content")).not.toHaveAttribute("inert", "");

  // The sheet below `--bp-sidebar`: Escape closes it and focus returns to the button.
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

  // SC 1.4.10: no horizontal scroll at 320 CSS px.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the sheet reflows at 320px with no horizontal scroll").toBeLessThanOrEqual(1);

  // The trap: everything behind the sheet is inert, so twenty tab presses never leave it.
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

  // The single-pointer alternative (SC 2.5.7): three named widths, one click each.
  await page.getByTestId("qcms-assistant-help").click();
  await page.getByTestId("qcms-assistant-width-560").click();
  await expect(edge).toHaveAttribute("aria-valuenow", "560");
  await expect(page.getByTestId("qcms-assistant-width-560")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect((await tracks(page)).panel).toBe(560);

  // Kept in the panel cookie, so the width survives the next document.
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

  // A different screen says a different thing: the chip is per screen, not one string.
  // The form's response screen rather than `/responses`, which redirects to Operations.
  await page.goto(`/forms/${FORM_ID}/responses`);
  await expect(chip).toContainText("no answers");
  await page.goto(`/forms/${FORM_ID}/publish`);
  await expect(chip).toContainText("publish");

  // Nothing of the conversation or the panel reaches tab storage (Q15).
  const stored = await page.evaluate(() => ({
    local: Object.keys(window.localStorage),
    session: Object.keys(window.sessionStorage),
  }));
  for (const key of [...stored.local, ...stored.session]) {
    expect(key, "no assistant key in tab storage").not.toMatch(/assist|agent|conversation/iu);
  }
});

test("carries the builder's turns across the form's subtree and starts fresh outside it (exit criterion 9)", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto(`/forms/${FORM_ID}`);
  // The draft is the test environment's, so the builder is only mounted there.
  await chooseEnvironment(page, "test");
  await open(page);

  // The builder's own panel is the dock's body here, so its composer is the one to type in.
  const hosted = page.getByTestId("qcms-assist-input").locator("textarea");
  await fillStable(hosted, "#qcms-fake:no-proposal what is on this screen");
  await page.getByTestId("qcms-assist-send").locator("button").click();
  await expect(page.getByTestId("qcms-assist-conversation")).toContainText("more detail");

  // Soft navigation, which is what the conversation survives: the turns are held in memory
  // for as long as the tab's shell lives.
  const turns = page.getByTestId("qcms-assistant-turns");
  await page.locator("aside.qcms-rail").getByRole("link", { name: "Publish", exact: true }).click();
  await page.waitForURL(`**/forms/${FORM_ID}/publish`);
  await expect(turns, "the builder's turns are still here").toContainText("what is on this screen");
  await expect(turns).toContainText("more detail");

  // Leaving the form is a new subject, so the conversation starts empty.
  await page.locator("header").getByRole("link", { name: "Operations" }).click();
  await page.waitForURL("**/operations");
  await expect(page.getByTestId("qcms-assistant-empty")).toBeVisible();

  // Returning within the tab restores the form's own conversation.
  await page.goBack();
  await page.waitForURL(`**/forms/${FORM_ID}/publish`);
  await expect(turns, "returning restores the conversation").toContainText(
    "what is on this screen",
  );

  // A reload starts fresh: nothing of it was written anywhere.
  await page.reload();
  await waitForHydration(page);
  await expect(page.getByTestId("qcms-assistant-empty")).toBeVisible();
});

test("prints the shortcut in a dismissible, hoverable, persistent tooltip (SC 1.4.13)", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: WIDE, height: 900 });
  await page.goto("/operations");
  await waitForHydration(page);

  // A native `title` satisfies none of the three properties, so there is none.
  await expect(button(page)).not.toHaveAttribute("title", /.*/u);

  await button(page).hover();
  const tip = page.getByTestId("qcms-assist-tip");
  await expect(tip).toBeVisible();
  await expect(tip, "the tooltip prints the chord").toContainText("Alt+Shift+A");

  // Hoverable: the pointer can rest on the bubble itself.
  await tip.hover();
  await expect(tip).toBeVisible();

  // Dismissible, without moving the pointer.
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

  // Keyframe animations, and the transitions that would move or fade something. A colour
  // or outline transition on the control the pointer is still over is not the open, close
  // or expand motion the criterion is about, and the reduced-motion reset in `globals.css`
  // has already cut every transition to a single frame.
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

    // Tab through the page's own controls and measure each landing. The dock is a grid
    // track, so the claim is that nothing it draws overlaps the focused control at all;
    // the top bar is sticky and is excluded by scrolling to the top first, which is
    // `e2e/focus-not-obscured.pw.ts`'s own normalisation.
    await page.locator("main#main-content").click({ position: { x: 2, y: 2 } });
    for (let press = 0; press < 25; press += 1) {
      await page.keyboard.press("Tab");
      const covered = await page.evaluate(() => {
        const active = document.activeElement;
        // The body is where focus lands once it has left the last control of the document,
        // and it is not a control the criterion says anything about.
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
  // The empty state is what the dock shows before the first turn, so one sweep is both.
  await expect(page.getByTestId("qcms-assistant-empty")).toBeVisible();
  await sweep("the dock and its empty state", '[data-testid="qcms-assistant-panel"]');

  await page.getByTestId("qcms-assistant-expand").click();
  await expect(panel(page)).toHaveAttribute("data-mode", "expanded");
  await sweep("the expanded state", '[data-testid="qcms-assistant-panel"]');
  await page.getByTestId("qcms-assistant-expand").click();

  // A streaming turn, held open by stalling the BFF route rather than by a scripted
  // provider: the in-progress bubble and its `aria-busy` are what this state is, and a
  // stalled response pins them for as long as the sweep needs instead of racing a stream
  // that may already have finished.
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
