/**
 * The admin's hydration marker and the wait built on it, tested as harness plumbing in its
 * own right (issue #210, following the shape the portal's `hydration-wait.pw.ts` set for
 * issues #121 and #159).
 *
 * Three claims have to hold, and none of them is visible from a passing auth spec:
 *
 * 1. **The marker cannot lie.** It is stamped from a mount effect, so it is absent from a
 *    server render by construction - and the first test asserts that against the real SSR
 *    BYTES rather than against the theory, because "an effect cannot run on the server"
 *    stops being the whole story the moment somebody renders the attribute onto an element
 *    by hand. Every wait in the admin suite would quietly become a no-op that day.
 *
 * 2. **It cannot pass vacuously.** The admin serves complete, interactive HTML before
 *    React runs, so a wait that polled for something already true of that markup would pass
 *    on every run and protect nothing. The same test pins the negative half against the
 *    real sign-in screen served with its script requests starved: markup present, React
 *    never runs, wait rejects. Both halves are needed, since the rejection alone would also
 *    be produced by a typo in the attribute's name.
 *
 * 3. **A keystroke into the auth loop is not silently discarded.** The last test drives the
 *    real keyboard path with every script response held back, so the form is on screen and
 *    focusable while React is still in flight, and requires the challenge to complete
 *    anyway. Remove the waits and it reds every run. CPU throttling, which is how the
 *    portal reproduces its version of this race, does NOT work here and was measured not
 *    to: it slows Playwright's keystrokes into the same renderer, so the gap never opens
 *    (four unwaited runs at rate 6 all passed). `holdScripts` moves only the half that
 *    has to move.
 *
 * 4. **It must not fire where React is never coming.** The auth loop is a native form and
 *    works with scripts off entirely, which three specs prove in
 *    `test.use({ javaScriptEnabled: false })` blocks. The marker cannot appear there, so a
 *    wait for it is minutes of timeout on a page that was never at risk. The last test pins
 *    that the wait returns immediately instead. This is not hypothetical: the first version
 *    of this change reddened all three of those blocks, and only the full browser suite
 *    caught it.
 *
 * The mechanism, for whoever debugs this next, because nothing about the failure names it:
 * react-aria's `TextField` receives neither `value` nor `defaultValue`, so it renders a
 * CONTROLLED input seeded empty. The commit that attaches React writes that empty value
 * over anything typed into the server-rendered input beforehand. The six-digit code field
 * is `required`, so the Enter that follows is refused by the browser's own constraint
 * validation: no submit event, no request, no error alert, and no navigation. The red
 * arrives much later, as a URL assertion timing out on the screen the test believed it had
 * left, with the field mysteriously empty. Measured before the fix: 12 wipes in 20
 * attempts, hydration landing 76-404ms after the document commit on an idle machine.
 */

import { generate } from "otplib";

import { expect, test } from "../../portal/e2e/support/gates.js";
import { starveScripts } from "../../portal/e2e/support/script-starve.js";

import { HYDRATED_ATTRIBUTE } from "../lib/hydration.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, submitSignIn } from "./support/flow.js";
import { holdScripts, waitForHydration } from "./support/hydration.js";

test.describe.configure({ mode: "serial" });

/** This file's own account, so it never contends with another spec's 2FA state. */
const EMAIL = uniqueAdminEmail("hydration");
let totpSecret = "";

/** A six-digit string that is never a valid code: half one is about the field, not auth. */
const TYPED_PROBE_CODE = "123456";

/** How long the wait is given on a page that must never satisfy it. */
const REJECTION_BUDGET_MS = 3_000;

/**
 * How long the wait is given on a page that MUST satisfy it. Deliberately far below the
 * suite default: a positive half leaning on the default timeout would still pass if the
 * marker only ever arrived at the last possible moment, which is not the claim being made.
 */
const RESOLUTION_BUDGET_MS = 15_000;

/**
 * How long the wait is given once a held bundle is released. Above the `expect` default of
 * five seconds because the release, the download and the commit all still have to happen,
 * and this test is about whether the value survives, never about how fast it does not.
 */
const HYDRATION_BUDGET_MS = 30_000;

/**
 * The ceiling the scripting-off wait must come in under. Small on purpose: it is the whole
 * assertion, and anything generous would be satisfied by the very timeout being guarded
 * against.
 */
const NO_SCRIPT_BUDGET_MS = 2_000;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("the marker is absent from the served HTML and the wait rejects a page React never ran on", async ({
  page,
}) => {
  // Starve the app bundle: every script request is answered with an empty 200, so the page
  // gets its real server-rendered markup and React never runs. Page JavaScript stays
  // enabled throughout, which is what lets `waitForFunction` still poll.
  const starvation = await starveScripts(page);
  await page.goto("/sign-in");

  // The page asked for its bundle and got nothing, so it cannot hydrate. This is the
  // browser's own request accounting rather than an inspection of markup, so the test
  // cannot pass vacuously by accidentally serving a page that CAN hydrate.
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved",
  ).toBeGreaterThan(0);

  // Not in the served bytes. Fetched over the request context rather than read out of the
  // live DOM on purpose: this is a claim about what the SERVER sends, and the DOM has
  // already been through a browser by the time a locator can see it.
  const served = await page.request.get(page.url());
  expect(served.ok(), "the sign-in screen must be served successfully to be inspected").toBe(true);
  expect(
    await served.text(),
    "the hydration marker must never appear in server-rendered HTML",
  ).not.toContain(HYDRATED_ATTRIBUTE);

  // The markup is nonetheless genuinely interactive, which is the product property the
  // admin's auth loop depends on and the reason the wait is needed at all: both fields and
  // the submit button are present and operable with no client JavaScript.
  await expect(page.getByLabel("Email")).toBeAttached();
  await expect(page.getByLabel("Password")).toBeAttached();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeAttached();

  // Yet the wait does not pass on it.
  let failure = "";
  try {
    await waitForHydration(page, { timeout: REJECTION_BUDGET_MS });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure, "the wait must fail on markup React never attached to").toMatch(/timeout/i);

  // Positive half: the same screen, served with its scripts, resolves the wait. So the
  // rejection above was the absence of hydration, not a broken attribute name.
  starvation.restore();
  await page.goto("/sign-in");
  await waitForHydration(page, { timeout: RESOLUTION_BUDGET_MS });
});

test("enrol this file's account", async ({ page }) => {
  totpSecret = await enrollNewAdmin(page, EMAIL);
});

test("hydration discards what was typed first, which is what the wait exists to prevent", async ({
  page,
}) => {
  // Half one pins the hazard, scheduled rather than hoped for. `holdScripts` keeps React
  // out of the page until this test lets it in, so the interleaving that loses - type,
  // THEN hydrate, THEN submit - happens on demand instead of once in every few runs.
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/challenge$/);

  const held = holdScripts(page);
  try {
    await page.goto("/two-factor/challenge", { waitUntil: "commit" });
    const field = page.getByLabel(/Six-digit code/);
    await expect(field).toBeAttached();

    // Typed into the server render, at full speed, the way an operator with the code
    // already in front of them types it.
    await field.focus();
    await page.keyboard.type(TYPED_PROBE_CODE);
    await expect(field, "the server-rendered field must accept typing").toHaveValue(
      TYPED_PROBE_CODE,
    );

    // Let React in, and it takes the value away. This assertion is deliberately an
    // assertion about a DEFECT rather than about a feature: react-aria's `TextField` is
    // handed neither `value` nor `defaultValue`, so it renders a controlled input seeded
    // empty and the attaching commit writes that empty state over the DOM. It lives in the
    // vendored tree, which ADR-22 freezes byte-for-byte against upstream, so it is an
    // upstream fix and a pin move rather than something to patch here. The day that lands,
    // THIS is the line that will fail, and failing is the correct way to find out: the
    // waits below exist only for as long as this stays true.
    held.release();
    await waitForHydration(page, { timeout: HYDRATION_BUDGET_MS });
    await expect(field, "hydration overwrites a pre-hydration value (issue #210)").toHaveValue("");
  } finally {
    held.release();
  }

  // Half two: the same screen, driven the way the helpers drive it - wait first, then
  // type - and the real code lands and completes the challenge. Remove the wait and the
  // sequence above is what happens instead: an empty `required` field, a submit the
  // browser's own constraint validation refuses with no submit event and no request, and a
  // spec parked on the challenge until its URL assertion times out. `fillStable` cannot
  // cover this path, because keyboard-only operation is what the a11y spec is proving and
  // `fill()` would not prove it.
  await page.goto("/two-factor/challenge");
  await waitForHydration(page);
  await page.keyboard.press("Tab"); // skip link
  await page.keyboard.press("Tab"); // code field
  await expect(page.getByLabel(/Six-digit code/)).toBeFocused();
  await page.keyboard.type(await generate({ secret: totpSecret }));
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Verify" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/questions$/);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the wait returns at once on a page whose scripts will never run", async ({ page }) => {
    // React is never coming, so there is nothing to wait for AND nothing at risk: no commit
    // will overwrite what was typed. A wait that blocked here would turn every no-JS spec
    // into a timeout, which is exactly what it did before this was pinned.
    //
    // The budget is the assertion. Passing no timeout would let this "pass" after the suite
    // default, which is the failure being guarded against; a budget far below any plausible
    // wait means only an immediate return satisfies it.
    await page.goto("/sign-in");
    const started = Date.now();
    await waitForHydration(page, { timeout: NO_SCRIPT_BUDGET_MS });
    expect(
      Date.now() - started,
      "with scripting off the wait must return immediately, not time out",
    ).toBeLessThan(NO_SCRIPT_BUDGET_MS);

    // And the page really is the no-JS one: the server-rendered form is here and usable,
    // which is what makes skipping the wait correct rather than merely convenient.
    await expect(page.getByLabel("Email")).toBeAttached();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeAttached();
  });
});
