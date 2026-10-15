/**
 * The environment's address, in a browser (task 066, ADR-40, Q16, Q21, SEC-14).
 *
 * Criterion 2 asks for the prefix asserted on **both** surfaces. The API's half is
 * asserted against a real Postgres with more than one surface mounted
 * (`apps/api/src/features/responses/start-session/environment-addresses.integration.test.ts`);
 * this is the portal's, and it is only assertable here: what it checks is that a browser
 * which followed a `/test/l/{token}` address **stays** inside `test` for the rest of the
 * flow. A unit test of the proxy can show the rewrite; only a browser shows that the
 * addresses the pages emit carry the prefix too, because that is a property of the
 * rendered HTML and of every redirect the respondent follows.
 *
 * Criterion 3's portal half is here as well: `/<env>/f/{slug}` is not a route, asserted as
 * the response status rather than as a rendered refusal.
 */

import { expect, test } from "./support/gates.js";

import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

test("a test link redeems under its own prefix and the flow stays there", async ({ page }) => {
  const { testEnvironmentToken } = readFixtures();
  await page.goto(`/test/l/${testEnvironmentToken}`);

  // The session address is `test`'s, not `prod`'s. An unprefixed `/s/{id}` would be a
  // production address, and the session is a schema away: the page would answer the
  // recovery screen rather than the step.
  await page.waitForURL(/\/test\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();

  // And the SCRIPTED path posts inside the environment, which is what the `basePath` prop
  // buys: a `fetch` to an unprefixed `/s/{id}/answers` would reach `prod`'s route, which
  // exists and answers - about a session that is a schema away. Asserted on the request
  // the browser actually made rather than on markup, because after hydration the native
  // form is unmounted and there is no action attribute left to read.
  //
  // The hydration wait is what makes that the SCRIPTED path: before it, the same click is
  // a native form control and the post is a document navigation to `/step`.
  await waitForHydration(page);
  const answered = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/answers"),
  );
  await page.getByRole("radio", { name: "No", exact: true }).click();
  expect(new URL((await answered).url()).pathname).toMatch(/^\/test\/s\/ses_[^/]+\/answers$/);
});

/**
 * The no-JS half, in a block of its own so `test.use` scopes the scripting switch to it.
 *
 * The step form's `action` is only on the page a scriptless respondent gets: with
 * JavaScript on, `ProgressiveStep` swaps the native form for the controlled flow and
 * unmounts it, so there is no attribute left to read. A whole context with scripting off
 * is also what every other no-JS spec here uses, and it keeps the console and server-log
 * gates attached to the `page` fixture rather than to a context this file opened itself.
 */
test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("the step form posts inside the environment too", async ({ page }) => {
    const { testEnvironmentToken } = readFixtures();
    await page.goto(`/test/l/${testEnvironmentToken}`);
    await page.waitForURL(/\/test\/s\/ses_/);

    // Scoped to the step card: since issue #195 the header's appearance controls are a
    // second native form on the page, and that is the one an unscoped locator finds
    // first.
    const action = await page
      .getByTestId("step-card")
      .locator("form[method='post']")
      .first()
      .getAttribute("action");
    expect(action).toMatch(/^\/test\/s\/ses_[^/]+\/step$/);
  });
});

test("the prod address is unchanged, which is the half criterion 7 is about", async ({ page }) => {
  const { validToken } = readFixtures();
  await page.goto(`/l/${validToken}`);
  await page.waitForURL(/\/s\/ses_/);
  expect(new URL(page.url()).pathname).toMatch(/^\/s\/ses_[^/]+$/);
});

test("a prod token under the test prefix is refused, not redirected or honoured", async ({
  page,
}) => {
  const { validToken } = readFixtures();
  await page.goto(`/test/l/${validToken}`);

  // The API answers `LINK_WRONG_ENVIRONMENT`, which the BFF maps to the same screen every
  // other unusable link reaches: the environment is visible in the path and nowhere else
  // (Q16), so the screen must not tell a holder their token is real somewhere else.
  await page.waitForURL(/\/test\/link-error/);
  await expect(page.getByText("This link is not valid")).toBeVisible();
});

test("there is no anonymous entry under a prefix (criterion 3)", async ({ page, browserGuard }) => {
  // The browser reports any failed resource load as a `console.error`, and the console
  // gate refuses one unless the test declared it (issue #166). Declared rather than
  // allowlisted: the 404 is the assertion, so it has to be provoked here and nowhere else.
  browserGuard.expectRequestFailure({ status: 404, url: /\/test\/f\// });
  const { slug } = readFixtures();
  const response = await page.goto(`/test/f/${slug}`);
  // A 404 because the route does not exist, not a 403 a handler produced (ADR-09). The
  // same slug at the unprefixed address is the production entry page and works.
  expect(response?.status()).toBe(404);

  const prod = await page.goto(`/f/${slug}`);
  expect(prod?.status()).toBe(200);
});
