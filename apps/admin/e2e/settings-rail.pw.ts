import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

/**
 * The Settings rail and its panels in a browser (issue 655).
 *
 * The markup and the section list are pinned without a browser
 * (`components/settings-section-rail.test.tsx`, `components/settings-panels.test.tsx`,
 * `lib/settings-sections.test.ts`). What is left is everything that is a computed style, a
 * measured box or an interaction, and that is what this file is: the 240px track turning on
 * at `--bp-sidebar` and not one pixel below it, the 40rem column left-anchored rather than
 * centred, and the switch itself - a rail button changing what the body shows, what the
 * heading says and which row is marked, all three together.
 *
 * ## The switch crosses two React trees, so a browser is the only place it can be asserted
 *
 * The rail is a parallel-route slot so that it renders BESIDE the capped content column, and
 * the panels are in the page. Nothing renders both, so no static render can see the two
 * agree. Here they are one document and the assertion is the obvious one.
 *
 * ## JavaScript is required, deliberately, and there is no scriptless case below
 *
 * `plan/admin-shell-poc/settings-newquestion-poc.html` switches panels with a script and that
 * is the approved design for this screen. The no-script floor belongs to the respondent
 * portal, which is a different app with a different audience. A previous build of this screen
 * treated it as binding here and produced fragment anchors where the POC draws buttons, which
 * is what issue 655 corrects.
 *
 * ## The 1023 / 1024 pair
 *
 * Same shape issues 557 and 559 take, for the same reason: a boundary is only pinned by
 * measuring both sides of it. The app has two breakpoints, and a rail that collapsed at 1000
 * or at 1100 would be a third boundary nobody wrote down.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("settingsrail655");

/** `--bp-sidebar` is 64rem, and the browser's default root size makes that 1024px. */
const SIDEBAR = 1024;

/** The POC's own cap for this screen: `max-width: 40rem`, which is 640 CSS pixels. */
const PROSE_CAP = 640;

/** Set by the first test; every later one signs in and reuses the account it enrolled. */
let totpSecret = "";

/** The panel ids in reading order, which is also the order their rail rows are in. */
const PANELS = [
  "settings-panel-account",
  "settings-panel-password",
  "settings-panel-twofactor",
] as const;

/**
 * Which panels are on screen, and which row is marked, read in one pass.
 *
 * Read together rather than asserted separately because the claim is that the three move as
 * one: a run where the panel switched and the mark did not would pass two of three separate
 * assertions and describe a screen nobody would ship.
 */
async function stateOf(page: Page): Promise<{
  readonly shown: string[];
  readonly marked: string[];
  readonly heading: string;
}> {
  return page.evaluate((panelIds: readonly string[]) => {
    const heading = document.querySelector("h1#settings-page-heading");
    return {
      shown: panelIds.filter((id) => {
        const panel = document.querySelector(`#${id}`);
        return panel !== null && getComputedStyle(panel).display !== "none";
      }),
      marked: [...document.querySelectorAll('.qcms-settings-rail__link[aria-current="page"]')].map(
        (row) => row.getAttribute("aria-controls") ?? "",
      ),
      heading: heading?.textContent ?? "",
    };
  }, PANELS);
}

/**
 * A rail row by its name, scoped to the rail.
 *
 * Scoped rather than located from the page, because the password panel's submit button is
 * also called "Change password" - correctly, it is the same action named the same way - and
 * an unscoped role query would match the rail row only while that panel happened to be
 * hidden. A test that passes because of what is hidden is a test that stops meaning what it
 * says the moment the screen it is testing changes.
 */
function railRow(page: Page, name: string): Locator {
  return page.getByTestId("qcms-settings-rail").getByRole("button", { name, exact: true });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("655 turns the Settings rail into a 240px column at --bp-sidebar, and not one below", async ({
  page,
}) => {
  test.setTimeout(600_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);

  await page.setViewportSize({ width: SIDEBAR, height: 900 });
  await page.goto("/settings");
  await expect(page.getByTestId("qcms-settings-rail")).toBeVisible();

  const at = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-settings-rail"]');
    const main = document.querySelector("main#main-content");
    if (rail === null || main === null) throw new Error("the rail and the column must both exist");
    return {
      railWidth: rail.getBoundingClientRect().width,
      railRight: rail.getBoundingClientRect().right,
      mainLeft: main.getBoundingClientRect().left,
    };
  });
  expect(at.railWidth, "the 240px track this rail shares with the route rail").toBe(240);
  // The consequence issue 623 settled: a rail nested inside `<main>` would take 240px off the
  // measure the route table assigns this screen. Beside it, the cap keeps measuring content.
  expect(at.railRight, "the rail is beside the content column, not inside it").toBeLessThanOrEqual(
    at.mainLeft,
  );

  await page.setViewportSize({ width: SIDEBAR - 1, height: 900 });
  await page.goto("/settings");
  const below = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="qcms-settings-rail"]');
    const main = document.querySelector("main#main-content");
    if (rail === null || main === null) throw new Error("the rail and the column must both exist");
    return {
      railWidth: rail.getBoundingClientRect().width,
      railBottom: rail.getBoundingClientRect().bottom,
      mainTop: main.getBoundingClientRect().top,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(below.railWidth, "one pixel below the boundary it is the full width").toBe(
    below.viewportWidth,
  );
  expect(
    below.railBottom,
    "and stacked above the column rather than beside it",
  ).toBeLessThanOrEqual(below.mainTop);
});

test("655 opens on Account with one panel showing and one row marked", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");

  // The POC's resting state: Account, and the two others `hidden` rather than scrolled past.
  await expect
    .poll(async () => (await stateOf(page)).shown)
    .toStrictEqual(["settings-panel-account"]);
  const state = await stateOf(page);
  expect(state.marked, "exactly one row is current, and it is Account").toStrictEqual([
    "settings-panel-account",
  ]);
  expect(state.heading, "the heading names the section, not the screen").toBe("Account");
  // The screen's name is in the rail summary instead, which is where the POC puts it.
  await expect(page.locator(".qcms-rail__summary-text")).toHaveText("Settings");
});

test("655 switches the panel, the heading and the mark together when a row is pressed", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");

  await railRow(page, "Change password").click();
  await expect
    .poll(async () => (await stateOf(page)).shown, {
      message: "pressing a rail row shows that section's panel and hides the other two",
    })
    .toStrictEqual(["settings-panel-password"]);
  const password = await stateOf(page);
  expect(password.marked).toStrictEqual(["settings-panel-password"]);
  expect(password.heading).toBe("Change password");
  // What the reader came for is actually on screen, not merely un-hidden in the DOM.
  await expect(page.getByLabel("Current password")).toBeVisible();

  await railRow(page, "Two-factor authentication").click();
  await expect
    .poll(async () => (await stateOf(page)).shown)
    .toStrictEqual(["settings-panel-twofactor"]);
  const twoFactor = await stateOf(page);
  expect(twoFactor.marked, "the mark moves rather than accumulating").toStrictEqual([
    "settings-panel-twofactor",
  ]);
  expect(twoFactor.heading).toBe("Two-factor authentication");
  // And the panel that was showing is genuinely gone, not merely behind the new one.
  await expect(page.getByLabel("Current password")).toBeHidden();
});

test("655 works from the keyboard alone, which is what makes a button rail legitimate", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");

  // Focused rather than clicked, then activated with the key a button answers to. A rail of
  // `<div onclick>` would pass every other assertion in this file and fail this one.
  const row = railRow(page, "Two-factor authentication");
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await stateOf(page)).shown)
    .toStrictEqual(["settings-panel-twofactor"]);
  // The state change lands on the element that still has focus, which is what a screen reader
  // announces when the reader presses it. Focus is not moved: nothing was navigated to.
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(row).toBeFocused();
});

test("655 opens on the panel the URL names, by fragment and by redirect marker", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  // The account menu has linked to this fragment since task 032. Under the stacked screen it
  // scrolled; under the panel screen it selects. Either way the link keeps working.
  await page.goto("/settings#change-password");
  await expect
    .poll(async () => (await stateOf(page)).shown)
    .toStrictEqual(["settings-panel-password"]);

  // And the marker a POST lands its reader back with, which is decided on the server so the
  // confirmation is in the first HTML rather than appearing after hydration.
  await page.goto("/settings?changed=1");
  await expect
    .poll(async () => (await stateOf(page)).shown)
    .toStrictEqual(["settings-panel-password"]);
  await expect(
    page.getByText("Your password was changed and other sessions were signed out."),
    "the message is on the panel the marker opened, not behind a hidden one",
  ).toBeVisible();
});

test("655 caps the column at 40rem and leaves it against the rail, not centred", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");

  const measured = await page.evaluate(() => {
    const main = document.querySelector("main#main-content");
    const rail = document.querySelector('[data-testid="qcms-settings-rail"]');
    if (main === null || rail === null) throw new Error("the column and the rail must exist");
    return {
      cap: Number.parseFloat(getComputedStyle(main).maxWidth),
      width: main.getBoundingClientRect().width,
      left: main.getBoundingClientRect().left,
      railRight: rail.getBoundingClientRect().right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(measured.cap, "the POC's own `max-width: 40rem`").toBe(PROSE_CAP);
  expect(measured.width).toBe(PROSE_CAP);
  // `margin: 0`, not `margin: 0 auto`. The column starts where the rail ends; centred, it
  // would start roughly a third of the way across a 1280 viewport instead.
  expect(measured.left, "left-anchored against the rail's track").toBe(measured.railRight);
  expect(
    measured.left,
    "and nowhere near the middle, which is what centring would have made of it",
  ).toBeLessThan((measured.viewportWidth - PROSE_CAP) / 2);
});

test("655 leaves every other screen without a Settings rail, on a hard load and on a soft one", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Settings is the single named exception, not the first of a series.
  await page.goto("/settings");
  await expect(page.getByTestId("qcms-settings-rail")).toBeVisible();
  await page.goto("/questions");
  await expect(page.getByTestId("qcms-settings-rail")).toHaveCount(0);
  await expect(page.getByTestId("qcms-rail")).toHaveCount(0);

  // THE SOFT NAVIGATION, which is the half that did not hold until now (issue 701, and
  // issue 633 before it). Next keeps the previously active state of a slot the new URL does
  // not match and consults `default.tsx` only after a full-page load, so clicking through
  // left this rail standing beside a screen it says nothing about. It is fixed by every
  // route having a page in the slot rather than by a fallback, and it has to be asserted by
  // CLICKING: `page.goto` is a hard load and passes against the bug, which is why the four
  // assertions above never caught it.
  //
  // All four destinations, because issue 701 predicted that only the two with a directory
  // under `@rail` would go stale. Measured against the shipped build before this change,
  // all four did: the mechanism is the documented soft-navigation rule and has nothing to
  // do with which directories exist, so the per-directory `default.tsx` that issue
  // suggested would not have fixed any of them.
  for (const [name, path] of [
    ["Questions", "/questions"],
    ["Forms", "/forms"],
    ["Responses", "/responses"],
    ["Webhooks", "/webhooks"],
  ] as const) {
    await page.goto("/settings");
    await expect(page.getByTestId("qcms-settings-rail")).toBeVisible();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`, "u"));
    await expect
      .soft(page.getByTestId("qcms-settings-rail"), `walking to ${path} leaves the rail behind`)
      .toHaveCount(0);
    await expect.soft(page.getByTestId("qcms-rail"), `${path} has no rail at all`).toHaveCount(0);
  }
});
