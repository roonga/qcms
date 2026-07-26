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
 *    nothing. The first test pins the negative half against the step's OWN
 *    server-rendered HTML with the hydration bundle removed (markup present, React
 *    absent, so the page can never hydrate), then the positive half on the same
 *    step served normally. Both halves are needed: the rejection alone would also
 *    be produced by a typo in the probe selector.
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

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  const stepUrl = page.url();

  // The step's own SSR response with every script removed: real server-rendered
  // markup that can never hydrate. The `link` tags go too, so the page makes no
  // subresource requests at all (an about:blank base URL would 404 them and trip
  // the browser error gate).
  const ssrHtml = await (await page.request.get(stepUrl)).text();
  const neverHydrates = ssrHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");
  expect(neverHydrates, "the bundle must be gone or the page would hydrate").not.toMatch(
    /<script/i,
  );

  // Navigate away BEFORE swapping in that markup. `setContent` rewrites the
  // current document in place, leaving the already-hydrated React app from the
  // navigation above holding references to nodes that no longer exist: its next
  // commit then throws "Failed to execute 'removeChild' on 'Node'" and the browser
  // error gate reds the test (intermittently, since it depends on whether React
  // has pending work). A real navigation to a blank page tears that JS context
  // down first, so the SSR markup lands in a document React has never touched.
  await page.goto("about:blank");
  await page.setContent(neverHydrates);

  // This markup is genuinely interactive: the question, its radios and a submit
  // button are all present and operable without JavaScript (the no-JS specs rely
  // on exactly this). An interaction here is silently thrown away later.
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
