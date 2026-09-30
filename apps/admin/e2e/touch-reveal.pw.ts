import { devices, type Locator } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { ADMIN_BASE_URL } from "./support/harness-config.js";
import { createDraft, grip, openPanel } from "./support/questions.js";

/**
 * The option grid's two hover-revealed controls, on a device that cannot hover (issue
 * #1011).
 *
 * ## What was wrong
 *
 * `.qcms-opt-insert` and `.qcms-opt-row .qcms-rowgrip` are `opacity: 0` at rest and
 * revealed by hover or focus. `app/globals.css` has one `@media (any-hover: none)` block,
 * written for exactly this - "a pointer-less reader never hovers, so the trigger has to be
 * visible to be found at all" - and it covered only `.qcms-rail-steps__menu`. Measured in a
 * context where the query matches, the rail's menu reported opacity 1 and both of these
 * reported 0.
 *
 * ## Why the grip is the load-bearing one
 *
 * The insert hotzone is 14px tall, below SC 2.5.8's 24px minimum, and it conforms through
 * the Equivalent exception rather than through spacing: the row menu carries "Insert option
 * above {row}" and "Insert option below {row}" under the same names on 40px items, and the
 * grip is that menu's trigger. So an invisible grip does not merely hide a control, it
 * removes the premise the 14px target's conformance rests on. Both are asserted here for
 * that reason, and the `.qcms-opt-insert` comment in `app/globals.css` says the same thing
 * where someone editing the height would read it.
 *
 * ## Why an axe sweep cannot cover this
 *
 * `opacity: 0` puts both controls outside what axe treats as visible, so `target-size`
 * reported no violation and nothing incomplete on the screen with the grid open. The same
 * blindness is why the reveal rules have always been asserted here on computed opacity
 * rather than on Playwright visibility (`questions-lifecycle.pw.ts` does it for the keyboard
 * half), and this file is the touch half of that pair.
 *
 * ## Why a hand-made context
 *
 * The admin project is desktop-only on purpose (`playwright.config.ts`: the admin is an
 * internal authoring tool used at a desk), so `(any-hover: none)` matches nowhere in this
 * suite. A phone context is made for this one assertion and the session is carried into it
 * on cookies, which is the shape `requires-js.pw.ts` already uses: the sign-in walk needs
 * the project's `use` - `baseURL`, and the hydration marker `fillStable` waits for - and a
 * context created from the `browser` fixture inherits none of it.
 */

const EMAIL = uniqueAdminEmail("touchreveal1011");

/** Built once by `beforeAll`. */
let totpSecret = "";

/** The computed opacity of one element, which is what "revealed" means for these two. */
function opacityOf(target: Locator): Promise<string> {
  return target.evaluate((element) => getComputedStyle(element).opacity);
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await createTestAdmin(EMAIL);
  const page = await browser.newPage();
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.close();
});

test("1011 the option grid's insert point and grip are visible where nothing can hover", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await createDraft(page, `e2e-touch-${Date.now().toString(36)}`, "Single choice");
  const detail = new URL(page.url()).pathname;
  expect(detail, "the created question owns the URL").toMatch(/^\/questions\/q_/u);

  // Pixel 7 rather than a bare `hasTouch`, because the criterion is the device: `any-hover:
  // none` answers for the whole pointer set, and only a context that also declares
  // `isMobile` and a touch-only pointer makes the query match the way a phone does.
  const touch = await browser.newContext({
    ...devices["Pixel 7"],
    // Passed explicitly: a context created from the `browser` fixture carries no project
    // option, so a relative `goto` would have nothing to resolve against.
    baseURL: ADMIN_BASE_URL,
  });
  try {
    await touch.addCookies((await page.context().storageState()).cookies);
    const phone = await touch.newPage();

    // FIRST, because every assertion below would also hold on a screen that never loaded.
    // A media query that does not match here would make the whole test vacuous, and the
    // reveal rules would look correct while shipping the defect.
    await phone.goto(detail);
    expect(
      await phone.evaluate(() => window.matchMedia("(any-hover: none)").matches),
      "this context is the one the rule is written for",
    ).toBe(true);

    await openPanel(phone, "options");
    const insert = phone.locator('[data-option-index="0"] .qcms-opt-insert').first();
    await expect(insert, "the grid rendered its first row").toHaveCount(1);

    expect(await opacityOf(insert), "the insert point is visible with no hover available").toBe(
      "1",
    );
    expect(await opacityOf(grip(phone, 0)), "and so is the row grip that opens its menu").toBe("1");

    // The two are asserted separately rather than through a loop: the grip and the insert
    // are hidden by two different rules at two different specificities, and a fix that
    // reached only one of them has to name which.
  } finally {
    await touch.close();
  }
});
