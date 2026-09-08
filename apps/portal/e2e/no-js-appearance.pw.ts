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

/** The two link-error headings the `?kind=` parameter chooses between (`lib/i18n/en.ts`). */
const EXPIRED_TITLE = "This link has expired";
const INVALID_TITLE = "This link is not valid";

/** The disclosure, opened. Native `<details>`, so this needs no scripting. */
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

  // Walk back up the redirect chain rather than watching for the POST separately: this
  // proves the page in hand IS the one the POST redirected to, which two independent
  // waits could not. The 303 is what makes this post/redirect/get rather than a
  // resubmit-on-reload, and a 200 there would mean the route rendered a page itself.
  const posted = response.request().redirectedFrom();
  expect(posted, "the served page did not come from a redirect").not.toBeNull();
  expect(posted?.method()).toBe("POST");
  expect(new URL(posted?.url() ?? "http://absent.invalid").pathname).toBe(APPEARANCE_ROUTE);

  const redirect = await posted?.response();
  expect(redirect?.status()).toBe(303);

  // The `Location` names this deployment, absolutely (PR #859 review). A relative header
  // is what let a normalised `//evil.example` leave the handler, so the shape is asserted
  // on the wire rather than trusted to the validator that produced the path.
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

  // The regression this issue is about. `display: none` is a real hide: it leaves the
  // tab order and the accessibility tree, so `toBeVisible` is the right assertion and
  // it is the one that used to fail.
  await expect(page.getByTestId("appearance")).toBeVisible();
  await openAppearance(page);

  // The scripted path's only difference is this button, which is why it is the one
  // element the `<noscript>` rule reveals. Here it must be operable, so it is asserted
  // through the accessibility tree as well: a visible button with no accessible name
  // would satisfy the CSS locator and fail the respondent using it.
  await expect(applyButton(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply appearance" })).toBeVisible();

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

  await expect(page.locator("html")).toHaveClass(
    new RegExp(`\\b${fontClass(HARNESS_FONT)}\\b`, "u"),
  );

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
  // An explicit budget with its reason (PR #859 review measured 19.7s of a 30s default on
  // a cold seat). This is the only case here that starts a session, so on a run where this
  // spec goes first it pays the dev server's first compile of `/f/[formSlug]/start` and
  // `/s/[sessionId]` as well as of `/appearance`. That cost is the harness's, not this
  // feature's, and a case sitting two thirds of the way to its timeout is the shape issue
  // #604 asks to be reported rather than left to flake.
  test.setTimeout(90_000);
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

test("the query string survives, so a page whose copy depends on it comes back the same", async ({
  page,
}) => {
  // `app/link-error/page.tsx` selects its entire copy from `?kind=`, so a return target of
  // the path alone sent a respondent who applied High contrast on the expired-link page
  // back to the generic "this link is not valid" screen (PR #859 review, Copilot). The
  // hidden field carries path AND query, and both go through the same origin check.
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
  // Named literally rather than captured before the submit: the defect was a redirect to a
  // page that renders the FALLBACK copy, so a comparison against "whatever it said before"
  // would still have to know which of the two strings is the right one.
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

    // Rendered, so the document is the same either way, and hidden, so a scripted
    // respondent is never offered a button whose only effect would be a reload. The
    // count assertion is what separates "hidden" from "not there".
    await expect(applyButton(page)).toHaveCount(1);
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
