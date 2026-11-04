import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("settingsrail655");

const SIDEBAR = 1024;

const PROSE_CAP = 640;

let totpSecret = "";

const PANELS = [
  "settings-panel-account",
  "settings-panel-password",
  "settings-panel-twofactor",
] as const;

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
      marked: [...document.querySelectorAll('.qcms-rail__link[aria-current="page"]')].map(
        (row) => row.getAttribute("aria-controls") ?? "",
      ),
      heading: heading?.textContent ?? "",
    };
  }, PANELS);
}

function railRow(page: Page, name: string): Locator {
  return page.getByTestId("qcms-settings-rail").getByRole("link", { name, exact: true });
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

  await expect
    .poll(async () => (await stateOf(page)).shown)
    .toStrictEqual(["settings-panel-account"]);
  const state = await stateOf(page);
  expect(state.marked, "exactly one row is current, and it is Account").toStrictEqual([
    "settings-panel-account",
  ]);
  expect(state.heading, "the heading names the section, not the screen").toBe("Account");

  await expect(page.locator(".qcms-rail__summary-text")).toHaveText("Settings");
});

test("655 switches the panel, the heading and the mark together when a row is followed", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");

  await railRow(page, "Change password").click();
  await expect
    .poll(async () => (await stateOf(page)).shown, {
      message: "following a rail row shows that section's panel and hides the other two",
    })
    .toStrictEqual(["settings-panel-password"]);
  const password = await stateOf(page);
  expect(password.marked).toStrictEqual(["settings-panel-password"]);
  expect(password.heading).toBe("Change password");

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

  await expect(page.getByLabel("Current password")).toBeHidden();
});

test("655 works from the keyboard alone, which is what makes a rail of rows legitimate", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings");

  const row = railRow(page, "Two-factor authentication");
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => (await stateOf(page)).shown)
    .toStrictEqual(["settings-panel-twofactor"]);

  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(row).toBeFocused();
  await expect(page).toHaveURL(/#two-factor$/u);
});

test("655 opens on the panel the URL names, by fragment and by redirect marker", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/settings#change-password");
  await expect
    .poll(async () => (await stateOf(page)).shown)
    .toStrictEqual(["settings-panel-password"]);

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

  await page.goto("/settings");
  await expect(page.getByTestId("qcms-settings-rail")).toBeVisible();
  await page.goto("/questions");
  await expect(page.getByTestId("qcms-settings-rail")).toHaveCount(0);
  await expect(page.getByTestId("qcms-rail")).toHaveCount(0);

  // Use soft navigation: Next preserves unmatched parallel-slot state and reads default.tsx only on hard loads.
  // A goto-only check cannot detect a rail left behind after clicking to another screen.
  for (const [name, path] of [
    ["Questions", "/questions"],
    ["Forms", "/forms"],
    ["Operations", "/operations"],
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
