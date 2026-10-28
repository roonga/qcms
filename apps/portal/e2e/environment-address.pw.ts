import { expect, test } from "./support/gates.js";

import { chooseAccident } from "./support/flow.js";
import { readFixtures } from "./support/fixtures.js";
import { waitForHydration } from "./support/hydration.js";

test("a test link redeems under its own prefix and the flow stays there", async ({ page }) => {
  const { testEnvironmentToken } = readFixtures();
  await page.goto(`/test/l/${testEnvironmentToken}`);

  await page.waitForURL(/\/test\/s\/ses_/);
  await expect(page.getByText("Any at-fault accident in the last 3 years?")).toBeVisible();

  await waitForHydration(page);
  const answered = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/answers"),
  );
  await chooseAccident(page, "No");
  expect(new URL((await answered).url()).pathname).toMatch(/^\/test\/s\/ses_[^/]+\/answers$/);
});

test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("the step form posts inside the environment too", async ({ page }) => {
    const { testEnvironmentToken } = readFixtures();
    await page.goto(`/test/l/${testEnvironmentToken}`);
    await page.waitForURL(/\/test\/s\/ses_/);

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

  await page.waitForURL(/\/test\/link-error/);
  await expect(page.getByText("This link is not valid")).toBeVisible();
});

test("there is no anonymous entry under a prefix (criterion 3)", async ({ page, browserGuard }) => {
  browserGuard.expectRequestFailure({ status: 404, url: /\/test\/f\// });
  const { slug } = readFixtures();
  const response = await page.goto(`/test/f/${slug}`);
  expect(response?.status()).toBe(404);

  const prod = await page.goto(`/f/${slug}`);
  expect(prod?.status()).toBe(200);
});
