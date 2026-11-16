import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, openMenu, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("builder113");
const VIEWER = uniqueAdminEmail("builder113viewer");

const SLUG = `builder-${Date.now().toString(36)}`;
const TITLE = "Builder shell intake";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let totpSecret = "";
let formId = "";

async function axeClean(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS } })
    .analyze();
  expect(results.violations, `axe violations on ${where}`).toEqual([]);
}

async function expectBuilderMode(page: Page, subject: string): Promise<void> {
  const group = page.getByRole("group", { name: "Agent builder" });
  await expect(group).toBeVisible();
  await expect(page.getByTestId("qcms-builder-subject")).toHaveText(subject);
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.locator(".qcms-rail")).toHaveCount(0);
  await expect(page.getByTestId("qcms-breadcrumb")).toHaveCount(0);
  await expect(page.getByTestId("qcms-assistant-button")).toHaveCount(0);
  await expect(page.getByTestId("qcms-assistant-panel")).toHaveCount(0);
  await expect(page.getByTestId("qcms-environment-switcher")).toHaveCount(0);
}

function exit(page: Page) {
  return page.getByRole("link", { name: "Exit the agent builder" });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  await createTestAdmin(VIEWER, { grants: ["forms.viewer"], owner: false });
});

test("enters from the New form screen, and Exit returns to it", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto("/forms/new");
  await expect(page.getByRole("heading", { name: "Start blank" })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/forms\/new\/build$/u),
    page.getByRole("link", { name: "Build with the assistant" }).click(),
  ]);
  await waitForHydration(page);
  await expectBuilderMode(page, "New form");
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Share preview" })).toBeDisabled();
  await axeClean(page, "/forms/new/build");

  await Promise.all([page.waitForURL(/\/forms\/new$/u), exit(page).click()]);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("enters from a form's menu, Exit returns to the list, and Edit by hand opens the form", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1280, height: 900 });
  formId = await createForm(page, SLUG, TITLE);

  await page.goto(`/forms?q=${SLUG}`);
  await waitForHydration(page);
  await openMenu(page.getByRole("button", { name: `Actions for form ${TITLE}` }));
  await Promise.all([
    page.waitForURL(new RegExp(`/forms/${formId}/build$`, "u")),
    page.getByRole("menuitem", { name: "Edit with the agent builder" }).click(),
  ]);
  await waitForHydration(page);
  await expectBuilderMode(page, TITLE);
  await expect(page.getByRole("region", { name: "Assistant" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Publish" })).toHaveAttribute(
    "href",
    `/forms/${formId}/publish?returnTo=${encodeURIComponent(`/forms/${formId}/build`)}`,
  );
  await expect(page.getByRole("link", { name: "Share preview" })).toHaveAttribute(
    "href",
    `/forms/${formId}/preview`,
  );
  await axeClean(page, `/forms/${formId}/build`);

  const pane = await page
    .getByRole("region", { name: "Assistant" })
    .evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(pane, "the assistant pane takes its own ruled width").toBe(420);

  await Promise.all([page.waitForURL(/\/forms\?q=/u), exit(page).click()]);

  await page.goto(`/forms/${formId}/build`);
  await waitForHydration(page);
  await Promise.all([
    page.waitForURL(new RegExp(`/forms/${formId}$`, "u")),
    page.getByRole("link", { name: "Edit by hand" }).click(),
  ]);
  await expect(page.locator(".qcms-rail")).toBeVisible();
});

test("puts the assistant pane and the preview on two tabs below 64rem", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto(`/forms/${formId}/build`);
  await waitForHydration(page);

  const tabs = page.getByRole("tablist", { name: "Builder panes" });
  await expect(tabs).toBeVisible();
  await expect(page.getByRole("tab", { name: "Assistant" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("qcms-builder-assistant")).toBeVisible();
  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("qcms-builder-preview")).toBeVisible();
  await expect(page.getByTestId("qcms-assistant-button")).toHaveCount(0);
  await axeClean(page, `/forms/${formId}/build at 800px`);
});

test("hands the publish wizard back to the builder, and nowhere else", async ({ page }) => {
  test.setTimeout(300_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  const build = `/forms/${formId}/build`;

  await page.goto(`/forms/${formId}/publish?returnTo=${encodeURIComponent(build)}`);
  await expect(page.getByTestId("qcms-publish-cancel")).toHaveAttribute("href", build);

  await page.goto(`/forms/${formId}/publish?returnTo=${encodeURIComponent("//evil.example/x")}`);
  await expect(page.getByTestId("qcms-publish-cancel")).toHaveAttribute("href", `/forms/${formId}`);
});

test("answers 404 on both build routes to a View forms holder", async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await enrollNewAdmin(page, VIEWER, /\/(questions|forms|me\/access)/u);
    const existing = await page.goto(`/forms/${formId}/build`);
    expect(existing?.status()).toBe(404);
    const fresh = await page.goto("/forms/new/build");
    expect(fresh?.status()).toBe(404);

    await page.goto("/forms/new");
    await expect(page.getByRole("link", { name: "Build with the assistant" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
