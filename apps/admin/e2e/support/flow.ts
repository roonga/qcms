import { expect, type Locator, type Page } from "@playwright/test";
import { generate } from "otplib";

import { TEST_PASSWORD } from "./admin-account.js";
import { waitForHydration } from "./hydration.js";

// Hydration can overwrite pre-attach input, and dev recompilation can replace the whole document.
// Re-wait inside each retry so a replacement document cannot reopen the hydration race.
export async function fillStable(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await waitForHydration(field.page());
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

// Serial mode preserves test order, not browser cookies; each test must establish its own session.

// Wait for the redirect to commit before another navigation can race the sign-in POST.
export async function submitSignIn(page: Page, email: string): Promise<void> {
  await page.goto("/sign-in");
  await waitForHydration(page);
  await fillStable(page.getByLabel("Email"), email);
  await fillStable(page.getByLabel("Password"), TEST_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/sign-in" || url.search !== ""),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
}

// Read within the enrollment flow: each unconfirmed sign-in provisions a fresh secret.
export async function readSetupKey(page: Page): Promise<string> {
  return page.getByLabel(/Setup key/).inputValue();
}

export async function submitTotp(page: Page, secret: string): Promise<void> {
  await fillStable(page.getByLabel(/Six-digit code/), await generate({ secret }));
  await page.getByRole("button", { name: "Verify" }).click();
}

export async function submitRecoveryCode(page: Page, code: string): Promise<void> {
  await fillStable(page.getByLabel(/Recovery code/), code);
  await page.getByRole("button", { name: "Verify" }).click();
}

// A narrower persona must specify its own landing route so a wrong redirect cannot pass.
const DEFAULT_LANDING = /\/questions$/;

// Wait for the shell before callers navigate again; the factor POST may still be redirecting.
export async function signInWithTotp(
  page: Page,
  email: string,
  secret: string,
  landing: RegExp = DEFAULT_LANDING,
): Promise<void> {
  await submitSignIn(page, email);
  await submitTotp(page, secret);
  await page.waitForURL(landing);
}

// Match accessible names so missing labels fail; account initials are variable and precede the stable suffix.
export function appearanceTrigger(page: Page): Locator {
  return page.getByRole("button", { name: /^Appearance: / });
}

export function accountTrigger(page: Page): Locator {
  return page.getByRole("button", { name: /, account menu for / });
}

// Wait before the first press: retrying a slow toggle can close the menu it just opened.
export async function openMenu(trigger: Locator): Promise<void> {
  await waitForHydration(trigger.page());
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(trigger.page().getByRole("menu")).toBeVisible();
}

export async function openAppearance(page: Page): Promise<void> {
  const trigger = appearanceTrigger(page);
  await waitForHydration(page);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog", { name: "Appearance" })).toBeVisible();
}

// The reachable sign-out control is a menu item; the fallback button is hidden while scripting runs.
export async function signOut(page: Page): Promise<void> {
  await openMenu(accountTrigger(page));
  await Promise.all([
    page.waitForURL(/\/sign-in/),
    page.getByRole("menuitem", { name: "Sign out" }).click(),
  ]);
}

// Exercise real enrollment and verification instead of setting a confirmed factor behind the browser.
export async function enrollNewAdmin(
  page: Page,
  email: string,
  landing: RegExp = DEFAULT_LANDING,
): Promise<string> {
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  // The URL can commit before the enrollment DOM is ready for the secret read.
  await waitForHydration(page);
  const secret = await readSetupKey(page);
  await submitTotp(page, secret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await page.waitForURL(landing);
  return secret;
}

// Poll after unmounting actions: focus restoration happens in an effect. Return the actual target for diagnostics.
export function activeElementId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active === null) return "";
    return active.id === "" ? active.tagName : active.id;
  });
}
