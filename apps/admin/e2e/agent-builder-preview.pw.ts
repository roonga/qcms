import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { deriveAppearance } from "@roonga/qcms-core";

import { openDbHandle } from "../../api/e2e/support/admin-accounts.js";
import { readFixtures } from "../../portal/e2e/support/fixtures.js";
import { HARNESS_BRAND_LOGO, HARNESS_BRAND_NAME } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import { enrollNewAdmin, signInWithTotp } from "./support/flow.js";
import { addStep, chooseOption, createForm, pinQuestion, waitForSaved } from "./support/forms.js";
import { waitForHydration } from "./support/hydration.js";
import { confirmLifecycle, createDraft } from "./support/questions.js";

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("builder114");
const RUN = Date.now().toString(36);
const TEXT_SLUG = `e2e-preview-text-${RUN}`;
const CHOICE_SLUG = `e2e-preview-choice-${RUN}`;
const TEXT_ID = `q_${TEXT_SLUG.replaceAll("-", "_")}`;
const CHOICE_ID = `q_${CHOICE_SLUG.replaceAll("-", "_")}`;
const TEXT_LABEL = "E2E Long text question";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const APPEARANCE = {
  palettes: deriveAppearance({ primary: "#2a6f6a" }).palettes,
  logo: null,
  face: "merriweather",
  corners: "sharp",
  density: "spacious",
  textSize: 16,
  progress: "top-indicator",
  pageTint: false,
} as const;

let totpSecret = "";
let formId = "";

function surface(page: Page): Locator {
  return page.getByTestId("qcms-builder-device").getByTestId("qcms-preview-surface");
}

function token(target: Locator, name: string): Promise<string> {
  return target.evaluate(
    (element, property) => getComputedStyle(element).getPropertyValue(property).trim(),
    name,
  );
}

function layoutFact(page: Page): Promise<Record<string, unknown>> {
  return page
    .getByTestId("qcms-builder-preview-pane")
    .evaluate(
      (element) =>
        JSON.parse(element.getAttribute("data-qcms-layout-fact") ?? "{}") as Record<
          string,
          unknown
        >,
    );
}

async function setAppearance(appearance: object | null): Promise<void> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    await handle.query(`update form_drafts set appearance = $1::jsonb where form_id = $2`, [
      appearance === null ? null : JSON.stringify(appearance),
      formId,
    ]);
  } finally {
    await handle.close();
  }
}

async function openBuilder(page: Page): Promise<void> {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/forms/${formId}/build`);
  await waitForHydration(page);
  await expect(surface(page).getByText(TEXT_LABEL)).toBeVisible({ timeout: 30_000 });
}

async function axeClean(page: Page, where: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .options({ runOnly: { type: "tag", values: TAGS } })
    .analyze();
  expect(results.violations, `axe violations on ${where}`).toEqual([]);
}

function controls(page: Page): Locator {
  return page.getByRole("group", { name: "Preview controls" });
}

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("builds a two-question draft with an appearance", async ({ page }) => {
  test.setTimeout(300_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  await createDraft(page, TEXT_SLUG, "Long text");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");
  await createDraft(page, CHOICE_SLUG, "Single choice");
  await confirmLifecycle(page, /^Publish version 1$/, "Publish");

  formId = await createForm(page, `e2e-preview-${RUN}`, "Builder preview intake");
  await addStep(page, "About you");
  await pinQuestion(page, TEXT_ID, 1);
  await pinQuestion(page, CHOICE_ID, 1);
  await waitForSaved(page);
  await setAppearance(APPEARANCE);
});

test("device switch and rotate move the container across the portal's breakpoint", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openBuilder(page);
  const size = page.getByTestId("qcms-builder-preview-size");
  const frame = page.getByTestId("qcms-builder-device");

  await chooseOption(controls(page), "Device", "iPhone XR, 414 × 896");
  await expect(size).toHaveText("414 × 896");
  await expect(frame).toHaveAttribute("data-device", "phone");
  await expect.poll(() => token(surface(page), "--space-section-pad")).toBe("1.75rem");
  await expect.poll(async () => (await layoutFact(page))["orientation"]).toBe("portrait");

  await page.getByRole("button", { name: "Rotate" }).click();
  await expect(size).toHaveText("896 × 414");
  await expect.poll(() => token(surface(page), "--space-section-pad")).toBe("3rem");
  const rotated = await layoutFact(page);
  expect(rotated).toMatchObject({
    fact: "layout-report",
    formId,
    device: "phone",
    viewport: { width: 896, height: 414 },
    orientation: "landscape",
  });

  await chooseOption(controls(page), "Device", "Responsive");
  await expect(page.getByRole("button", { name: "Rotate" })).toBeDisabled();
});

test("the draft's appearance applies, and polarity and high contrast switch its palette", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await openBuilder(page);
  const carrier = surface(page);
  const light = page.getByRole("button", { name: "Light", exact: true });
  const dark = page.getByRole("button", { name: "Dark", exact: true });
  const contrast = page.getByRole("button", { name: "High contrast", exact: true });

  await expect(light).toHaveAttribute("aria-pressed", "true");
  await expect(carrier).toHaveClass(/\bradius-sharp\b/u);
  await expect(carrier).toHaveClass(/\bfont-merriweather\b/u);
  expect(await token(carrier, "--color-primary")).toBe(APPEARANCE.palettes.light.primary);
  await axeClean(page, "the builder preview, light");

  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");
  await expect(carrier).toHaveClass(/\bdark\b/u);
  expect(await token(carrier, "--color-primary")).toBe(APPEARANCE.palettes.dark.primary);
  await expect.poll(async () => (await layoutFact(page))["colorScheme"]).toBe("dark");
  await axeClean(page, "the builder preview, dark");

  await contrast.click();
  await expect(contrast).toHaveAttribute("aria-pressed", "true");
  await expect(carrier).toHaveClass(/\bhc\b/u);
  expect(await token(carrier, "--color-primary")).toBe(
    APPEARANCE.palettes.darkHighContrast.primary,
  );
  await expect.poll(async () => (await layoutFact(page))["highContrast"]).toBe(true);
  await axeClean(page, "the builder preview, dark high contrast");

  await light.click();
  expect(await token(carrier, "--color-primary")).toBe(
    APPEARANCE.palettes.lightHighContrast.primary,
  );
  await axeClean(page, "the builder preview, light high contrast");

  expect(await token(page.locator("html"), "--color-primary")).not.toBe(
    APPEARANCE.palettes.light.primary,
  );
});

test("Reset answers clears the preview", async ({ page }) => {
  test.setTimeout(300_000);
  await openBuilder(page);
  const answer = surface(page).getByRole("textbox", { name: TEXT_LABEL });
  await answer.fill("Something to forget");
  await expect(answer).toHaveValue("Something to forget");
  await page.getByRole("button", { name: "Reset answers" }).click();
  await expect(answer).toHaveValue("");
});

test("inspect selects a question, and the fact carries only its id", async ({ page }) => {
  test.setTimeout(300_000);
  await openBuilder(page);
  const inspect = page.getByRole("button", { name: "Inspect", exact: true });
  await inspect.click();
  await expect(inspect).toHaveAttribute("aria-pressed", "true");

  const radio = surface(page).getByRole("radio").first();
  await surface(page)
    .locator(`[data-qcms-question-id="${CHOICE_ID}"]`)
    .getByRole("radio")
    .first()
    .click({ force: true });
  await expect(radio).not.toBeChecked();

  const selection = page.getByTestId("qcms-builder-selection");
  await expect(selection).toBeVisible();
  await expect(selection).toContainText(CHOICE_ID);
  await expect(page.getByTestId("qcms-builder-selected-outline")).toBeVisible();
  const fact = JSON.parse((await selection.getAttribute("data-qcms-fact")) ?? "{}") as Record<
    string,
    unknown
  >;
  expect(Object.keys(fact).sort()).toEqual([
    "device",
    "fact",
    "formId",
    "questionId",
    "stepId",
    "viewport",
  ]);
  expect(fact).toMatchObject({ fact: "preview-selection", formId, questionId: CHOICE_ID });
  expect(JSON.stringify(fact)).not.toContain("E2E");
  await axeClean(page, "the builder preview, inspecting with a selection");

  await surface(page).getByRole("textbox", { name: TEXT_LABEL }).focus();
  await page.keyboard.press("Enter");
  await expect(selection).toContainText(TEXT_ID);

  await page.getByRole("button", { name: "Clear the selection" }).focus();
  await page.keyboard.press("Enter");
  await expect(selection).toHaveCount(0);
  await expect(page.getByTestId("qcms-builder-assistant-subject")).toBeFocused();
});

test("the portal header and step rail frame the step, as the portal shows them", async ({
  page,
}) => {
  test.setTimeout(300_000);
  try {
    await setAppearance(null);
    await openBuilder(page);
    const brand = surface(page).getByTestId("qcms-preview-brand");
    await expect(brand).toHaveText(HARNESS_BRAND_NAME);
    await expect(brand.locator("img")).toHaveAttribute("src", HARNESS_BRAND_LOGO);
    await expect(surface(page).getByTestId("qcms-preview-progress")).toHaveText("Step 1 of 1");

    await setAppearance({ ...APPEARANCE, progress: "side-rail" });
    await page.reload();
    await waitForHydration(page);
    await expect(surface(page).getByText(TEXT_LABEL)).toBeVisible({ timeout: 30_000 });
    await expect(brand).toHaveText(HARNESS_BRAND_NAME);
    await expect(brand.locator("img")).toHaveCount(0);
    await expect(surface(page).getByTestId("qcms-preview-progress")).toHaveCount(0);

    const rail = surface(page).getByTestId("qcms-preview-step-rail");
    const fold = surface(page).getByTestId("qcms-preview-step-rail-fold");
    await chooseOption(controls(page), "Device", "Rail edge, 1024 � 900");
    await expect(rail).toBeVisible();
    await expect(fold).toBeHidden();
    await expect(rail.locator('[aria-current="step"]')).toHaveText("About you");
    await expect(rail.getByRole("button", { name: TEXT_LABEL })).toBeVisible();
    await axeClean(page, "the builder preview with the side rail");

    await chooseOption(controls(page), "Device", "iPhone XR, 414 � 896");
    await expect(rail).toBeHidden();
    await expect(fold).toBeVisible();
    await expect(fold).toContainText("Step 1 of 1");
    await axeClean(page, "the builder preview with the folded rail");
  } finally {
    await setAppearance(APPEARANCE);
  }
});
