import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";

// The reveal is spent once confirmed; each test needs a newly enrolled account and its own issued set.
async function landOnTheReveal(page: Page, label: string): Promise<void> {
  const email = uniqueAdminEmail(label);
  await createTestAdmin(email);
  await submitSignIn(page, email);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  await submitTotp(page, await readSetupKey(page));
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
}

const status = (page: Page) => page.getByTestId("qcms-recovery-copy-status");
const copyButton = (page: Page) => page.getByRole("button", { name: "Copy codes" });

test("copies every visible code to the clipboard and says so", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await landOnTheReveal(page, "copy683");

  // Mount the empty live region before the outcome; inserting it already populated is not reliably announced.
  await expect(status(page)).toBeAttached();
  await expect(status(page)).toHaveAttribute("aria-live", "polite");
  await expect(status(page)).toHaveText("");

  const codes = await page
    .getByRole("list", { name: "Recovery codes" })
    .getByRole("listitem")
    .allInnerTexts();
  expect(codes.length, "the reveal should print a full set").toBeGreaterThanOrEqual(5);

  await copyButton(page).click();
  await expect(status(page)).toHaveText("Codes copied.");

  // Normalise line endings because Windows clipboard reads return CRLF independently of what the page wrote.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.replace(/\r\n/g, "\n")).toBe(codes.join("\n"));

  const logged: string[] = [];
  page.on("console", (message) => logged.push(message.text()));
  await copyButton(page).click();
  await expect(status(page)).toHaveText("Codes copied.");
  for (const code of codes) {
    expect(logged.join("\n"), "a recovery code must never be logged").not.toContain(code);
  }
});

test("tells the operator what to do when there is no clipboard to write to", async ({ page }) => {
  test.setTimeout(120_000);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => undefined });
  });
  await landOnTheReveal(page, "noclip683");

  await copyButton(page).click();
  await expect(status(page)).toHaveText(
    "Could not copy automatically. Select the codes above and copy manually.",
  );

  await expect(page.getByRole("list", { name: "Recovery codes" })).toBeVisible();
});

test("tells the operator what to do when the write is refused", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => ({
        writeText: () => Promise.reject(new Error("NotAllowedError")),
      }),
    });
  });
  await landOnTheReveal(page, "refused683");

  await copyButton(page).click();
  await expect(status(page)).toHaveText(
    "Could not copy automatically. Select the codes above and copy manually.",
  );
});

test("keeps the confirm on its named route handler, with the copy control beside it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await landOnTheReveal(page, "flow683");

  const form = page.locator('form[action="/two-factor/recovery-codes/confirm"]');
  await expect(form).toHaveAttribute("method", "post");
  await expect(form.getByRole("button", { name: "I have saved these codes" })).toBeVisible();
  await expect(copyButton(page)).toBeVisible();

  await expect(copyButton(page)).toHaveJSProperty("tagName", "BUTTON");
});
