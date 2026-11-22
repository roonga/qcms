import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

/*
 * The derive flow against the local TLS fixture origin the harness points the SEC-18 fetcher
 * at. Nothing here reaches a real website, and nothing in the browser fetches at all: the
 * address goes to the API route, and the route makes the one request.
 */

test.describe.configure({ mode: "serial" });

const WORKSPACE_ID = "org_default_workspace";
const EMAIL = uniqueAdminEmail("derive117");
const RUN = Date.now().toString(36);
const TEXT_SLUG = `e2e-derive-text-${RUN}`;
const TEXT_ID = `q_${TEXT_SLUG.replaceAll("-", "_")}`;
const TEXT_LABEL = "E2E Long text question";
const THEME_NAME = `From the site ${RUN}`;

const SITE = "https://brand.example/";
const NO_COLOUR_SITE = "https://other-site.example/";
const REFUSED_SITE = "https://not-a-fixture.example/";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

let totpSecret = "";
let formId = "";

function drawer(page: Page): Locator {
  return page.getByTestId("qcms-appearance-drawer");
}

function surface(page: Page): Locator {
  return page.getByTestId("qcms-builder-device").getByTestId("qcms-preview-surface");
}

function token(target: Locator, name: string): Promise<string> {
  return target.evaluate(
    (element, property) => getComputedStyle(element).getPropertyValue(property).trim(),
    name,
  );
}

async function axeClean(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS } })
    .analyze();
  expect(results.violations, `axe violations on ${where}`).toEqual([]);
}

async function openDrawer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(drawer(page)).toBeVisible();
}

async function openBuilder(page: Page): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/forms/${formId}/build`);
  await waitForHydration(page);
  await expect(surface(page).getByText(TEXT_LABEL)).toBeVisible({ timeout: 30_000 });
}

// React Aria switches hide their input inside the label; the label is the pointer target.
function lock(page: Page): Locator {
  return page.getByRole("switch", { name: /Lock appearance/u }).locator("xpath=ancestor::label[1]");
}

async function derive(page: Page, address: string): Promise<void> {
  await drawer(page).getByLabel("Website address").fill(address);
  await drawer(page).getByRole("button", { name: "Get theme" }).click();
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("builds a draft the derive can dress", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await createDraft(page, TEXT_SLUG, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  formId = await createForm(page, `e2e-derive-${RUN}`, "Derive intake");
  await addStep(page, "About you");
  await pinQuestion(page, TEXT_ID, 1);
  await waitForSaved(page);
});

test("reads a site, previews it unsaved, keeps it as a theme and applies it", async ({ page }) => {
  test.setTimeout(300_000);
  const outbound: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.hostname.endsWith("localhost") && url.hostname !== "127.0.0.1") {
      outbound.push(request.url());
    }
  });

  await openBuilder(page);
  await openDrawer(page);
  await axeClean(page, "the drawer before a derive");

  // Nothing is read until the address is a whole https one.
  await drawer(page).getByLabel("Website address").fill("brand.example");
  await expect(drawer(page).getByRole("button", { name: "Get theme" })).toBeDisabled();

  await derive(page, SITE);
  const values = page.getByTestId("qcms-appearance-derive-values");
  await expect(values).toBeVisible({ timeout: 60_000 });
  await expect(values).toContainText("#0f766e");
  await expect(values).toContainText("lexend");
  await expect(drawer(page)).toContainText("Taken from the site");
  await expect(drawer(page)).toContainText("Nothing from the site is stored except these values");

  // The derived look is live in the preview and marked unsaved in the Current slot.
  await expect.poll(() => token(surface(page), "--color-primary")).toBe("#0f766e");
  await expect(drawer(page).getByLabel("Theme", { exact: true })).toContainText("Not saved");
  await expect(page.getByTestId("qcms-appearance-unsaved")).toBeVisible();
  await axeClean(page, "the drawer with a derived theme");

  await page.getByTestId("qcms-appearance-theme-save").click();
  await page.getByTestId("qcms-appearance-theme-name").fill(THEME_NAME);
  await page.getByTestId("qcms-appearance-theme-save").click();
  await expect(page.getByText(`${THEME_NAME} is a workspace theme now.`)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("qcms-appearance-unsaved")).toHaveCount(0);
  await axeClean(page, "the drawer after the theme was kept");

  await page.getByTestId("qcms-appearance-done").click();
  await expect(page.getByText("Appearance saved to the draft.")).toBeVisible();

  await page.reload();
  await waitForHydration(page);
  await expect.poll(() => token(surface(page), "--color-primary")).toBe("#0f766e");
  await openDrawer(page);
  await expect(drawer(page).getByLabel("Theme", { exact: true })).toContainText(THEME_NAME);

  expect(outbound, "the browser contacted the site itself").toEqual([]);
});

test("says why a refused address and a page with no colour gave no theme", async ({ page }) => {
  test.setTimeout(300_000);
  await openBuilder(page);
  await openDrawer(page);

  await derive(page, REFUSED_SITE);
  const refused = page.getByTestId("qcms-appearance-derive-error");
  await expect(refused).toBeVisible({ timeout: 60_000 });
  await expect(refused).toContainText("could not be read for a theme");
  await expect(page.getByTestId("qcms-appearance-derive-values")).toHaveCount(0);
  await axeClean(page, "the drawer after a refused address");

  await derive(page, NO_COLOUR_SITE);
  await expect(page.getByTestId("qcms-appearance-derive-error")).toContainText(
    "declares no colour a theme could start from",
    { timeout: 60_000 },
  );
  await expect(page.getByTestId("qcms-appearance-derive-values")).toHaveCount(0);
});

test("the drawer offers no derive on a locked workspace", async ({ page }) => {
  test.setTimeout(300_000);
  await openBuilder(page);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings`);
  await waitForHydration(page);
  await lock(page).click();
  await expect(page.getByText("Appearance is locked for this workspace.")).toBeVisible();

  await page.goto(`/forms/${formId}/build`);
  await waitForHydration(page);
  await openDrawer(page);
  const reason = page.getByTestId("qcms-appearance-locked");
  const reasonId = (await reason.getAttribute("id")) ?? "";
  const address = drawer(page).getByLabel("Website address");
  await expect(address).toBeDisabled();
  await expect(address).toHaveAttribute("aria-describedby", new RegExp(reasonId, "u"));
  await expect(drawer(page).getByRole("button", { name: "Get theme" })).toBeDisabled();

  await page.goto(`/workspaces/${WORKSPACE_ID}/settings`);
  await waitForHydration(page);
  await lock(page).click();
  await expect(page.getByText("Appearance is unlocked for this workspace.")).toBeVisible();
});
