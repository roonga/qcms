import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";

/**
 * The recovery-code screen's copy control, in a real browser (issue 683).
 *
 * `lib/recovery-copy.test.ts` states what a press decides and `components/recovery-codes.test.tsx`
 * states what the panel renders. Neither can show the two wired together, and neither can show
 * the thing this feature is actually for: that the bytes on the clipboard are the ten codes on
 * screen. That is what the first test reads back.
 *
 * ## Why the failure paths are here rather than only in the unit test
 *
 * A clipboard write that silently fails is worse than no button, because the operator believes
 * they have their recovery codes and does not - and these are shown once, with nothing that
 * reads them back (#319). The unit test proves the decision resolves to "failed"; only a browser
 * can prove that the decision reaches a live region the operator will actually be told by. Both
 * causes are exercised, because they take different code paths: an **absent**
 * `navigator.clipboard` never calls `writeText` at all, and a **refused** write rejects from
 * inside it. They deliberately produce the same sentence, since the remedy is the same one.
 *
 * `addInitScript` runs before the page's own scripts on every navigation, so the substitute
 * clipboard is in place before React hydrates rather than being raced by it.
 *
 * ## A fresh account per test, deliberately
 *
 * The screen is reachable exactly once per issued set: the confirm clears the cookie that owes
 * them. Enrolling a new admin in each test is what lets each one land on a real reveal in its
 * own context, rather than sharing a page and depending on the order they ran in.
 */

/** Enroll a brand-new admin and stop on the one-time reveal. */
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

  // The region exists and is empty before the press: a live region that arrives with its text
  // already in it is not announced (#307), and "empty until there is something to say" is what
  // stops the screen claiming a copy nobody made.
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

  // The property the button exists for. Not "something was copied": the exact set, in order,
  // one per line, so a paste into a password manager is the same ten codes the operator saw.
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(codes.join("\n"));

  // SEC-13: the codes are on the clipboard, and nowhere a log can reach. The shared browser
  // console gate in `support/gates.ts` already reds the run on a console error; this asserts
  // the narrower thing that no output of any level carries a code.
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
  // An insecure context or an older engine: the property is simply not there. This is the case
  // the app's other copy control short-circuits past on purpose, and the one that must not be
  // silent here.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => undefined });
  });
  await landOnTheReveal(page, "noclip683");

  await copyButton(page).click();
  await expect(status(page)).toHaveText(
    "Could not copy automatically. Select the codes above and copy manually.",
  );
  // The remedy the sentence names has to still be there: the codes stay on screen, selectable.
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

  // `docs/admin-constraints.md` keeps the auth flow on named route handlers so the endpoint set
  // is not republished (ADR-35 / SEC-1). A copy button is a client island; the confirm is not,
  // and this is the assertion that says so rather than a comment claiming it.
  const form = page.locator('form[action="/two-factor/recovery-codes/confirm"]');
  await expect(form).toHaveAttribute("method", "post");
  await expect(form.getByRole("button", { name: "I have saved these codes" })).toBeVisible();
  await expect(copyButton(page)).toBeVisible();

  // The copy control is a button and not a link: it acts on this page rather than navigating
  // ("an anchor navigates, a button acts").
  await expect(copyButton(page)).toHaveJSProperty("tagName", "BUTTON");
});
