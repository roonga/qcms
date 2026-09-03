/**
 * The hydration wait every entry helper owns, tested as harness plumbing in its
 * own right (issue #121, extended for the `data-qcms-hydrated` marker by #159).
 *
 * Three things have to hold for `waitForHydration` to be worth having, and none of
 * them is visible from a passing flow spec:
 *
 * 1. **The marker cannot lie.** The wait now asks the page directly rather than
 *    inferring hydration from a renderer testid, which moves the burden of proof:
 *    a signal the page controls is only trustworthy if the page cannot emit it
 *    before it is true. The attribute is stamped from a mount effect, so it is
 *    absent from a server render by construction - and the first test asserts that
 *    against the real SSR BYTES rather than against the theory, because "an effect
 *    cannot run on the server" stops being the whole story the moment someone adds
 *    the attribute to a rendered element by hand.
 * 2. **It cannot pass vacuously.** The portal server-renders a real, fillable
 *    fallback form (029), so a spec can interact with the step long before React
 *    attaches. A wait that polled for something already true of that markup, or
 *    that timed out into a truthy default, would pass every run and protect
 *    nothing. The first test pins the negative half against the real step served
 *    with its script requests starved (markup present, React never runs, so the
 *    page cannot hydrate), then the positive half on the same step served normally.
 *    Both halves are needed: the rejection alone would also be produced by a typo
 *    in the marker's name. Starving the bundle over the network is deliberate: an
 *    earlier version built the fixture by editing the SSR HTML string, which is
 *    both fragile (a close tag it failed to match would silently restore
 *    hydration) and a thing static analysis rightly flags as unsafe HTML handling.
 * 3. **An entry helper's first interaction is not silently discarded.** The last
 *    test drives the real entry helper with the CPU throttled, which widens the gap
 *    between first paint and React attaching, and asserts the answer still posts.
 *    Reverting the wait in `startAnonymousFlow` reds it: that is how the race was
 *    demonstrated before it was fixed, rather than assumed from symmetry with
 *    `startKitchenSink`. Observed mechanism, for whoever debugs this next: the
 *    pre-hydration click checks the fallback form's native radio, React then
 *    replaces that markup with its own render, the checked state goes with it, and
 *    NO answer is ever posted. Nothing fails at the click. The red arrives later,
 *    as a timeout inside whichever helper awaited the first `POST /answers`.
 *
 * The second test covers the case that motivated #159 in the first place: the entry
 * page, which has no primary action and which the previous testid probe therefore
 * could not serve at all.
 */

import { expect, test } from "./support/gates.js";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, COUNT_LABEL, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { waitForHydration } from "./support/hydration.js";
import { starveScripts } from "./support/script-starve.js";
import { HYDRATED_ATTRIBUTE } from "../lib/hydration.js";

/**
 * Hydration is scheduled work, so it lands after the load event: throttling the
 * CPU stretches that window from sub-frame to seconds without touching the network
 * or the helper under test. Emulated, not real slowness, which is the point: it
 * makes an intermittent race deterministic. At this rate the un-waited helper
 * handed back an inert page every run.
 */
const CPU_THROTTLE_RATE = 6;

/** How long the wait is given on a page that must never satisfy it. */
const REJECTION_BUDGET_MS = 3_000;

/**
 * How long the wait is given on a page that MUST satisfy it. Deliberately far below
 * the suite default: a positive half that leaned on the default timeout would still
 * pass if the marker only ever arrived at the last possible moment, which is not the
 * claim being made.
 */
const RESOLUTION_BUDGET_MS = 15_000;

test("the hydration wait rejects on server-rendered markup and resolves once React attaches", async ({
  page,
}) => {
  const { slug } = readFixtures();

  // Starve the app bundle: every script request is answered with an empty 200, so
  // the page gets its real server-rendered markup and React never runs. Page
  // JavaScript stays enabled throughout, which is what lets `waitForFunction` still
  // poll. See `support/script-starve.ts` for why an empty body rather than an abort.
  const starvation = await starveScripts(page);

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
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved",
  ).toBeGreaterThan(0);

  // The marker is not in the served bytes. Fetched over the request context rather
  // than read out of the live DOM on purpose: this is a claim about what the SERVER
  // sends, and the DOM has already been through a browser by the time a locator can
  // see it. If anyone ever renders `data-qcms-hydrated` as an attribute on an
  // element instead of stamping it from the mount effect, this is the assertion that
  // says so - and every wait in the suite would otherwise have quietly become a
  // no-op.
  const served = await page.request.get(stepUrl);
  expect(served.ok(), "the step page must be served successfully to be inspected").toBe(true);
  expect(
    await served.text(),
    "the hydration marker must never appear in server-rendered HTML",
  ).not.toContain(HYDRATED_ATTRIBUTE);

  // The markup is nonetheless genuinely interactive: the question, its radios and a
  // submit button are all present and operable without JavaScript. An interaction
  // here is silently thrown away, which is the whole reason the wait exists.
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeAttached();
  await expect(page.locator("button[type='submit']")).toBeVisible();

  // Yet the wait does not pass on it.
  let failure = "";
  try {
    await waitForHydration(page, { timeout: REJECTION_BUDGET_MS });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure, "the wait must fail on markup React never attached to").toMatch(/timeout/i);

  // Positive half: the same step, served with its scripts, resolves the wait. So
  // the rejection above was the absence of hydration, not a broken marker name.
  starvation.restore();
  await page.goto(stepUrl);
  await waitForHydration(page, { timeout: RESOLUTION_BUDGET_MS });

  // And the marker was not premature. On the flow page it is mounted on the
  // CONTROLLED render, not on the shared shell the no-JS fallback also uses, so by
  // the time it appears the progressive swap has committed and React's own primary
  // action is on screen. That is the property the entry helpers depend on; without
  // it the marker would be a weaker signal than the testid probe it replaced.
  await expect(page.getByTestId("primary-action")).toBeVisible();
});

test("the hydration wait works on the entry page, which has no primary action", async ({
  page,
}) => {
  const { slug } = readFixtures();

  // The case #159 exists for. `/f/<slug>` renders a plain `<button type="submit">`
  // in a native form and carries no `primary-action` testid at all, so the previous
  // probe could only ever time out here - which is what blocked auditing this page's
  // hydrated render (issue #160) and what forced `appearance.pw.ts` to nominate a
  // stand-in node of its own.
  const starvation = await starveScripts(page);
  await page.goto(`/f/${slug}`);
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved",
  ).toBeGreaterThan(0);

  let failure = "";
  try {
    await waitForHydration(page, { timeout: REJECTION_BUDGET_MS });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure, "the entry page must not report hydration it never performed").toMatch(
    /timeout/i,
  );

  // Served normally the same page resolves the wait, well inside a budget rather
  // than by the grace of the suite's default timeout.
  starvation.restore();
  await page.goto(`/f/${slug}`);
  await waitForHydration(page, { timeout: RESOLUTION_BUDGET_MS });
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
