import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, fillStable, openMenu, signInWithTotp } from "./support/flow.js";
import { createForm } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { t } from "../lib/i18n/en.js";

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
  const group = page.getByRole("group", { name: t("shell.mode.builder.name") });
  await expect(group).toBeVisible();
  await expect(page.getByTestId("qcms-builder-subject")).toHaveText(subject);
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.locator(".qcms-rail")).toHaveCount(0);
  await expect(page.getByTestId("qcms-breadcrumb")).toHaveCount(0);
  await expect(page.getByTestId("qcms-assistant-button")).toHaveCount(0);
  await expect(page.getByTestId("qcms-assistant-panel")).toHaveCount(0);
  await expect(page.getByTestId("qcms-environment-switcher")).toHaveCount(0);
  await expect(page.getByTestId("qcms-workspace-switcher")).toHaveCount(0);
  await expect(page.getByTestId("appearance-menu")).toHaveCount(0);
  await expect(page.getByTestId("account-menu")).toHaveCount(0);
}

function buildPath(id: string): string {
  return `/forms/${id}/build`;
}

/** Long enough that two of them overflow the assistant pane at any supported height. */
const WORDY = `tell me about this form ${"and the step it starts with ".repeat(24)}`;

interface ComposerPin {
  /** Below the composer, inside the pane body's own inset. */
  readonly composerGap: number;
  /** Below the pane body, inside its pane. */
  readonly bodyGap: number;
  /** Below the composer, to the foot of the viewport. */
  readonly viewportGap: number;
  readonly inset: number;
  readonly transcriptScrolls: boolean;
}

async function composerPin(page: Page): Promise<ComposerPin> {
  return page.getByTestId("qcms-builder-assistant").evaluate((body) => {
    const pane = body.parentElement;
    const composer = body.querySelector(".qcms-assistant__composer");
    const turns = body.querySelector(".qcms-assistant__turns");
    if (pane === null || composer === null || turns === null) {
      throw new Error("the assistant pane has no composer or no transcript");
    }
    const inset = Number.parseFloat(window.getComputedStyle(body).paddingBlockEnd);
    const foot = composer.getBoundingClientRect().bottom;
    return {
      composerGap: Math.round(body.getBoundingClientRect().bottom - inset - foot),
      bodyGap: Math.round(
        pane.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom,
      ),
      viewportGap: Math.round(window.innerHeight - foot),
      inset: Math.round(inset),
      transcriptScrolls: turns.scrollHeight - turns.clientHeight > 1,
    };
  });
}

async function expectPinned(page: Page, where: string): Promise<void> {
  const pin = await composerPin(page);
  expect(pin.composerGap, `the composer sits at the pane bottom with ${where}`).toBeLessThanOrEqual(
    1,
  );
  expect(pin.bodyGap, `the pane body fills its pane with ${where}`).toBeLessThanOrEqual(1);
  expect(pin.viewportGap, `the composer is on screen with ${where}`).toBeGreaterThanOrEqual(0);
  expect(
    pin.viewportGap,
    `the composer sits at the foot of the viewport with ${where}`,
  ).toBeLessThanOrEqual(pin.inset + 1);
}

async function say(page: Page, message: string): Promise<void> {
  await fillStable(page.getByTestId("qcms-assistant-composer"), message);
  await page.getByTestId("qcms-assistant-send").locator("button").click();
}

async function fillTranscript(page: Page): Promise<void> {
  for (const turn of [1, 2, 3]) {
    await say(page, `${WORDY} ${String(turn)} #qcms-fake:no-proposal`);
    await expect(page.getByTestId("qcms-assistant-turns").getByRole("listitem")).toHaveCount(
      turn * 2,
      { timeout: 60_000 },
    );
  }
}

function exit(page: Page) {
  return page.getByRole("link", { name: t("shell.mode.builder.exit") });
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
  await expect(page.getByRole("button", { name: "Open preview" })).toBeDisabled();
  await axeClean(page, "/forms/new/build");

  await Promise.all([page.waitForURL(/\/forms\/new$/u), exit(page).click()]);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByTestId("account-menu")).toBeVisible();
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
    page.getByRole("menuitem", { name: t("forms.menu.agentBuilder") }).click(),
  ]);
  await waitForHydration(page);
  await expectBuilderMode(page, TITLE);
  await expect(page.getByRole("region", { name: "Assistant" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Publish" })).toHaveAttribute(
    "href",
    `/forms/${formId}/publish?returnTo=${encodeURIComponent(buildPath(formId))}`,
  );
  await expect(page.getByRole("link", { name: "Open preview" })).toHaveAttribute(
    "href",
    `/forms/${formId}/preview`,
  );
  await axeClean(page, `/forms/${formId}/build`);

  const mark = page.locator("#qcms-builder-assistant-heading > svg");
  await expect(mark).toHaveAttribute("aria-label", "Assistant");
  const markSize = await mark.evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(markSize, "the mark names the pane in place of a title word, at 24px").toBe(24);

  const paneWidth = () =>
    page
      .getByRole("region", { name: "Assistant" })
      .evaluate((node) => Math.round(node.getBoundingClientRect().width));
  expect(await paneWidth(), "the assistant pane opens at the panel's default width").toBe(400);

  const edge = page.getByRole("separator", { name: "Assistant pane width" });
  await edge.focus();
  await edge.press("ArrowRight");
  expect(await paneWidth(), "an arrow key moves the pane one step wider").toBe(440);
  await edge.press("End");
  expect(await paneWidth(), "End reaches the clamp's maximum").toBe(560);
  await edge.press("ArrowRight");
  expect(await paneWidth(), "the clamp holds at the maximum").toBe(560);
  await edge.press("Home");
  expect(await paneWidth(), "Home reaches the clamp's minimum").toBe(320);
  await edge.press("ArrowLeft");
  expect(await paneWidth(), "the clamp holds at the minimum").toBe(320);

  await page.getByRole("button", { name: t("agent.help") }).click();
  await page.getByRole("button", { name: "Default" }).click();
  expect(await paneWidth(), "the Help menu reaches the same widths without dragging").toBe(400);

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

test("keeps the assistant composer at the bottom of the pane, empty and full", async ({ page }) => {
  test.setTimeout(600_000);
  await signInWithTotp(page, EMAIL, totpSecret);

  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/forms/${formId}/build`);
    // The builder keeps its conversation per tab, so the second width starts from the first one's.
    await page.evaluate(() => {
      window.sessionStorage.clear();
    });
    await page.reload();
    await waitForHydration(page);
    const at = `${String(width)}px`;

    await expect(page.getByTestId("qcms-assistant-empty")).toBeVisible();
    await expectPinned(page, `an empty conversation at ${at}`);

    await fillTranscript(page);
    await expectPinned(page, `a long conversation at ${at}`);
    const full = await composerPin(page);
    expect(full.transcriptScrolls, `the transcript is what scrolls at ${at}`).toBe(true);
  }
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
