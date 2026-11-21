import { Buffer } from "node:buffer";

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { deriveAppearance } from "@roonga/qcms-core";

import { openDbHandle } from "../../api/e2e/support/admin-accounts.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, createForm, pinQuestion, waitForSaved } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

test.describe.configure({ mode: "serial" });

const WORKSPACE_ID = "org_default_workspace";
const EMAIL = uniqueAdminEmail("appearance116");
const ADMIN_ONLY_EMAIL = uniqueAdminEmail("appearance116admin");
const RUN = Date.now().toString(36);
const TEXT_SLUG = `e2e-appearance-text-${RUN}`;
const TEXT_ID = `q_${TEXT_SLUG.replaceAll("-", "_")}`;
const TEXT_LABEL = "E2E Long text question";
const THEME_NAME = `Clinical blue ${RUN}`;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/* A one-pixel PNG, so the upload exercises the sniff and the re-encode without a fixture file. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let totpSecret = "";
let formId = "";

function surface(page: Page): Locator {
  return page.getByTestId("qcms-builder-device").getByTestId("qcms-preview-surface");
}

function drawer(page: Page): Locator {
  return page.getByTestId("qcms-appearance-drawer");
}

function token(target: Locator, name: string): Promise<string> {
  return target.evaluate(
    (element, property) => getComputedStyle(element).getPropertyValue(property).trim(),
    name,
  );
}

async function withDb<T>(run: (query: ReturnType<typeof openDbHandle>) => Promise<T>): Promise<T> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    return await run(handle);
  } finally {
    await handle.close();
  }
}

async function setLock(locked: boolean): Promise<void> {
  await withDb(async (handle) => {
    await handle.query(`update organization set "appearanceLocked" = $2 where id = $1`, [
      WORKSPACE_ID,
      locked,
    ]);
  });
}

async function seedTheme(): Promise<void> {
  const palettes = deriveAppearance({ primary: "#1f5eb8" }).palettes;
  await withDb(async (handle) => {
    await handle.query(
      `insert into control.workspace_themes
         (workspace_id, name, palettes, face, corners, page_tint, logo_key, source_host)
       values ($1, $2, $3::jsonb, 'system', 'subtle', false, null, null)
       on conflict do nothing`,
      [WORKSPACE_ID, THEME_NAME, JSON.stringify(palettes)],
    );
  });
}

async function openBuilder(page: Page, email: string, secret: string): Promise<void> {
  await signInWithTotp(page, email, secret);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/forms/${formId}/build`);
  await waitForHydration(page);
  await expect(surface(page).getByText(TEXT_LABEL)).toBeVisible({ timeout: 30_000 });
}

async function openDrawer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(drawer(page)).toBeVisible();
}

async function chooseTheme(page: Page, name: string): Promise<void> {
  await drawer(page).getByLabel("Theme", { exact: true }).selectOption({ label: name });
}

async function axeClean(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS } })
    .analyze();
  expect(results.violations, `axe violations on ${where}`).toEqual([]);
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
  // A Workspace administrator who holds no Edit forms grant: the one caller who reaches
  // this screen and is refused its themes half.
  await createTestAdmin(ADMIN_ONLY_EMAIL, { grants: [], owner: true });
  await setLock(false);
});

test.afterAll(async () => {
  await setLock(false);
});

test("builds a draft the drawer can dress", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await createDraft(page, TEXT_SLUG, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  formId = await createForm(page, `e2e-appearance-${RUN}`, "Appearance intake");
  await addStep(page, "About you");
  await pinQuestion(page, TEXT_ID, 1);
  await waitForSaved(page);
});

test("a theme and a text size render at once and are kept by Done", async ({ page }) => {
  test.setTimeout(300_000);
  await openBuilder(page, EMAIL, totpSecret);
  await openDrawer(page);
  await axeClean(page, "the appearance drawer");

  const plum = deriveAppearance({ primary: "#6d28a8", secondary: "#5f5470" }).palettes;
  await chooseTheme(page, "Plum");
  await expect.poll(() => token(surface(page), "--color-primary")).toBe(plum.light.primary);

  await drawer(page).getByRole("button", { name: "Large", exact: true }).click();
  await expect(page.getByTestId("qcms-appearance-text-size")).toHaveValue("20");
  await drawer(page).getByRole("button", { name: "Spacious", exact: true }).click();
  await expect(surface(page)).toHaveClass(/\bdensity-spacious\b/u);

  await page.getByTestId("qcms-appearance-done").click();
  await expect(page.getByText("Appearance saved to the draft.")).toBeVisible();

  await page.reload();
  await waitForHydration(page);
  await expect.poll(() => token(surface(page), "--color-primary")).toBe(plum.light.primary);
  await openDrawer(page);
  await expect(page.getByTestId("qcms-appearance-text-size")).toHaveValue("20");
});

test("a locked workspace disables the drawer and attempts no save", async ({ page }) => {
  test.setTimeout(300_000);
  await setLock(true);
  const drafts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/draft")) drafts.push(request.url());
  });

  await openBuilder(page, EMAIL, totpSecret);
  await openDrawer(page);
  const reason = page.getByTestId("qcms-appearance-locked");
  await expect(reason).toContainText("A Workspace administrator can unlock it in Settings.");
  const reasonId = (await reason.getAttribute("id")) ?? "";
  const locked: Locator[] = [
    drawer(page).getByLabel("Theme", { exact: true }),
    drawer(page).getByLabel("Face", { exact: true }),
    drawer(page).getByRole("checkbox", { name: /Tint the page background/u }),
    page.getByTestId("qcms-appearance-text-size"),
    drawer(page).getByRole("button", { name: "Medium", exact: true }),
    drawer(page).getByRole("button", { name: "Spacious", exact: true }),
    drawer(page).getByRole("button", { name: "Rounded", exact: true }),
    drawer(page).getByRole("button", { name: "None", exact: true }),
  ];
  for (const control of locked) {
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute("aria-describedby", reasonId);
  }
  await expect(page.getByTestId("qcms-appearance-done")).toBeDisabled();
  expect(drafts, "a locked drawer sent a draft save").toEqual([]);
  await axeClean(page, "the locked appearance drawer");
  await setLock(false);
});

test("Settings renames a theme, takes a raster logo and deletes it", async ({ page }) => {
  test.setTimeout(300_000);
  await seedTheme();
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings`);
  await waitForHydration(page);

  const panel = page.getByTestId("qcms-workspace-appearance");
  await expect(panel).toBeVisible();
  await axeClean(page, "workspace settings with themes");

  const row = page.getByTestId("qcms-theme-row").filter({ hasText: THEME_NAME });
  await row.getByRole("button", { name: "Rename" }).click();
  const field = page.getByLabel("Theme name");
  await field.fill(`${THEME_NAME} renamed`);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText(`Renamed to ${THEME_NAME} renamed.`)).toBeVisible();

  const renamed = page.getByTestId("qcms-theme-row").filter({ hasText: `${THEME_NAME} renamed` });
  await renamed.getByTestId("qcms-theme-logo-input").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_BASE64, "base64"),
  });
  await expect(page.getByText("Logo saved to the theme.")).toBeVisible();
  await expect(renamed.getByText("Logo set")).toBeVisible();

  await renamed.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("qcms-theme-delete-confirm")).toContainText(
    "keep the look they copied",
  );
  await page.getByRole("button", { name: "Delete theme" }).click();
  await expect(page.getByText("Theme deleted.")).toBeVisible();
});

test("the lock is the administrator's and the themes are the Edit forms holder's", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await setLock(true);
  await enrollNewAdmin(page, ADMIN_ONLY_EMAIL);
  await page.goto(`/workspaces/${WORKSPACE_ID}/settings`);
  await waitForHydration(page);

  const lock = page.getByRole("switch", { name: /Lock appearance/u });
  await expect(lock).toBeEnabled();
  await expect(lock).toBeChecked();
  await expect(page.getByText("Needs Edit forms.")).toBeVisible();
  await expect(page.getByText("Themes are not available to you in this workspace.")).toBeVisible();
  await setLock(false);
});
