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

test("a test link redeems under its own prefix and the flow stays there", async ({ page }) => {
  const { testEnvironmentToken } = readFixtures();
  await page.goto(`/test/l/${testEnvironmentToken}`);

  // The session address is `test`'s, not `prod`'s. An unprefixed `/s/{id}` would be a
  // production address, and the session is a schema away: the page would answer the
  // recovery screen rather than the step.
  await page.waitForURL(/\/test\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();

  // The no-JS form posts inside the environment too, which is what carries a scriptless
  // respondent through the flow rather than onto production's surface. Read from the
  // server-rendered markup, which is the only render a scriptless respondent gets.
  const action = await page.locator("form[method='post']").first().getAttribute("action");
  expect(action).toMatch(/^\/test\/s\/ses_[^/]+\/step$/);
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
