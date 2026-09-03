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
 *    real keyboard path with the CPU throttled, which widens the gap between first paint
 *    and React attaching from sub-frame to seconds, and requires the challenge to complete
 *    anyway. Remove the wait from the flow helpers and it reds every run.
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
import { waitForHydration } from "./support/hydration.js";

test.describe.configure({ mode: "serial" });

/** This file's own account, so it never contends with another spec's 2FA state. */
const EMAIL = uniqueAdminEmail("hydration");
let totpSecret = "";

/**
 * Hydration is scheduled work, so it lands after the load event: throttling the CPU
 * stretches that window from sub-frame to seconds without touching the network or the
 * helpers under test. Emulated, not real slowness, which is the point - it turns an
 * intermittent race into a deterministic one.
 */
const CPU_THROTTLE_RATE = 6;

/** How long the wait is given on a page that must never satisfy it. */
const REJECTION_BUDGET_MS = 3_000;

/**
 * How long the wait is given on a page that MUST satisfy it. Deliberately far below the
 * suite default: a positive half leaning on the default timeout would still pass if the
 * marker only ever arrived at the last possible moment, which is not the claim being made.
 */
const RESOLUTION_BUDGET_MS = 15_000;

/**
 * How long a navigation is given while the CPU is throttled. Above the `expect` default of
 * five seconds because everything in that block is six times slower on purpose, and this
 * test is about whether the keystrokes land, never about how fast they do.
 */
const THROTTLED_BUDGET_MS = 30_000;

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

test("the keyboard challenge completes even when hydration is slow", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE });
  try {
    // `submitSignIn` fills through `fillStable`, which owns the wait. Without it the
    // password is wiped by the attaching commit and this lands back on `/sign-in`.
    await submitSignIn(page, EMAIL);
    await expect(page).toHaveURL(/\/two-factor\/challenge$/, { timeout: THROTTLED_BUDGET_MS });

    // The challenge, driven by keyboard alone, which is the exact path issue #210 parked
    // on: type into a screen React has not attached to yet and the code is gone by the
    // time Enter reaches the form.
    await waitForHydration(page);
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab"); // code field
    await expect(page.getByLabel(/Six-digit code/)).toBeFocused();
    await page.keyboard.type(await generate({ secret: totpSecret }));
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Verify" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/questions$/, { timeout: THROTTLED_BUDGET_MS });
  } finally {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
});
