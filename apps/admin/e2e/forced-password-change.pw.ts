import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { trackedFilesUnder } from "../../../scripts/tracked-files.mjs";

import {
  TEST_PASSWORD,
  createTestAdmin,
  markProvisional,
  uniqueAdminEmail,
} from "./support/admin-account.js";
import {
  enrollNewAdmin,
  fillStable,
  readSetupKey,
  submitSignIn,
  submitTotp,
} from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

// Discover authenticated routes from disk so adding a route cannot silently bypass this gate sweep.
// The guard runs before the resource fetch, so placeholder ids are sufficient for redirects.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("forcedpw");

const CHOSEN_PASSWORD = `e2e-chosen-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

function shellRoutes(): string[] {
  const routes: string[] = [];
  for (const relative of trackedFilesUnder(SHELL, { match: /(?:^|\/)page\.tsx$/ })) {
    const segments = relative.split("/").slice(0, -1);
    if (segments.some((segment) => segment.startsWith("@"))) continue;
    const route = segments
      .filter((segment) => !segment.startsWith("("))
      .map((segment) => (segment.startsWith("[") ? "/e2e-placeholder" : `/${segment}`))
      .join("");
    routes.push(route === "" ? "/" : route);
  }
  return routes;
}

// Match accessible names: hidden required markers alter label text, and substring labels match confirmation too.
function field(page: Page, name: string): Locator {
  return page.getByRole("textbox", { name, exact: true });
}

// Fill sequentially: concurrent controlled-input fills interleave React commits and can lose a field's value.
async function fillChange(
  page: Page,
  values: { readonly current: string; readonly next: string; readonly confirm: string },
): Promise<void> {
  await fillStable(field(page, "Temporary password"), values.current);
  await fillStable(field(page, "New password"), values.next);
  await fillStable(field(page, "Confirm new password"), values.confirm);
}

// Next adds a route-announcer alert outside main during hydration; scope to the page's own alert.
function alertText(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL, { mustChangePassword: true });
});

test("first sign-in lands on the password change, BEFORE 2FA enrollment", async ({ page }) => {
  // Password replacement must precede enrollment so the factor cannot bind while the provisioning password remains active.
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole("heading", { name: "Choose your own password" })).toBeVisible();

  await page.goto("/two-factor/enroll");
  await expect(page).toHaveURL(/\/change-password$/);
});

test("no admin route is reachable until the password is changed", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  const routes = shellRoutes();

  expect(routes.length).toBeGreaterThan(10);

  for (const route of routes) {
    await page.goto(route);
    await expect(page, `${route} was reachable while the bootstrap credential stood`).toHaveURL(
      /\/change-password$/,
    );
  }
});

test("no admin route is reachable by an ENROLLED account still holding the credential", async ({
  page,
}) => {
  // Use an enrolled provisional account too: an unenrolled account can redirect through enrollment's duplicate guard.
  const enrolledEmail = uniqueAdminEmail("forcedpw-enrolled");
  await createTestAdmin(enrolledEmail);
  await enrollNewAdmin(page, enrolledEmail);
  await markProvisional(enrolledEmail);

  const routes = shellRoutes();
  expect(routes.length).toBeGreaterThan(10);
  for (const route of routes) {
    await page.goto(route);
    await expect(
      page,
      `${route} was reachable by an enrolled account still on the bootstrap credential`,
    ).toHaveURL(/\/change-password$/);
  }
});

test("the screen refuses what it should, and says so without naming the account", async ({
  page,
}) => {
  await submitSignIn(page, EMAIL);

  await fillChange(page, {
    current: TEST_PASSWORD,
    next: CHOSEN_PASSWORD,
    confirm: `${CHOSEN_PASSWORD}x`,
  });
  await Promise.all([
    page.waitForURL(/\/change-password\?mismatch=1$/),
    page.getByRole("button", { name: "Change password" }).click(),
  ]);
  await expect(alertText(page)).toContainText("did not match. Please type them again");

  await fillChange(page, {
    current: `${TEST_PASSWORD}-wrong`,
    next: CHOSEN_PASSWORD,
    confirm: CHOSEN_PASSWORD,
  });
  await Promise.all([
    page.waitForURL(/\/change-password\?error=1$/),
    page.getByRole("button", { name: "Change password" }).click(),
  ]);
  await expect(alertText(page)).toContainText("Those details did not match");

  await page.goto("/questions");
  await expect(page).toHaveURL(/\/change-password$/);
});

test("the screen is operable from the keyboard alone, with focus visible", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await waitForHydration(page);

  const order = [
    field(page, "Temporary password"),
    field(page, "New password"),
    field(page, "Confirm new password"),
    page.getByRole("button", { name: "Change password" }),
  ];
  await order[0]?.focus();
  for (const [index, control] of order.entries()) {
    if (index > 0) await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }

  const outline = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return "";
    const style = window.getComputedStyle(active);
    return `${style.outlineStyle}|${style.outlineWidth}`;
  });
  expect(outline).not.toMatch(/^none\|/);
});

test("a successful change opens 2FA enrollment, and the account reaches the shell", async ({
  page,
}) => {
  await submitSignIn(page, EMAIL);
  await fillChange(page, {
    current: TEST_PASSWORD,
    next: CHOSEN_PASSWORD,
    confirm: CHOSEN_PASSWORD,
  });
  await Promise.all([
    page.waitForURL(/\/two-factor\/enroll$/),
    page.getByRole("button", { name: "Change password" }).click(),
  ]);

  const secret = await readSetupKey(page);
  await submitTotp(page, secret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
  await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
});

test("the changed account is unaffected from then on", async ({ page }) => {
  await page.goto("/sign-in");

  await fillStable(page.getByLabel("Email"), EMAIL);
  await fillStable(page.getByLabel("Password"), CHOSEN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/two-factor\/challenge$/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  await expect(page).not.toHaveURL(/\/change-password/);
});

test("the forced screen is not a second change-password surface", async ({ page }) => {
  await page.goto("/change-password");

  await expect(page).toHaveURL(/\/sign-in$/);
});
