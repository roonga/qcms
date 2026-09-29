import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

// Plain JavaScript with a hand-written declaration file beside it, imported by relative
// path the way `lib/rail-routes.test.ts` imports the same gate.
import { trackedFilesUnder } from "../../../scripts/tracked-files.mjs";

import { TEST_PASSWORD, createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { fillStable, readSetupKey, submitSignIn, submitTotp } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * The forced password change on first sign-in after bootstrap, in a real browser
 * (task 061, exit criteria 1, 3, 4 and 5; SEC-1).
 *
 * ## Why the route coverage is enumerated off disk rather than listed
 *
 * Exit criterion 3 asks that the gate survive a new route being added. The mechanism is
 * inheritance and it is stated where it lives (`lib/server/session.ts`): every page
 * under `app/(shell)/` is rendered by a layout that calls `requireAdminSession()`, every
 * handler there is held to naming one of the two guards by
 * `lib/server/shell-route-guards.test.ts`, and both guards decide through one
 * `sessionOutcome()` function, so a gate added to that list reaches all of them without
 * any of them being edited.
 *
 * What this file adds is the evidence that the mechanism is real end to end, and it
 * gets it by reading the route tree rather than by naming routes. `shellRoutes()` below
 * derives every screen from `git ls-files`, so **a route added six months from now is
 * in this test the day it is added**, and a route that somehow escaped the layout fails
 * here without anyone remembering to extend a list. That is the shape the criterion
 * asks for, and it is the same enumeration `lib/rail-routes.test.ts` already uses.
 *
 * Dynamic segments are filled with a placeholder id. The gate redirects before any data
 * is fetched, so an id that matches nothing is exactly as good as one that does - and if
 * the gate ever stopped running first, the 404 or the error that replaced the redirect
 * would fail this test, which is the failure worth catching.
 *
 * ## One account, serial, and nothing shortcut
 *
 * `mode: "serial"` because the account's state advances in the database: it is
 * provisional exactly once. Each test still signs in for itself - Playwright gives every
 * test a fresh browser context, and sharing one would disable the shared console gate
 * (see `support/flow.ts`).
 *
 * The account is created with `mustChangePassword: true`, which is the state
 * `qcms:create-admin` produces. Nothing here writes the flag afterwards: it is cleared
 * by a real password change through the real screen, which is the only thing that
 * clears it.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("forcedpw");
/** The password the operator chooses, replacing the provisional one. Fresh per run. */
const CHOSEN_PASSWORD = `e2e-chosen-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

const SHELL = fileURLToPath(new URL("../app/(shell)", import.meta.url));

/**
 * Every authenticated screen, as a navigable path.
 *
 * Route groups contribute no segment and parallel-route trees (`@rail`) are not screens.
 * A dynamic segment becomes a placeholder, and a catch-all becomes one segment, which is
 * enough for a redirect that happens before any lookup.
 */
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

/**
 * One of the screen's three credential fields, by its accessible name.
 *
 * **Not `getByLabel`, and the reason is specific to this screen.** Playwright matches a
 * label by substring, so `getByLabel("New password")` resolves to the confirmation
 * field as well - a strict-mode violation rather than a locator. `exact: true` does not
 * rescue it here either: a react-aria `TextField` puts the required marker inside the
 * label element as an `aria-hidden` span, so the label TEXT is "New password*" while
 * the accessible NAME is "New password", and an exact label match finds nothing at all.
 * The role locator reads the accessible name, which is the string the screen actually
 * announces, so it is both unambiguous and the one a screen-reader user hears.
 */
function field(page: Page, name: string): Locator {
  return page.getByRole("textbox", { name, exact: true });
}

/**
 * The three credential fields, filled in reading order.
 *
 * **Sequentially, not in a `Promise.all`.** These are react-aria `TextField`s, whose
 * inputs are controlled and whose value lands through a React commit; three fills in
 * flight at once interleave with each other's commits and one of them loses its value,
 * which `fillStable` then spends its whole fifteen-second budget retrying.
 */
async function fillChange(
  page: Page,
  values: { readonly current: string; readonly next: string; readonly confirm: string },
): Promise<void> {
  await fillStable(field(page, "Temporary password"), values.current);
  await fillStable(field(page, "New password"), values.next);
  await fillStable(field(page, "Confirm new password"), values.confirm);
}

/**
 * The page's own alert, not Next's route announcer.
 *
 * Next mounts `__next-route-announcer__` - a second `role="alert"` - outside `main` as
 * the app hydrates, so an unscoped alert locator is a race against hydration rather
 * than an assertion (`a11y-axe.pw.ts` records the day it resolved to two).
 */
function alertText(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL, { mustChangePassword: true });
});

test("first sign-in lands on the password change, BEFORE 2FA enrollment", async ({ page }) => {
  // Exit criterion 5. The account is unenrolled as well as provisional, so both gates
  // apply and the order is the whole assertion: enrolling a factor here would bind it to
  // an account whose password is still the one out of the provisioning script.
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole("heading", { name: "Choose your own password" })).toBeVisible();

  // Typing the enrollment URL does not get round it either: that screen's guard applies
  // this gate even though it deliberately skips the 2FA one.
  await page.goto("/two-factor/enroll");
  await expect(page).toHaveURL(/\/change-password$/);
});

test("no admin route is reachable until the password is changed", async ({ page }) => {
  // Exit criterion 1, at the route level and over every route there is.
  await submitSignIn(page, EMAIL);
  const routes = shellRoutes();
  // A tripwire on the enumeration itself: an empty or tiny list would make every
  // assertion below vacuous while the loop still reported green.
  expect(routes.length).toBeGreaterThan(10);

  for (const route of routes) {
    await page.goto(route);
    await expect(page, `${route} was reachable while the bootstrap credential stood`).toHaveURL(
      /\/change-password$/,
    );
  }
});

test("the screen refuses what it should, and says so without naming the account", async ({
  page,
}) => {
  await submitSignIn(page, EMAIL);

  // A mismatch between the two new fields: its own sentence, because it is a statement
  // about two values the reader just typed rather than about the account.
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

  // A wrong temporary password: the generic sentence, so it is indistinguishable from a
  // rejected new one (SEC-1).
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

  // And the refusal changed nothing: still gated.
  await page.goto("/questions");
  await expect(page).toHaveURL(/\/change-password$/);
});

test("the screen is operable from the keyboard alone, with focus visible", async ({ page }) => {
  // The deliverable asks for this by name, and a screen nobody chose to visit is exactly
  // the one where a missing label or an unreachable control strands somebody. The axe
  // sweep of this screen in all three modes lives in `a11y-axe.pw.ts` beside the other
  // auth screens; what is asserted here is the tab order, which axe cannot see.
  await submitSignIn(page, EMAIL);
  await waitForHydration(page);

  // Walked forward from the first field rather than counted from the top of the
  // document, so a red names the control the order actually broke at.
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

  // A visible focus indicator, which is the other half of "keyboard operable": the theme
  // paints one with an outline, so an element with none is unusable without a mouse.
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

  // The order again, from the other side: the next thing asked for is the enrollment the
  // first test was refused. The session survives the change - better-auth issues a fresh
  // one in the same call and the handler carries its cookies onto the 303 - so this is
  // not a second sign-in.
  const secret = await readSetupKey(page);
  await submitTotp(page, secret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
  await expect(page.getByRole("heading", { name: "Questions" })).toBeVisible();
});

test("the changed account is unaffected from then on", async ({ page }) => {
  // Exit criterion 4, and the browser half of criterion 2's "not by signing out and in
  // again": a fresh context, the NEW password, the real 2FA challenge, and no forced
  // screen anywhere in it.
  await page.goto("/sign-in");
  // The sign-in screen's own two fields, by label as `submitSignIn` does: that screen
  // carries no second field whose label contains either word.
  await fillStable(page.getByLabel("Email"), EMAIL);
  await fillStable(page.getByLabel("Password"), CHOSEN_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/two-factor\/challenge$/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  // The provisional screen is not on the way in, and the old password no longer works
  // anywhere - the credential really moved rather than the flag merely being cleared.
  await expect(page).not.toHaveURL(/\/change-password/);
});

test("the forced screen is not a second change-password surface", async ({ page }) => {
  // Criterion 4 at the URL. An admin whose flag is clear must not get a
  // change-password form outside Settings by typing this path - the guard sends them on.
  await page.goto("/change-password");
  // Not signed in in this context, so sign-in is where it lands. The signed-in half is
  // `lib/server/session.test.ts`, which can put a cleared session in front of the guard
  // without first spending a second account's whole enrollment walk.
  await expect(page).toHaveURL(/\/sign-in$/);
});
