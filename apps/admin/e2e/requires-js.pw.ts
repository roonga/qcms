import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin } from "./support/flow.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";

/**
 * The admin requires JavaScript and stops at a message without it (Code Owner,
 * 2026-09-27; `plan/admin-design-contracts.md`, "Standing correction").
 *
 * The gate is a `<noscript><style>` block in `app/layout.tsx`, so this is the only layer
 * that can fail on it at all: nothing below a browser has a scripting flag, and nothing
 * below a browser applies a `<noscript>` rule. `app/requires-js.test.tsx` carries the half
 * that a browser cannot fail on - that the gate is in the ROOT layout, which is what makes
 * the two routes below representative of every route in the app.
 *
 * ## Two routes, and why those two
 *
 * `/sign-in` and `/questions` are the two sides of the app's one boundary. Signed out, the
 * gate has to hide a native `<form method="post">` that genuinely worked without scripting
 * until today, and that is the surface an operator would otherwise be invited to use and
 * then stranded on. Signed in, it has to hide a whole shell - topbar, nav landmark, rail,
 * table - none of which is served by the sign-in route. A gate that covered one and not the
 * other would be a plausible way to get this wrong, and neither route alone would notice.
 *
 * ## Getting an authenticated page into a scriptless context
 *
 * A session cannot be established with scripting off any more, which is the requirement
 * rather than an obstacle: the sign-in form is hidden, so there is no form to post. So the
 * session is made through the real screens with scripting ON and its cookies are moved onto
 * a scriptless context, the shape `apps/portal/e2e/no-js-retraction.pw.ts` already uses for
 * the mirror-image case.
 *
 * **Which half gets the fixture is not arbitrary, and getting it backwards cost a red.** The
 * sign-in walk goes on the injected `page`, because it needs the project's `use` - `baseURL`,
 * and the hydration marker `fillStable` waits for before typing into a react-aria field - and
 * a context created from the `browser` fixture inherits none of it. The scriptless half is
 * the hand-made one, because all it does is navigate and assert, and it passes its own
 * `baseURL` for the same reason. What it gives up is the console gate, which watches the
 * injected page only; with scripting off there is no console to watch. The server-log gate
 * is per test and still covers every request this one makes.
 *
 * `/questions` is asserted to still BE `/questions` after the navigation, before anything
 * else. Without that, a session that failed to transfer would land on `/sign-in`, the
 * message would be there, and the test would pass while proving only what the first test
 * already proves.
 *
 * ## What is asserted about the hidden half, and why it is three assertions
 *
 * "Not visible or focusable" is three separable claims and `toBeHidden()` is only the
 * first of them. So each one is made with the locator engine that can actually fail on it:
 * a CSS locator for presence-but-not-painted (a role locator would match nothing and pass
 * vacuously), a role locator for absence from the accessibility tree (`display: none`
 * removes a subtree from it, which is what stops a screen reader announcing a form nobody
 * can reach), and a `Tab` press for the tab order, because an element can be outside the
 * accessibility tree and still take focus.
 *
 * ## The no-flash claim is NOT made here
 *
 * With scripting on the message is absent, which is asserted below. That it is also absent
 * on the first painted FRAME is a structural property rather than an observable one at this
 * layer: the hiding rule lives in `globals.css`, a stylesheet in `<head>`, so it applies
 * before the body is laid out and there is no moment at which the message is painted. What
 * would break that is an inline style or a client-side hide, and both are asserted against
 * in `app/requires-js.test.tsx` where they are visible as markup. Timing the first frames
 * here would measure the dev server's compile, not the rule.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("requiresjs");

/** The heading and the body, from the catalog's own words (ADR-27). */
const TITLE = "JavaScript is required";
const BODY = "Turn on JavaScript in your browser settings, then reload this page.";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** The message, as the only thing an operator can see or reach. */
async function expectOnlyTheMessage(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { level: 1, name: TITLE });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(BODY);

  // The skip link is the app's first focusable element on every route, so it is the
  // cheapest proof that the hiding rule reached the layout's own chrome and not only the
  // route's content.
  await expect(page.locator("a.skip-link")).toBeHidden();
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the sign-in page shows the message and no form", async ({ page }) => {
    await page.goto("/sign-in");
    await expectOnlyTheMessage(page);

    // NOT PAINTED. A CSS locator rather than a role or label locator, because those match
    // nothing here and `toBeHidden()` is satisfied by an empty result - the assertion has
    // to be able to see the element in order to say it is hidden. `toBeAttached()` first,
    // for the same reason one level down: a selector that has gone stale would otherwise
    // report the form hidden by finding nothing at all.
    for (const selector of [
      'form[action="/sign-in/submit"]',
      'input[name="email"]',
      'input[name="password"]',
    ]) {
      const element = page.locator(selector);
      await expect(element, `${selector} is still served`).toBeAttached();
      await expect(element, `${selector} is not painted`).toBeHidden();
    }

    // NOT ANNOUNCED. `display: none` takes the subtree out of the accessibility tree, so
    // the role engine finds nothing: a screen reader is not offered a form that cannot be
    // submitted, and the sign-in heading is gone with it.
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Sign in to QCMS" })).toHaveCount(0);

    // NOT FOCUSABLE. The document's own tab order, which is the thing a keyboard operator
    // has: the first press from the body must find nothing, because every candidate on the
    // page is inside the hidden half and the message itself holds no control.
    await page.keyboard.press("Tab");
    expect(
      await page.locator(":focus").count(),
      "nothing on the page takes focus, so Tab leaves the body",
    ).toBe(0);
  });

  /*
   * THE PAIRING THE SIGN-OUT DECISION RESTS ON (Code Owner, 2026-09-27).
   *
   * The scriptless sign-out affordance is deleted, so a scriptless operator holding a
   * session with no way to end it would be a real defect. The reason it cannot arise is that
   * they cannot get a session in the first place, and that is a claim about FIVE screens
   * rather than one: sign-in is only the first step of an enforced-2FA loop, and the
   * challenge, enrollment, recovery-code entry and the recovery-code display each carry
   * their own native form posting its own credential to its own named route (ADR-35 / SEC-1
   * keep them that way, and that decision is untouched - it is about a credential never
   * passing through client JavaScript, not about no-JS support).
   *
   * Each is visited DIRECTLY rather than walked to, which is the only way to reach them at
   * all here and is also the stronger check: a screen that is unreachable only because the
   * step before it is unreachable would pass a walk while still being submittable to anyone
   * who typed its address. Every one of them serves the message instead.
   *
   * The routes are visited unauthenticated, so each would ordinarily redirect to `/sign-in`
   * and a test that asserted only the message would pass on the redirect. So the form is
   * asserted where it is served and the redirect is accepted where it happens: either way
   * there is no form on screen, which is the claim.
   */
  test("no auth screen can be reached or submitted with scripting off", async ({ page }) => {
    for (const route of [
      "/sign-in",
      "/two-factor/challenge",
      "/two-factor/enroll",
      "/two-factor/recovery",
      "/two-factor/recovery-codes",
    ]) {
      await page.goto(route);
      await expectOnlyTheMessage(page);

      // Nothing submittable is announced or painted on any of them: no form, no field, no
      // control. Counted rather than asserted with `toBeHidden()`, because a route may serve
      // several forms or none and `toBeHidden()` is strict about how many it resolved -
      // `:visible` plus a count of zero says the same thing for any number of them.
      await expect(page.locator("form:visible"), `${route} paints no form`).toHaveCount(0);
      await expect(page.locator("input:visible"), `${route} paints no field`).toHaveCount(0);
      await expect(page.getByRole("textbox"), `${route} announces no field`).toHaveCount(0);
      await expect(page.getByRole("button"), `${route} announces no control`).toHaveCount(0);

      // And nothing takes focus, so there is no keyboard route into a hidden field either.
      await page.keyboard.press("Tab");
      expect(await page.locator(":focus").count(), `${route} puts nothing in the tab order`).toBe(
        0,
      );
    }
  });
});

test("an authenticated shell route shows the message and no shell", async ({ page, browser }) => {
  test.setTimeout(240_000);

  // The SESSION is made on the injected `page`, so `test.use` is not what switches scripting
  // off here and this test sits outside the block above. The sign-in walk needs the project's
  // `use` - `baseURL` above all, plus the hydration marker `fillStable` waits for - and a
  // hand-made context inherits none of it. Doing it the other way round cost a red: the
  // scriptless half needs no fixture at all, because all it does is navigate and assert.
  await enrollNewAdmin(page, EMAIL);

  const scriptless = await browser.newContext({
    javaScriptEnabled: false,
    // Passed explicitly, for the reason above: a context created from the `browser` fixture
    // carries no project option, so a relative `goto` would have nothing to resolve against.
    baseURL: ADMIN_BASE_URL,
  });
  try {
    await scriptless.addCookies((await page.context().storageState()).cookies);
    const scriptlessPage = await scriptless.newPage();

    await scriptlessPage.goto("/questions");
    // FIRST, because everything after it would also hold on `/sign-in`.
    await expect(
      scriptlessPage,
      "the transferred session is real, not a bounce to sign-in",
    ).toHaveURL(/\/questions$/);
    await expectOnlyTheMessage(scriptlessPage);

    // The shell, by the four things it puts on screen that the sign-in route does not.
    await expect(scriptlessPage.locator("header")).toBeHidden();
    await expect(scriptlessPage.locator("main#main-content")).toBeHidden();
    await expect(scriptlessPage.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
    await expect(scriptlessPage.getByRole("table", { name: "Question library" })).toHaveCount(0);

    // And there is NO way to sign out, which is the one consequence of this gate that
    // retired a shipped affordance rather than chrome: a `<noscript>` rule used to reveal a
    // plain POST button here so a scriptless operator could end a session (Code Owner,
    // 2026-07-31), and that decision is superseded (Code Owner, 2026-09-27). Asserted in
    // both directions - nothing announced, nothing painted - because the POST form itself is
    // still served for `requestSubmit()` to use, and a check for the form alone would not
    // notice a button coming back inside it.
    const signOutForm = scriptlessPage.locator('form[action="/sign-out"]');
    await expect(
      signOutForm,
      "the POST form the scripted menu submits is still served",
    ).toBeAttached();
    await expect(signOutForm).toBeHidden();
    await expect(signOutForm.locator("button")).toHaveCount(0);
    await expect(scriptlessPage.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  } finally {
    await scriptless.close();
  }
});

test("with JavaScript the message is absent and the sign-in form is the page", async ({ page }) => {
  await page.goto("/sign-in");

  // Absent from the accessibility tree and not painted. Both directions, because the
  // message is RENDERED on every page - that is what makes the scriptless path
  // flash-free - so "absent" here means hidden rather than missing, and a test that only
  // looked for the string would pass on a page that shows it.
  await expect(page.getByRole("heading", { name: TITLE })).toHaveCount(0);
  await expect(page.getByText(TITLE)).toBeHidden();
  await expect(page.locator(".qcms-requires-js")).toBeHidden();

  // And the screen is unchanged: the gate adds a sibling, it does not wrap the app.
  await expect(page.getByRole("heading", { name: "Sign in to QCMS" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
