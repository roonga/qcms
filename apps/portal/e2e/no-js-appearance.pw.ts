/**
 * The appearance controls without JavaScript (issue #195).
 *
 * Task 053 shipped mode, font and density as a scripted enhancement and hid the whole
 * disclosure with a `<noscript>` rule, so a respondent with scripting off had an
 * appearance chain of cookie-then-config and no way to set the cookie. That is the
 * respondent most likely to need High contrast or one of the legibility faces. The
 * controls now sit in a real `<form method="post">` posting to `app/appearance/route.ts`,
 * which writes the same three cookies the scripted controls write and 303s back.
 *
 * `lib/server/appearance-form.test.ts` proves what the route accepts and where it will
 * redirect, over hostile strings no browser sends. This file proves the three things a
 * unit test cannot reach:
 *
 *  - the control is REACHABLE with scripting off (the regression this fixes: it used
 *    to be `display: none`, which removes it from the tab order and the accessibility
 *    tree entirely);
 *  - each axis SURVIVES THE REDIRECT, asserted on the bytes the server sent back
 *    rather than on the DOM, because the whole point of the cookie is that the next
 *    server render is already correct;
 *  - the scripted path is UNCHANGED - Apply is invisible, and choosing a chip still
 *    applies without a navigation, so there is no second render and no flash.
 *
 * The harness offers `atkinson, inter, merriweather, jetbrainsmono` plus System and
 * defaults to `inter` (`support/harness-config.ts`), so every font assertion below is
 * a real switch away from a non-default default rather than a no-op.
 */

import type { Page } from "@playwright/test";
import { fontClass } from "@roonga/qcms-ui/fonts";

import { APPEARANCE_ROUTE } from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { waitForHydration } from "./support/hydration.js";
import { HARNESS_FONT } from "./support/harness-config.js";

test.use({ javaScriptEnabled: false });

/** The disclosure, opened. Native `<details>`, so this needs no scripting. */
async function openAppearance(page: Page): Promise<void> {
  await page.locator('[data-testid="appearance"] > summary').click();
  await expect(page.getByTestId("appearance-mode")).toBeVisible();
}

/** One chip of a segmented group, addressed by value rather than by position. */
function chip(page: Page, group: "mode" | "density", value: string) {
  return page.locator(`[data-testid="appearance-${group}"] label[data-value="${value}"]`);
}

/** The `<noscript>`-revealed submit button, which is the whole no-JS seam. */
function applyButton(page: Page) {
  return page.getByRole("button", { name: "Apply appearance" });
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
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === APPEARANCE_ROUTE,
  );
  const served = page.waitForResponse(
    (response) => response.request().isNavigationRequest() && response.status() === 200,
  );
  await applyButton(page).click();

  // The route answers 303, which is what makes this post/redirect/get rather than a
  // resubmit-on-reload. A 200 here would mean the route rendered something itself.
  expect((await posted).status()).toBe(303);
  return await (await served).text();
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

  // The regression this issue is about. `display: none` is a real hide: it leaves the
  // tab order and the accessibility tree, so `toBeVisible` is the right assertion and
  // it is the one that used to fail.
  await expect(page.getByTestId("appearance")).toBeVisible();
  await openAppearance(page);

  // The scripted path's only difference is this button, which is why it is the one
  // element the `<noscript>` rule reveals.
  await expect(applyButton(page)).toBeVisible();

  // The form posts to the portal's own route, which `form-action 'self'` allows and
  // which carries the page to come back to.
  const form = page.locator("form.qcms-appearance__panel");
  await expect(form).toHaveAttribute("method", /post/iu);
  await expect(form).toHaveAttribute("action", APPEARANCE_ROUTE);
  await expect(form.locator('input[name="returnTo"]')).toHaveAttribute("value", `/f/${slug}`);
});

test("MODE: High contrast survives the redirect, with no script in play", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await openAppearance(page);

  // The default without a cookie: the harness leaves `QCMS_PORTAL_MODE` at `auto`, and
  // with no script to consult the OS signals the server stamps Light.
  await expect(page.locator("html")).toHaveClass(/\blight\b/u);

  await chip(page, "mode", "hc").click();
  const served = await applyAppearance(page);

  expect(rootClass(served)).toMatch(/\bhc\b/u);
  expect(rootClass(served)).not.toMatch(/\blight\b/u);
  expect((await appearanceCookies(page))["qcms-theme"]).toBe("hc");

  // It is a PREFERENCE, not a per-page choice: a fresh navigation still gets it.
  const elsewhere = await page.goto(`/f/${slug}`);
  expect(rootClass((await elsewhere?.text()) ?? "")).toMatch(/\bhc\b/u);
});

test("FONT: a legibility face survives the redirect, with no script in play", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await openAppearance(page);

  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${fontClass(HARNESS_FONT)}\\b`, "u"));

  // Atkinson Hyperlegible is in the registry's Accessibility group and is one of the
  // two reasons this issue was raised rather than shrugged at.
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

  // Comfortable is the base spacing block, so it carries no class: its evidence is the
  // absence of the other two.
  await expect(page.locator("html")).not.toHaveClass(/\bdensity-/u);

  await chip(page, "density", "compact").click();
  const served = await applyAppearance(page);

  expect(rootClass(served)).toMatch(/\bdensity-compact\b/u);
  expect((await appearanceCookies(page))["qcms-density"]).toBe("compact");
});

test("the redirect returns the respondent to the page they were on, mid-flow", async ({ page }) => {
  const { slug } = readFixtures();

  // Start a real session, so the return target is a step path rather than the entry
  // page: this is the case a bare redirect-to-root would silently break.
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

test.describe("with scripting on, the enhanced path is unchanged", () => {
  test.use({ javaScriptEnabled: true });

  test("Apply is invisible and choosing a chip applies without a navigation", async ({ page }) => {
    const { slug } = readFixtures();
    await page.goto(`/f/${slug}`);
    await waitForHydration(page);
    await openAppearance(page);

    // Rendered, so the document is the same either way, and hidden, so a scripted
    // respondent is never offered a button whose only effect would be a reload.
    await expect(applyButton(page)).toBeHidden();

    // A marker that only survives if the page is never reloaded. Asserting the class
    // alone would pass a full round trip, which is exactly what must not happen here.
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
