/**
 * The appearance controls without JavaScript: a real `<form method="post">` writing the
 * same three cookies the scripted controls write.
 *
 * `lib/server/appearance-form.test.ts` proves what the route accepts over hostile
 * strings. Three things no unit test can reach are proved here: the control is reachable
 * with scripting off, which is the regression this closed, `display: none` having removed
 * it from the tab order and the accessibility tree; each axis survives the redirect,
 * asserted on the bytes the server sent back rather than the DOM, the whole point of the
 * cookie being that the next server render is already correct; and the scripted path is
 * unchanged, so there is no second render and no flash.
 *
 * The harness defaults to a non-default font, so every font assertion is a real switch
 * rather than a no-op.
 */

import type { Page } from "@playwright/test";
import { fontClass } from "@roonga/qcms-ui/fonts";

import { APPEARANCE_ROUTE } from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { waitForHydration } from "./support/hydration.js";
import { HARNESS_FONT } from "./support/harness-config.js";

test.use({ javaScriptEnabled: false });

/** The two link-error headings the `?kind=` parameter chooses between (`lib/i18n/en.ts`). */
const EXPIRED_TITLE = "This link has expired";
const INVALID_TITLE = "This link is not valid";

/**
 * The disclosure, opened. Native `<details>`, so this needs no scripting.
 *
 * This copy deliberately has NO hydration wait, which is what makes it a separate
 * helper from the one in `appearance.pw.ts` rather than a duplicate of it (issue
 * #946). With `javaScriptEnabled: false` the hydration marker is never stamped, so
 * waiting for it here would be an unconditional timeout - and there is nothing to
 * wait for: the panel this opens is served markup inside a native `<details>`, and
 * that is precisely the claim this file exists to make. The one test below that runs
 * with scripting ON asks for hydration itself, at its own call site, so the scripted
 * path and the no-JS path stay told apart rather than merged.
 */
async function openAppearance(page: Page): Promise<void> {
  await page.locator('[data-testid="appearance"] > summary').click();
  await expect(page.getByTestId("appearance-mode")).toBeVisible();
}

/** One chip of a segmented group, addressed by value rather than by position. */
function chip(page: Page, group: "mode" | "density", value: string) {
  return page.locator(`[data-testid="appearance-${group}"] label[data-value="${value}"]`);
}

/**
 * The `<noscript>`-revealed submit button, which is the whole no-JS seam.
 *
 * Located by class rather than by role, deliberately: a role query does not match an
 * element that is out of the accessibility tree, so it would report "hidden" and
 * "absent" identically - and the difference is the entire design here (rendered
 * always, revealed by CSS). The accessible name is asserted separately, once, where
 * the button is meant to be reachable.
 */
function applyButton(page: Page) {
  return page.locator("button.qcms-appearance__apply");
}

/**
 * Submit the form and return the HTML the server sent for the page it redirected to.
 *
 * The assertion target is deliberately the RESPONSE BODY, not the live DOM. With
 * scripting off the two cannot differ, but asserting the bytes says the thing that
 * actually matters: the server read the cookie and stamped the root class itself, so a
 * respondent's next page load is correct in its first byte rather than corrected after
 * it paints.
 */
async function applyAppearance(page: Page): Promise<string> {
  const served = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.status() === 200,
  );
  await applyButton(page).click();
  const response = await served;

  const posted = response.request().redirectedFrom();
  expect(posted, "the served page did not come from a redirect").not.toBeNull();
  expect(posted?.method()).toBe("POST");
  expect(new URL(posted?.url() ?? "http://absent.invalid").pathname).toBe(APPEARANCE_ROUTE);

  const redirect = await posted?.response();
  expect(redirect?.status()).toBe(303);

  const location = (await redirect?.headerValue("location")) ?? "";
  expect(new URL(location).origin).toBe(new URL(page.url()).origin);

  return await response.text();
}

/** The `qcms-` cookies currently in the jar, as a name -> value map. */
async function appearanceCookies(page: Page): Promise<Record<string, string>> {
  const jar = await page.context().cookies();
  return Object.fromEntries(
    jar.filter((entry) => entry.name.startsWith("qcms-")).map((entry) => [entry.name, entry.value]),
  );
}

/** The `class` attribute of `<html>` in a served document. */
function rootClass(html: string): string {
  return /<html[^>]*\bclass="([^"]*)"/u.exec(html)?.[1] ?? "";
}

test("the appearance control is reachable and operable with JavaScript disabled", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  await expect(page.getByTestId("appearance")).toBeVisible();
  await openAppearance(page);

  await expect(applyButton(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply appearance" })).toBeVisible();

  const form = page.locator("form.qcms-appearance__panel");
  await expect(form).toHaveAttribute("method", /post/iu);
  await expect(form).toHaveAttribute("action", APPEARANCE_ROUTE);
  await expect(form.locator('input[name="returnTo"]')).toHaveAttribute("value", `/f/${slug}`);
});

test("MODE: High contrast survives the redirect, with no script in play", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await openAppearance(page);

  await expect(page.locator("html")).toHaveClass(/\blight\b/u);

  await chip(page, "mode", "hc").click();
  const served = await applyAppearance(page);

  expect(rootClass(served)).toMatch(/\bhc\b/u);
  expect(rootClass(served)).not.toMatch(/\blight\b/u);
  expect((await appearanceCookies(page))["qcms-theme"]).toBe("hc");

  const elsewhere = await page.goto(`/f/${slug}`);
  expect(rootClass((await elsewhere?.text()) ?? "")).toMatch(/\bhc\b/u);
});

test("FONT: a legibility face survives the redirect, with no script in play", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await openAppearance(page);

  await expect(page.locator("html")).toHaveClass(
    new RegExp(`\\b${fontClass(HARNESS_FONT)}\\b`, "u"),
  );

  await page.getByTestId("appearance-font").selectOption("atkinson");
  const served = await applyAppearance(page);

  expect(rootClass(served)).toMatch(new RegExp(`\\b${fontClass("atkinson")}\\b`, "u"));
  expect(rootClass(served)).not.toMatch(new RegExp(`\\b${fontClass(HARNESS_FONT)}\\b`, "u"));
  expect((await appearanceCookies(page))["qcms-font"]).toBe("atkinson");
});

test("DENSITY: Compact survives the redirect, with no script in play", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await openAppearance(page);

  await expect(page.locator("html")).not.toHaveClass(/\bdensity-/u);

  await chip(page, "density", "compact").click();
  const served = await applyAppearance(page);

  expect(rootClass(served)).toMatch(/\bdensity-compact\b/u);
  expect((await appearanceCookies(page))["qcms-density"]).toBe("compact");
});

test("the redirect returns the respondent to the page they were on, mid-flow", async ({ page }) => {
  test.setTimeout(90_000);
  const { slug } = readFixtures();

  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);
  const stepUrl = new URL(page.url());

  await openAppearance(page);
  await chip(page, "mode", "dark").click();
  const served = await applyAppearance(page);

  expect(new URL(page.url()).pathname).toBe(stepUrl.pathname);
  expect(rootClass(served)).toMatch(/\bdark\b/u);
});

test("the query string survives, so a page whose copy depends on it comes back the same", async ({
  page,
}) => {
  const heading = page.getByRole("heading", { level: 1 });

  await page.goto("/link-error?kind=expired");
  await expect(heading).toHaveText(EXPIRED_TITLE);
  await openAppearance(page);
  await expect(page.locator('form.qcms-appearance__panel input[name="returnTo"]')).toHaveAttribute(
    "value",
    "/link-error?kind=expired",
  );

  await chip(page, "mode", "hc").click();
  const served = await applyAppearance(page);

  expect(new URL(page.url()).search).toBe("?kind=expired");
  await expect(heading).toHaveText(EXPIRED_TITLE);
  await expect(heading).not.toHaveText(INVALID_TITLE);
  expect(rootClass(served)).toMatch(/\bhc\b/u);
});

test.describe("with scripting on, the enhanced path is unchanged", () => {
  test.use({ javaScriptEnabled: true });

  test("Apply is invisible and choosing a chip applies without a navigation", async ({ page }) => {
    const { slug } = readFixtures();
    await page.goto(`/f/${slug}`);
    await waitForHydration(page);
    await openAppearance(page);

    await expect(applyButton(page)).toHaveCount(1);
    await expect(applyButton(page)).toBeHidden();

    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>)["qcmsNoReloadMarker"] = "kept";
    });

    await chip(page, "mode", "dark").click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/u);

    expect(
      await page.evaluate(
        () => (window as unknown as Record<string, unknown>)["qcmsNoReloadMarker"],
      ),
    ).toBe("kept");
  });
});
