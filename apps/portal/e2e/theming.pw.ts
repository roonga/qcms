import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

import { MODE_COOKIE } from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, startAnonymousFlow } from "./support/flow.js";
import { expect, test } from "./support/gates.js";
import { HARNESS_CORNERS, HARNESS_THEME, PORTAL_PORT } from "./support/harness-config.js";
import { KS, startKitchenSink } from "./support/kitchen-sink.js";
import { walkToCoverStep } from "./support/no-js.js";
import { starveScripts } from "./support/script-starve.js";

/** The four corner presets and the `--radius-control` / `--radius-card` they set. */
const CORNER_PRESETS = [
  { name: "subtle", rootClass: "", control: "6px", card: "10px" },
  { name: "sharp", rootClass: "radius-sharp", control: "0px", card: "0px" },
  { name: "rounded", rootClass: "radius-rounded", control: "10px", card: "16px" },
  { name: "pill", rootClass: "radius-pill", control: "999px", card: "20px" },
] as const;

const THEMES = ["slate", "harbor", "sand", "plum"] as const;
const MODES = ["light", "dark", "hc"] as const;

/** The origin the harness serves, for cookies seeded before a navigation. */
const ORIGIN = `http://localhost:${PORTAL_PORT}`;

/** Read one computed property off a locator. */
function computed(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/** Numeric pixel value of a computed property. */
async function px(target: Locator, property: string): Promise<number> {
  return Number.parseFloat(await computed(target, property));
}

/** Set the theme attribute and the mode / corners root classes on `<html>`. */
async function applyAppearance(
  page: Page,
  appearance: { theme?: string; mode?: string; corners?: string },
): Promise<void> {
  await page.evaluate((next) => {
    const root = document.documentElement;
    if (next.theme !== undefined) root.dataset.theme = next.theme;
    for (const mode of ["light", "dark", "hc"]) root.classList.remove(mode);
    for (const preset of ["radius-sharp", "radius-rounded", "radius-pill"]) {
      root.classList.remove(preset);
    }
    root.classList.add(next.mode ?? "light");
    if (next.corners !== undefined && next.corners !== "") root.classList.add(next.corners);
  }, appearance);
  await settleTransitions(page);
}

/** Run axe over the current page state; fail on any violation, prove it ran. */
async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
}

test("per-deployment selection: the configured theme and corner preset reach the page", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  const root = page.locator("html");

  await expect(root).toHaveAttribute("data-theme", HARNESS_THEME);
  await expect(root).toHaveClass(new RegExp(`\\bradius-${HARNESS_CORNERS}\\b`));

  const preset = CORNER_PRESETS.find((candidate) => candidate.name === HARNESS_CORNERS);
  expect(preset, `unknown harness corner preset ${HARNESS_CORNERS}`).toBeDefined();
  await expect(page.getByTestId("step-card")).toHaveCSS("border-radius", preset!.card);

  const primary = await root.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--color-primary").trim(),
  );
  expect(primary).toBe("#1f5eb8");
  await applyAppearance(page, { theme: "slate", corners: "" });
  const slatePrimary = await root.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--color-primary").trim(),
  );
  expect(slatePrimary).toBe("#2c6e63");
});

test("the pre-paint bootstrap accepts every mode and rejects anything else", async ({ page }) => {
  const { slug } = readFixtures();
  const root = page.locator("html");

  for (const mode of MODES) {
    await page.goto(`/f/${slug}?mode=${mode}`);
    await expect(root).toHaveClass(new RegExp(`\\b${mode}\\b`));
  }

  await page.goto(`/f/${slug}?mode=sepia`);
  await expect(root).toHaveClass(/\blight\b/u);
  await expect(root).not.toHaveClass(/\bsepia\b/u);

  await page.context().addCookies([{ name: MODE_COOKIE, value: "hc", url: ORIGIN }]);
  await page.goto(`/f/${slug}?mode=sepia`);
  await expect(root).toHaveClass(/\bhc\b/u);
  await expect(root).not.toHaveClass(/\blight\b/u);
  await page.context().clearCookies();
});

test("radius presets apply across controls, the step card and a banner", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  await page.getByTestId("primary-action").click();
  const banner = page.getByTestId("error-summary");
  await expect(banner).toBeVisible();

  const input = page.getByRole("textbox", { name: KS.fullName });
  const dateBox = page.locator('[data-qcms-field] [role="group"]').first();
  const card = page.getByTestId("step-card");

  for (const preset of CORNER_PRESETS) {
    await applyAppearance(page, { mode: "light", corners: preset.rootClass });
    await expect(input, `${preset.name}: text control`).toHaveCSS("border-radius", preset.control);
    await expect(dateBox, `${preset.name}: date control box`).toHaveCSS(
      "border-radius",
      preset.control,
    );
    await expect(card, `${preset.name}: step card`).toHaveCSS("border-radius", preset.card);
    await expect(banner, `${preset.name}: error-summary banner`).toHaveCSS(
      "border-radius",
      preset.card,
    );
  }
});

test("vendored controls consume the spacing tokens", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  const input = page.getByRole("textbox", { name: KS.fullName });
  const field = page.locator("[data-qcms-field] > [data-rac]").first();
  const form = page
    .locator("form")
    .filter({ has: page.locator("[data-qcms-field]") })
    .first();
  const card = page.getByTestId("step-card");

  expect(await px(input, "min-height")).toBeCloseTo(44, 0);
  expect(await px(input, "padding-left")).toBeCloseTo(14.4, 0);
  expect(await px(input, "padding-right")).toBeCloseTo(14.4, 0);
  expect(await px(field, "row-gap")).toBeCloseTo(8, 0);
  expect(await px(form, "row-gap")).toBeCloseTo(32, 0);

  const phone = page.viewportSize();
  if (phone === null) throw new Error("the spacing spec needs a fixed viewport to resize from");
  expect(phone.width).toBeLessThan(640);
  expect(await px(card, "padding-top")).toBeCloseTo(20, 0);

  await page.setViewportSize({ width: 800, height: phone.height });
  expect(await px(card, "padding-top")).toBeCloseTo(36, 0);
  await page.setViewportSize(phone);
  expect(await px(card, "padding-top")).toBeCloseTo(20, 0);

  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.setProperty("--space-control-h", "60px");
    root.style.setProperty("--space-control-pad-x", "2rem");
    root.style.setProperty("--space-stack", "1.25rem");
    root.style.setProperty("--space-field-gap", "3em");
    root.style.setProperty("--space-section-pad", "1rem");
  });
  expect(await px(input, "min-height")).toBeCloseTo(60, 0);
  expect(await px(input, "padding-left")).toBeCloseTo(32, 0);
  expect(await px(field, "row-gap")).toBeCloseTo(20, 0);
  expect(await px(form, "row-gap")).toBeCloseTo(48, 0);
  expect(await px(card, "padding-top")).toBeCloseTo(16, 0);

  await page.evaluate(() =>
    document.documentElement.style.setProperty("--space-control-h", "36px"),
  );
  const box = await input.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
});

test("the WCAG 1.4.12 floors hold on rendered text", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  const body = page.locator("body");
  const bodySize = await px(body, "font-size");
  expect(bodySize).toBeGreaterThanOrEqual(16);
  expect(await px(body, "line-height")).toBeGreaterThanOrEqual(1.5 * bodySize);
  expect(await px(body, "letter-spacing")).toBeGreaterThanOrEqual(0.12 * bodySize);
  expect(await px(body, "word-spacing")).toBeGreaterThanOrEqual(0.16 * bodySize);

  const label = page.locator('label[for]:has-text("Full name")').first();
  expect(await px(label, "font-size")).toBeGreaterThanOrEqual(16);
  const hint = page.locator('[slot="description"]').first();
  const hintSize = await px(hint, "font-size");
  expect(hintSize).toBeGreaterThanOrEqual(14);
  expect(hintSize).toBeLessThan(bodySize);

  expect(
    await px(page.getByRole("textbox", { name: KS.fullName }), "font-size"),
  ).toBeGreaterThanOrEqual(16);
});

for (const theme of THEMES) {
  test(`theme ${theme} renders axe-clean in Light, Dark and High-contrast`, async ({ page }) => {
    const { slug } = readFixtures();
    await startAnonymousFlow(page, slug);
    for (const mode of MODES) {
      await applyAppearance(page, { theme, mode });
      await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
      await expectNoAxeViolations(page, `${theme} / ${mode} (flow)`);
    }
  });
}

test("every theme is axe-clean in High-contrast with the error summary showing", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  await page.getByTestId("primary-action").click();
  await expect(page.getByTestId("error-summary")).toBeVisible();
  for (const theme of THEMES) {
    await applyAppearance(page, { theme, mode: "hc" });
    await expectNoAxeViolations(page, `${theme} / hc (error summary)`);
  }
});

test("the High-contrast mode layer is heavier borders, flat surfaces and heavy focus", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  const input = page.getByRole("textbox", { name: KS.fullName });
  const card = page.getByTestId("step-card");

  await applyAppearance(page, { mode: "light" });
  expect(await px(input, "border-top-width")).toBeCloseTo(1, 0);
  expect(await computed(card, "box-shadow")).not.toBe("none");

  await applyAppearance(page, { mode: "hc" });
  expect(await px(input, "border-top-width")).toBeCloseTo(2, 0);
  expect(await computed(input, "border-top-color")).toBe("rgb(0, 0, 0)");
  expect(await computed(card, "box-shadow")).toBe("none");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  expect(await px(skip, "outline-width")).toBeCloseTo(3, 0);
  expect(await computed(page.locator("html"), "color-scheme")).toBe("light");
});

test("the no-JS date fallback's box consumes the same spacing tokens (issue #920)", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await page.goto(`/f/${kitchenSinkSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);

  const day = page.locator('[data-qcms-field] input[data-qcms-date-part="day"]');
  await expect(day).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this measures the hydrated render",
  ).toBeGreaterThan(0);

  expect(await px(day, "min-height")).toBeCloseTo(44, 0);
  expect(await px(day, "padding-left")).toBeCloseTo(14.4, 0);
  expect(await px(day, "padding-right")).toBeCloseTo(14.4, 0);

  const box = await day.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

  await page.evaluate(() => {
    document.documentElement.style.setProperty("--space-control-h", "60px");
    document.documentElement.style.setProperty("--space-control-pad-x", "2rem");
  });
  expect(await px(day, "min-height")).toBeCloseTo(60, 0);
  expect(await px(day, "padding-left")).toBeCloseTo(32, 0);
});

test("the no-JS number fallback's box consumes the same spacing tokens (issue #18)", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await walkToCoverStep(page, kitchenSinkSlug);

  const km = page.locator('[data-qcms-field] input[type="number"]');
  await expect(km).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this measures the hydrated render",
  ).toBeGreaterThan(0);

  expect(await px(km, "min-height")).toBeCloseTo(44, 0);
  expect(await px(km, "padding-left")).toBeCloseTo(14.4, 0);
  expect(await px(km, "padding-right")).toBeCloseTo(14.4, 0);

  const box = await km.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

  await page.evaluate(() => {
    document.documentElement.style.setProperty("--space-control-h", "60px");
    document.documentElement.style.setProperty("--space-control-pad-x", "2rem");
  });
  expect(await px(km, "min-height")).toBeCloseTo(60, 0);
  expect(await px(km, "padding-left")).toBeCloseTo(32, 0);
});

test("the no-JS single-choice select's box consumes the same spacing tokens (issue #988)", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await walkToCoverStep(page, kitchenSinkSlug);

  const bodyType = page.locator('[data-qcms-field] select[name="q_body_type"]');
  await expect(bodyType).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this measures the hydrated render",
  ).toBeGreaterThan(0);

  expect(await px(bodyType, "min-height")).toBeCloseTo(44, 0);
  expect(await px(bodyType, "padding-left")).toBeCloseTo(14.4, 0);
  expect(await px(bodyType, "padding-right")).toBeCloseTo(14.4, 0);

  const box = await bodyType.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);

  await page.evaluate(() => {
    document.documentElement.style.setProperty("--space-control-h", "60px");
    document.documentElement.style.setProperty("--space-control-pad-x", "2rem");
  });
  expect(await px(bodyType, "min-height")).toBeCloseTo(60, 0);
  expect(await px(bodyType, "padding-left")).toBeCloseTo(32, 0);
});
