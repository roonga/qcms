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

async function openAppearance(page: Page): Promise<void> {
  await page.locator('[data-testid="appearance"] > summary').click();
  await expect(page.getByTestId("appearance-mode")).toBeVisible();
}

/** One chip of a segmented group, addressed by value rather than by position. */
function chip(page: Page, group: "mode" | "density", value: string) {
  return page.locator(`[data-testid="appearance-${group}"] label[data-value="${value}"]`);
}

function applyButton(page: Page) {
  return page.locator("button.qcms-appearance__apply");
}

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
