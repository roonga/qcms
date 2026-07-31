import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { generate } from "otplib";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { TEST_PASSWORD, createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  accountTrigger,
  appearanceTrigger,
  fillStable,
  openMenu,
  readSetupKey,
  signInWithTotp,
  submitSignIn,
  submitTotp,
} from "./support/flow.js";
import { addOption, chooseType, field } from "./support/questions.js";

/**
 * The admin's axe gate (task 031, exit criterion 5; policies inherited from task 030).
 *
 * Zero violations is the gate, and it runs on **every state the shell and the auth loop
 * have**, not just the first page: the signed-out screen, each failure state, the enrollment
 * screen with its QR and setup key, the one-time recovery-code display, the challenge and
 * its recovery variant, and all five shell areas. Two of those are the ones a
 * first-render-only gate would miss, and they are exactly where this app's accessibility
 * risk concentrates: an alert that has to receive focus, and a list of codes that has to be
 * announced as a list. (The gate has already earned its place once: it caught a duplicate
 * `role="alert"` created by wrapping the vendored `Alert` in a second live region.)
 *
 * It runs inside the one root Playwright config, which CI's browser job executes in full
 * (`pnpm exec playwright test`), so the gate is CI-enforced by construction rather than by a
 * separate job someone has to remember to add - the failure mode 029 shipped and 030 had to
 * fix (docs/RETRO.md).
 *
 * `color-contrast` is enabled here, unlike in the jsdom component tests where no canvas
 * exists to measure it: this is a real browser, and the app's Cobalt palette against the
 * shared neutrals is precisely the pair worth checking.
 *
 * ## Every state, in every mode (task 055, exit criterion 5)
 *
 * `color-contrast` is the one axe rule whose answer depends on the mode, and it is
 * exactly the rule an operator relies on, so running the gate only in the mode the test
 * machine happens to prefer would leave two thirds of the palette unchecked. Each state is
 * therefore analysed three times.
 *
 * The mode is applied by setting the root class directly rather than by re-navigating with
 * a cookie, and the saving is the point: the class is the only input the palette has, and a
 * re-navigation per mode would triple the sign-ins and page loads in this file to measure
 * the same pixels. That the class arrives correctly from a cookie, from
 * `prefers-color-scheme`, and from the control itself is proved in `appearance.pw.ts`,
 * which is where that mechanism belongs.
 *
 * Each test signs in for itself: Playwright gives every test a fresh browser context, and
 * sharing one would disable the shared console gate (see `support/flow.ts`).
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("a11y");

/**
 * Wait until every running transition has finished.
 *
 * Load-bearing, and it cost a cycle to find: the vendored controls carry
 * `transition-colors`, so switching the mode class starts a colour animation, and axe
 * sampling immediately measured a MID-TRANSITION pair - a white-fading-to-dark label
 * over a blue-fading-to-light button, at a ratio (3.72, then 2.17 on the next run)
 * that exists for a tenth of a second and is nobody's experience. Two runs disagreeing
 * on the number is the signature.
 *
 * `document.getAnimations()` is the exact question ("is anything still animating?"),
 * so this settles as fast as the page does. A `waitForTimeout` would have hidden the
 * same race behind a number that is too small on a loaded machine, and emulating
 * reduced motion would have measured a configuration rather than removing the race.
 */
async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/** Set by the enrollment test; stable once the factor is confirmed. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** WCAG 2.2 AA, the same rule set the portal gate uses. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The sheet's three mode layers. Light is the bare root, so it has no class. */
const MODES = [
  { name: "light", rootClass: "" },
  { name: "dark", rootClass: "dark" },
  { name: "high-contrast", rootClass: "hc" },
] as const;

async function expectNoViolations(page: Page, state: string): Promise<void> {
  const original = await page.evaluate(() => document.documentElement.className);
  try {
    for (const mode of MODES) {
      await page.evaluate((rootClass) => {
        for (const candidate of ["light", "dark", "hc"]) {
          document.documentElement.classList.remove(candidate);
        }
        if (rootClass !== "") document.documentElement.classList.add(rootClass);
      }, mode.rootClass);
      await settleTransitions(page);

      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      // Name the state, the mode, the rule AND the element in the failure message. An
      // axe failure reported as a bare count costs a second run to diagnose; one
      // reported without the mode costs a third; and a `color-contrast` failure
      // reported without the node and the measured ratio costs a fourth, because the
      // whole point of running per mode is that the offender differs between them.
      expect(
        results.violations.map(
          (v) =>
            `${v.id}: ${v.help} [${v.nodes
              .map((node) => `${node.target.join(" ")} - ${node.failureSummary ?? ""}`)
              .join(" | ")}]`,
        ),
        `axe violations on the ${state} state in ${mode.name}`,
      ).toEqual([]);
    }
  } finally {
    // Leave the page as it was found, so a caller that keeps interacting with it is not
    // silently driving a screen in a mode it never selected.
    await page.evaluate((className) => {
      document.documentElement.className = className;
    }, original);
  }
}

test("the signed-out and failure states have zero violations", async ({ page }) => {
  await page.goto("/sign-in");
  await expectNoViolations(page, "signed-out");

  // The failure state carries a focused alert, which is where an accessible-name, duplicate
  // live region, or focus-order regression would land.
  await page.goto("/sign-in?error=1");
  await expect(page.getByRole("alert")).toBeVisible();
  await expectNoViolations(page, "sign-in error");

  await page.goto("/sign-in?throttled=1");
  await expectNoViolations(page, "sign-in throttled");

  await page.goto("/sign-in?expired=1");
  await expectNoViolations(page, "session expired");
});

test("the enrollment and recovery-code states have zero violations", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  await expectNoViolations(page, "2FA enrollment");

  totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);

  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await expectNoViolations(page, "recovery-codes display");
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
});

test("the authenticated shell states have zero violations", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  for (const path of ["/questions", "/forms", "/responses", "/webhooks", "/settings"]) {
    await page.goto(path);
    await expectNoViolations(page, `shell ${path}`);
  }
});

test("both topbar menus have zero violations while OPEN, in every mode", async ({ page }) => {
  // Task 032. A closed menu is a button; the accessibility risk is entirely in the
  // open state, and a gate that only ever sampled first render would miss all of it:
  // a portalled popover outside the landmark structure, two wordless triggers whose
  // only name is an `aria-label`, and a checked row whose state must not be colour
  // alone. `expectNoViolations` runs each state in light, dark and high contrast, and
  // high contrast is the case that matters most here - it is where a two-colour
  // palette would expose a state carried by colour and nothing else.
  //
  // The mode is chosen through the real control before the sweep, so the CHECKED row
  // is a different row in each pass rather than always the first one.
  await signInWithTotp(page, EMAIL, totpSecret);

  await openMenu(appearanceTrigger(page));
  await expectNoViolations(page, "appearance menu open");

  // Move the check to a different row and sweep again: the checked row's own
  // treatment (glyph, weight, inset edge) is what the "never colour alone"
  // requirement lands on, so it has to be measured where it actually is.
  await page.getByRole("menuitemradio", { name: "High contrast", exact: true }).click();
  await openMenu(appearanceTrigger(page));
  await expectNoViolations(page, "appearance menu open, High contrast checked");
  await page.keyboard.press("Escape");

  await openMenu(accountTrigger(page));
  await expectNoViolations(page, "account menu open");
  await page.keyboard.press("Escape");
});

test("the question library, its editor and a question's detail have zero violations", async ({
  page,
}) => {
  // Task 032, exit criterion 4. These are the app's first screens with real data density -
  // an interactive table, a form with grouped constraint panels, and a modal confirmation -
  // so they are where a label, a group name or a contrast pair is most likely to be missed.
  //
  // `expectNoViolations` runs each state in light, dark and high contrast, so this covers
  // all three modes by construction.
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  await page.goto("/questions");
  await expectNoViolations(page, "question library list");

  await page.goto("/questions/new");
  await expectNoViolations(page, "question editor, empty");

  // A choice type, because that is the shape with the most to get wrong: an option list
  // whose reorder controls have to be distinguishable from one another by name alone.
  await chooseType(page, "Single choice");
  const slug = `a11y-question-${Date.now().toString(36)}`;
  await fillStable(field(page, "Slug"), slug);
  await fillStable(field(page, "Label"), "Which cover applies?");
  await addOption(page, "Comprehensive");
  await addOption(page, "Third party");
  await expectNoViolations(page, "question editor, option list");

  await Promise.all([
    page.waitForURL(/\/questions\/q_/),
    page.getByRole("button", { name: "Create draft" }).click(),
  ]);
  await expectNoViolations(page, "question detail with preview");

  // The confirmation dialog is analysed open: a focus-trapped alertdialog is exactly the
  // state a first-render-only gate would miss.
  await page.getByRole("button", { name: /^Publish version 1$/ }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectNoViolations(page, "publish confirmation");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: /^Publish version 1$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  // A frozen version renders the same form disabled, which is a different contrast
  // question in every mode than the live one above.
  await expectNoViolations(page, "frozen published version");
});

test("the 2FA challenge and its recovery variant have zero violations", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/challenge$/);
  await expectNoViolations(page, "2FA challenge");

  await page.goto("/two-factor/challenge?error=1");
  await expectNoViolations(page, "2FA challenge error");

  await page.getByRole("link", { name: "Use a recovery code instead" }).click();
  await expect(page).toHaveURL(/\/two-factor\/recovery$/);
  await expectNoViolations(page, "2FA recovery entry");
});

test("the whole auth loop is reachable by keyboard alone", async ({ page }) => {
  // Not an axe check: axe cannot tell whether a control is *reachable*, which is the defect
  // class issue #144 shipped (a control rendered, labelled, and unfocusable).
  // Each half re-runs from its own `goto` if the document is replaced mid-typing. Under
  // `next dev` a route compiled on demand can reload the page after Playwright has typed
  // into it, leaving empty required fields; Enter then hits the browser's own constraint
  // validation and nothing navigates, which surfaced as this test parking on the screen it
  // had just filled in (issue #210). Retrying the block is the only robustness added -
  // every focus assertion, the typing, and Enter are exactly as they were, because
  // keyboard-only operation is the property under test and `fill()` would not prove it.
  await expect(async () => {
    await page.goto("/sign-in");
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab"); // email
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.keyboard.type(EMAIL);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.type(TEST_PASSWORD);
    await expect(page.getByLabel("Email")).toHaveValue(EMAIL, { timeout: 1000 });
    await expect(page.getByLabel("Password")).toHaveValue(TEST_PASSWORD, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/two-factor\/challenge$/);
  await expect(async () => {
    const code = await generate({ secret: totpSecret });
    await page.goto("/two-factor/challenge");
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab"); // code field
    await expect(page.getByLabel(/Six-digit code/)).toBeFocused();
    await page.keyboard.type(code);
    await expect(page.getByLabel(/Six-digit code/)).toHaveValue(code, { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Verify" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/questions$/);
});
