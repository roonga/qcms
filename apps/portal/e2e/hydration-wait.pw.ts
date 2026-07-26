/**
 * The hydration wait every entry helper owns, tested as harness plumbing in its
 * own right (issue #121).
 *
 * Two things have to hold for `waitForHydration` to be worth having, and neither
 * is visible from a passing flow spec:
 *
 * 1. **It cannot pass vacuously.** The portal server-renders a real, fillable
 *    fallback form (029), so a spec can interact with the step long before React
 *    attaches. A wait that polled for something already true of that markup, or
 *    that timed out into a truthy default, would pass every run and protect
 *    nothing. The first test pins the negative half against the real step served
 *    with its script requests starved (markup present, React never runs, so the
 *    page cannot hydrate), then the positive half on the same step served normally.
 *    Both halves are needed: the rejection alone would also be produced by a typo
 *    in the probe selector. Starving the bundle over the network is deliberate: an
 *    earlier version built the fixture by editing the SSR HTML string, which is
 *    both fragile (a close tag it failed to match would silently restore
 *    hydration) and a thing static analysis rightly flags as unsafe HTML handling.
 * 2. **An entry helper's first interaction is not silently discarded.** The second
 *    test drives the real entry helper with the CPU throttled, which widens the gap
 *    between first paint and React attaching, and asserts the answer still posts.
 *    Reverting the wait in `startAnonymousFlow` reds it: that is how the race was
 *    demonstrated before it was fixed, rather than assumed from symmetry with
 *    `startKitchenSink`. Observed mechanism, for whoever debugs this next: the
 *    pre-hydration click checks the fallback form's native radio, React then
 *    replaces that markup with its own render, the checked state goes with it, and
 *    NO answer is ever posted. Nothing fails at the click. The red arrives later,
 *    as a timeout inside whichever helper awaited the first `POST /answers`.
 */

import { expect, test } from "./support/gates.js";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, COUNT_LABEL, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";

/**
 * Hydration is scheduled work, so it lands after the load event: throttling the
 * CPU stretches that window from sub-frame to seconds without touching the network
 * or the helper under test. Emulated, not real slowness, which is the point: it
 * makes an intermittent race deterministic. At this rate the un-waited helper
 * handed back an inert page every run.
 */
const CPU_THROTTLE_RATE = 6;

test("the hydration wait rejects on server-rendered markup and resolves once React attaches", async ({
  page,
}) => {
  const { slug } = readFixtures();

  // Starve the app bundle: every script request is answered with an empty 200, so
  // the page gets its real server-rendered markup and React never runs. Empty
  // rather than `abort()` on purpose - an aborted request surfaces as a
  // `net::ERR_FAILED` console error and the browser error gate would red the test
  // for the wrong reason. `no-store` keeps the empty body out of the HTTP cache, so
  // lifting the starvation below really does refetch the bundle. Page JavaScript
  // stays enabled throughout, which is what lets `waitForFunction` still poll.
  let starveScripts = true;
  let scriptsStarved = 0;
  await page.route("**/*", async (route) => {
    if (starveScripts && route.request().resourceType() === "script") {
      scriptsStarved += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "cache-control": "no-store" },
        body: "",
      });
      return;
    }
    await route.continue();
  });

  // Entry and Start both work with no client JavaScript at all (that is what the
  // no-JS specs cover), so this lands on the step's server-rendered fallback form.
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  const stepUrl = page.url();

  // The page asked for its bundle and got nothing, so it cannot hydrate. This is
  // what replaces a "no <script> in the HTML" check: it is the browser's own
  // request accounting rather than an inspection of markup, so the test cannot pass
  // vacuously by accidentally serving a page that CAN hydrate.
  expect(scriptsStarved, "the bundle must have been requested and starved").toBeGreaterThan(0);

  // The markup is nonetheless genuinely interactive: the question, its radios and a
  // submit button are all present and operable without JavaScript. An interaction
  // here is silently thrown away, which is the whole reason the wait exists.
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeAttached();
  await expect(page.locator("button[type='submit']")).toBeVisible();

  // Yet the wait does not pass on it.
  let failure = "";
  try {
    await waitForHydration(page, { timeout: 3_000 });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure, "the wait must fail on markup React never attached to").toMatch(/timeout/i);

  // Positive half: the same step, served with its scripts, resolves the wait. So
  // the rejection above was the absence of hydration, not a broken probe.
  starveScripts = false;
  await page.goto(stepUrl);
  await waitForHydration(page);
});

test("startAnonymousFlow's first interaction still posts when hydration is slow", async ({
  page,
}) => {
  const { slug } = readFixtures();

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE_RATE });
  try {
    // The entry helper must not hand back a page whose controls are inert: this
    // answer posts only if React attached before the click.
    await startAnonymousFlow(page, slug);
    await chooseAccident(page, "Yes");
  } finally {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }

  // The posted answer flipped the branch, so the follow-up question is visible.
  await expect(page.getByText(COUNT_LABEL)).toBeVisible();
});
