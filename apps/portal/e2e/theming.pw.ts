/**
 * The token contract, measured in a real browser (task 051, exit criteria 1+2).
 *
 * `packages/ui/src/theme-tokens.test.ts` proves the VALUES (every theme x mode
 * pair's WCAG ratio, every 1.4.12 floor) by computing them from `theme.css`. What
 * that cannot prove is that the shipped CSS actually reaches the rendered
 * controls: the vendored a2-react-aria components carry literal Tailwind spacing
 * and radius utilities (ADR-22 keeps those files byte-for-byte upstream), and
 * `theme-components.css` is what re-points them at the tokens. So everything here
 * reads `getComputedStyle` off real elements:
 *
 *  - per-deployment selection: the harness runs the portal on a NON-default theme
 *    and corner preset via `QCMS_PORTAL_THEME` / `QCMS_PORTAL_CORNERS`, and the
 *    served page carries them;
 *  - the four corner presets change controls, the step card and a banner;
 *  - the spacing tokens drive control height, control padding, the label stack and
 *    the question-to-question gap;
 *  - the WCAG 1.4.12 floors hold on rendered text, not just in the token file;
 *  - every theme renders axe-clean in Light, Dark and High-contrast;
 *  - the HC mode layer really is heavier borders, flat surfaces, heavy focus.
 *
 * Mode and theme are switched here by setting the root class / attribute directly.
 * That is the whole selection surface in this slice by design: selection is
 * config-only, and the respondent-facing switcher is task 053.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, startAnonymousFlow } from "./support/flow.js";
import { expect, test } from "./support/gates.js";
import { HARNESS_CORNERS, HARNESS_THEME } from "./support/harness-config.js";
import { KS, startKitchenSink } from "./support/kitchen-sink.js";

/** The four corner presets and the `--radius-control` / `--radius-card` they set. */
const CORNER_PRESETS = [
  { name: "subtle", rootClass: "", control: "6px", card: "10px" },
  { name: "sharp", rootClass: "radius-sharp", control: "0px", card: "0px" },
  { name: "rounded", rootClass: "radius-rounded", control: "10px", card: "16px" },
  { name: "pill", rootClass: "radius-pill", control: "999px", card: "20px" },
] as const;

const THEMES = ["slate", "harbor", "sand", "plum"] as const;
const MODES = ["light", "dark", "hc"] as const;

/**
 * Wait for every running CSS transition to finish, which is load-bearing rather
 * than tidy. The controls and the shell buttons carry `transition-colors`, so
 * switching mode starts a 150ms colour animation, and a contrast check sampled
 * MID-TRANSITION reads blended colours that belong to no palette at all (axe
 * flagged `#909196 on #439084` at 1.2:1, neither of which is a token value, from
 * exactly this race). Settling the animations - rather than emulating reduced
 * motion - keeps the measurement on the real rendering path.
 */
async function settleTransitions(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => resolve(undefined));
    });
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

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

  // Config -> DOM. The harness deliberately configures a non-default pair, so a
  // regression that ignored the config could not pass by accident.
  await expect(root).toHaveAttribute("data-theme", HARNESS_THEME);
  await expect(root).toHaveClass(new RegExp(`\\bradius-${HARNESS_CORNERS}\\b`));

  // DOM -> computed style: the configured preset is what the card actually uses.
  const preset = CORNER_PRESETS.find((candidate) => candidate.name === HARNESS_CORNERS);
  expect(preset, `unknown harness corner preset ${HARNESS_CORNERS}`).toBeDefined();
  await expect(page.getByTestId("step-card")).toHaveCSS("border-radius", preset!.card);

  // The theme attribute really selects a palette: harbor's primary is its blue,
  // not the slate default's teal.
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

test("radius presets apply across controls, the step card and a banner", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  // Provoke the error-summary banner so all three surfaces are on screen at once
  // (both of this step's questions are required, ADR-28).
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

  // The shipped Comfortable values: --space-control-h 44px,
  // --space-control-pad-x 0.9rem, --space-stack 0.5rem, --space-field-gap 2em,
  // --space-section-pad 2.25rem.
  expect(await px(input, "min-height")).toBeCloseTo(44, 0);
  expect(await px(input, "padding-left")).toBeCloseTo(14.4, 0);
  expect(await px(input, "padding-right")).toBeCloseTo(14.4, 0);
  expect(await px(field, "row-gap")).toBeCloseTo(8, 0);
  expect(await px(form, "row-gap")).toBeCloseTo(32, 0);
  expect(await px(card, "padding-top")).toBeCloseTo(36, 0);

  // Now prove the TOKEN is what drives each of them, not a coincidence: move every
  // spacing token at the root and every measurement must follow. This is the
  // assertion that fails if theme-components.css stops reaching the vendored DOM
  // (task 053 swaps exactly these tokens for its density control).
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

  // Even at the smallest shipped control height the target clears WCAG 2.5.8.
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

  // The vendored label and hint slots: `text-sm` / `text-xs` would be 14px / 12px
  // without the token-driven scale, so these two assertions are the ones that fail
  // if the `@theme` bridge in theme-components.css ever stops being applied.
  const label = page.locator('label[for]:has-text("Full name")').first();
  expect(await px(label, "font-size")).toBeGreaterThanOrEqual(16);
  const hint = page.locator('[slot="description"]').first();
  const hintSize = await px(hint, "font-size");
  expect(hintSize).toBeGreaterThanOrEqual(14);
  expect(hintSize).toBeLessThan(bodySize);

  // Input text is never smaller than body text.
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

  // Light: the control's own 1px border and the card's shadow.
  await applyAppearance(page, { mode: "light" });
  expect(await px(input, "border-top-width")).toBeCloseTo(1, 0);
  expect(await computed(card, "box-shadow")).not.toBe("none");

  await applyAppearance(page, { mode: "hc" });
  // Heavy black borders: 2px, at --color-border-strong, which HC pins to #000.
  expect(await px(input, "border-top-width")).toBeCloseTo(2, 0);
  expect(await computed(input, "border-top-color")).toBe("rgb(0, 0, 0)");
  // Flat surfaces.
  expect(await computed(card, "box-shadow")).toBe("none");
  // Heavy focus indicator. Tab (a real keyboard interaction, so `:focus-visible`
  // definitely matches) lands on the skip link, the page's first focusable.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  expect(await px(skip, "outline-width")).toBeCloseTo(3, 0);
  // HC is not Dark: the UA is told to keep light form controls.
  expect(await computed(page.locator("html"), "color-scheme")).toBe("light");
});
