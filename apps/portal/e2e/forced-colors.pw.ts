import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

import { MODE_COOKIE } from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { PORTAL_PORT } from "./support/harness-config.js";
import { waitForHydration } from "./support/hydration.js";
import {
  KS,
  answerNumber,
  backStep,
  checkOption,
  chooseRadio,
  continueStep,
  enterDate,
  fillText,
  startKitchenSink,
} from "./support/kitchen-sink.js";

const ORIGIN = `http://localhost:${PORTAL_PORT}`;

async function pinOrdinaryPalette(page: Page): Promise<void> {
  await page.context().addCookies([{ name: MODE_COOKIE, value: "light", url: ORIGIN }]);
}

/** So nothing measured came from `.hc`. */
async function expectOrdinaryPalette(page: Page): Promise<void> {
  const root = page.locator("html");
  await expect(root).toHaveClass(/\blight\b/u);
  await expect(
    root,
    "the page fell into High-contrast, so nothing below measures the media query",
  ).not.toHaveClass(/\bhc\b/u);
}

interface SystemPalette {
  readonly canvas: string;
  readonly canvasText: string;
  readonly highlight: string;
  readonly highlightText: string;
  readonly grayText: string;
}

async function resolveColors<const T extends readonly string[]>(
  page: Page,
  values: T,
): Promise<{ readonly [K in keyof T]: string }> {
  const resolved = await page.evaluate(
    (wanted) => {
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.position = "fixed";
      probe.style.inset = "auto";
      probe.style.width = "1px";
      probe.style.height = "1px";
      probe.style.pointerEvents = "none";
      document.documentElement.append(probe);
      const read = wanted.map((value) => {
        probe.style.backgroundColor = "";
        probe.style.backgroundColor = value;
        return getComputedStyle(probe).backgroundColor;
      });
      probe.remove();
      return read;
    },
    values as readonly string[],
  );
  return resolved as { readonly [K in keyof T]: string };
}

async function systemPalette(page: Page): Promise<SystemPalette> {
  const [canvas, canvasText, highlight, highlightText, grayText] = await resolveColors(page, [
    "Canvas",
    "CanvasText",
    "Highlight",
    "HighlightText",
    "GrayText",
  ]);
  return { canvas, canvasText, highlight, highlightText, grayText };
}

function computedOf(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/**
 * Without this, every other assertion in the test could pass against the ordinary theme:
 * `matchMedia` reporting the feature is not the palette being forced.
 */
async function expectForcedPaletteInEffect(page: Page): Promise<SystemPalette> {
  await settleTransitions(page);
  const matches = await page.evaluate(() => window.matchMedia("(forced-colors: active)").matches);
  expect(matches, "the page does not report forced-colors: active").toBe(true);
  const palette = await systemPalette(page);
  await expect(
    page.locator("body"),
    "the body background is not Canvas, so the forced palette is not actually applied",
  ).toHaveCSS("background-color", palette.canvas);
  return palette;
}

/**
 * The component count is what decides this, because reading the last number as an alpha
 * would call opaque black invisible and fail every assertion here for the opposite of
 * the right reason.
 */
function isInvisible(color: string): boolean {
  if (color === "transparent") return true;
  const channels = /^rgba?\(([^)]*)\)$/u.exec(color);
  if (channels === null) return false;
  const parts = (channels[1] ?? "").split(/[,/\s]+/u).filter((part) => part.length > 0);
  return parts.length >= 4 && Number.parseFloat(parts[3] ?? "1") === 0;
}

interface Boundary {
  readonly borderWidth: number;
  readonly borderStyle: string;
  readonly borderColor: string;
  readonly outlineWidth: number;
  readonly outlineStyle: string;
  readonly outlineColor: string;
}

function boundaryOf(target: Locator): Promise<Boundary> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    const widths = [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ].map((value) => Number.parseFloat(value));
    return {
      borderWidth: Math.max(...widths),
      borderStyle: style.borderTopStyle,
      borderColor: style.borderTopColor,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineStyle: style.outlineStyle,
      outlineColor: style.outlineColor,
    };
  });
}

/**
 * Which of a border and an outline encloses the control is the stylesheet's business;
 * that neither is painted is the bug.
 */
async function expectDrawnBoundary(target: Locator, label: string): Promise<void> {
  const box = await boundaryOf(target);
  const border = box.borderWidth > 0 && box.borderStyle !== "none" && !isInvisible(box.borderColor);
  const outline =
    box.outlineWidth > 0 && box.outlineStyle !== "none" && !isInvisible(box.outlineColor);
  expect(
    border || outline,
    `${label} draws no boundary under forced colours: ${JSON.stringify(box)}`,
  ).toBe(true);
}

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  await settleTransitions(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  test.info().annotations.push({
    type: "axe",
    description: `${label}: ${results.passes.length} rules passed, ${results.violations.length} violations`,
  });
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
}

async function openAppearance(page: Page): Promise<void> {
  await waitForHydration(page);
  const disclosure = page.getByTestId("appearance");
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('[data-testid="appearance"] > summary').click();
  }
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(page.getByTestId("appearance-mode")).toBeVisible();
}

/** Drive the kitchen-sink walk from step 1 into an answered step 2. */
async function walkToAnsweredStepTwo(page: Page, slug: string): Promise<void> {
  await startKitchenSink(page, slug);
  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await chooseRadio(page, "Yes");
  await answerNumber(page, "10");
  await checkOption(page, "Breakdown");
  await settleTransitions(page);
}

test("forced colours: every control type in the kitchen-sink walk keeps a drawn boundary", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await page.emulateMedia({ forcedColors: "active" });
  await pinOrdinaryPalette(page);
  await startKitchenSink(page, kitchenSinkSlug);
  await expectOrdinaryPalette(page);
  await expectForcedPaletteInEffect(page);

  await expectDrawnBoundary(page.getByRole("textbox", { name: KS.fullName }), "short text input");
  await expectDrawnBoundary(page.getByRole("group", { name: KS.dob }), "date field box");
  await expectDrawnBoundary(page.getByTestId("primary-action"), "primary action (Continue)");
  await expectDrawnBoundary(
    page.locator('[data-testid="appearance"] > summary'),
    "Appearance disclosure",
  );

  await openAppearance(page);
  await expectDrawnBoundary(
    page.locator('[data-testid="appearance-mode"] label').first(),
    "Appearance mode chip",
  );
  await expectDrawnBoundary(page.getByTestId("appearance-font"), "Appearance font select");
  await page.locator('[data-testid="appearance"] > summary').click();

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();

  await expectDrawnBoundary(
    page.locator('[data-qcms-field] label[data-rac]:has(input[type="radio"]) > div').first(),
    "radio indicator",
  );
  await expectDrawnBoundary(
    page.locator('[data-qcms-field] label[data-rac]:has(input[type="checkbox"]) > div').first(),
    "checkbox indicator",
  );
  await chooseRadio(page, "Yes");
  const numberBox = page.locator('[data-qcms-field] [role="group"]:has(> input)').first();
  await expect(numberBox, "the branch did not reveal the number follow-up").toBeVisible();
  await expectDrawnBoundary(numberBox, "number field box");

  await expectDrawnBoundary(page.getByTestId("back-action"), "secondary action (Back)");
});

test("forced colours: a focused control keeps both its edge and a painted focus ring", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await page.emulateMedia({ forcedColors: "active" });
  await pinOrdinaryPalette(page);
  await startKitchenSink(page, kitchenSinkSlug);
  await expectOrdinaryPalette(page);
  const palette = await expectForcedPaletteInEffect(page);

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  const skipBox = await boundaryOf(skip);
  expect(skipBox.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(skipBox.outlineStyle).not.toBe("none");
  expect(isInvisible(skipBox.outlineColor)).toBe(false);

  const input = page.getByRole("textbox", { name: KS.fullName });
  const resting = await boundaryOf(input);
  expect(resting.borderWidth, "the resting control has no border to keep").toBeGreaterThan(0);

  await input.focus();
  const focused = await boundaryOf(input);
  expect(
    focused.borderColor,
    "focusing changed the control's edge, so the ring was expected to replace it",
  ).toBe(resting.borderColor);
  expect(focused.borderWidth).toBe(resting.borderWidth);
  expect(focused.outlineWidth, "the focus ring is not painted").toBeGreaterThanOrEqual(2);
  expect(focused.outlineStyle).not.toBe("none");
  expect(isInvisible(focused.outlineColor)).toBe(false);
  expect(focused.outlineColor).toBe(palette.highlight);
  await expect(input).toHaveCSS("box-shadow", "none");
});

test("forced colours: selected, checked and chosen states survive the palette", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await page.emulateMedia({ forcedColors: "active" });
  await pinOrdinaryPalette(page);
  await walkToAnsweredStepTwo(page, kitchenSinkSlug);
  await expectOrdinaryPalette(page);
  const palette = await expectForcedPaletteInEffect(page);

  const dot = page.locator(
    '[data-qcms-field] label[data-rac]:has(input[type="radio"]) > div > div',
  );
  await expect(dot, "a chosen radio should render exactly one dot").toHaveCount(1);
  await expect(dot).toHaveCSS("background-color", palette.canvasText);
  expect(palette.canvasText).not.toBe(palette.canvas);

  const tick = page
    .locator('[data-qcms-field] label[data-rac]:has(input[type="checkbox"]) svg')
    .first();
  await expect(tick).toBeVisible();
  await expect(tick).toHaveCSS("color", palette.canvasText);

  await backStep(page);
  const month = page
    .getByRole("group", { name: KS.dob })
    .getByRole("spinbutton", { name: /month/iu });
  await month.click();
  await expect(month).toHaveAttribute("data-focused", /.*/u);
  await expect(month).toHaveCSS("background-color", palette.highlight);
  await expect(month).toHaveCSS("color", palette.highlightText);

  await openAppearance(page);
  const selectedChip = page.locator('[data-testid="appearance-mode"] label[data-selected="true"]');
  await expect(selectedChip).toHaveCount(1);
  await expect(selectedChip).toHaveCSS("background-color", palette.highlight);
  await expect(selectedChip).toHaveCSS("color", palette.highlightText);
  expect(palette.highlight).not.toBe(palette.canvas);
});

test("forced colours: the kitchen-sink walk is axe-clean", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await page.emulateMedia({ forcedColors: "active" });
  await pinOrdinaryPalette(page);
  await startKitchenSink(page, kitchenSinkSlug);
  await expectOrdinaryPalette(page);
  await expectForcedPaletteInEffect(page);
  await expectNoAxeViolations(page, "forced colours, kitchen-sink step 1");

  await fillText(page, KS.fullName, "Ada Lovelace");
  await enterDate(page, "05171990");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Driving history" })).toBeVisible();
  await chooseRadio(page, "Yes");
  await answerNumber(page, "10");
  await checkOption(page, "Breakdown");
  await expectNoAxeViolations(page, "forced colours, kitchen-sink step 2 answered");

  await openAppearance(page);
  await expectNoAxeViolations(page, "forced colours, Appearance panel open");
});

test("prefers-contrast: more steps borders and focus rings onto the stronger token", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await page.emulateMedia({ contrast: "more" });
  await pinOrdinaryPalette(page);
  await startKitchenSink(page, kitchenSinkSlug);
  await expectOrdinaryPalette(page);
  expect(await page.evaluate(() => window.matchMedia("(prefers-contrast: more)").matches)).toBe(
    true,
  );

  const [border, borderStrong] = await resolveColors(page, [
    "var(--color-border)",
    "var(--color-border-strong)",
  ]);
  expect(borderStrong, "the two halves of the border pair must differ").not.toBe(border);

  const input = page.getByRole("textbox", { name: KS.fullName });
  await expect(input, "the control edge should take the stronger half").toHaveCSS(
    "border-top-color",
    borderStrong,
  );
  await expect(page.getByRole("group", { name: KS.dob })).toHaveCSS(
    "border-top-color",
    borderStrong,
  );

  await openAppearance(page);
  const restingChip = page
    .locator('[data-testid="appearance-mode"] label[data-selected="false"]')
    .first();
  await expect(restingChip).toHaveCSS("border-top-color", borderStrong);
  const chosenChip = page.locator('[data-testid="appearance-mode"] label[data-selected="true"]');
  await expect(
    chosenChip,
    "the chosen chip should keep its primary edge, not take the neutral step-up",
  ).not.toHaveCSS("border-top-color", borderStrong);
  await page.locator('[data-testid="appearance"] > summary').click();

  await input.focus();
  const focused = await boundaryOf(input);
  expect(focused.outlineWidth).toBeCloseTo(3, 0);
  expect(isInvisible(focused.outlineColor)).toBe(false);
});

test("forced colours: a disabled option row reads as the platform's disabled", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await page.emulateMedia({ forcedColors: "active" });
  await pinOrdinaryPalette(page);
  await walkToAnsweredStepTwo(page, kitchenSinkSlug);
  await expectOrdinaryPalette(page);
  const palette = await expectForcedPaletteInEffect(page);

  const row = page.locator('[data-qcms-field] label[data-rac]:has(input[type="checkbox"])').first();
  const indicator = row.locator("> div");
  const enabled = await computedOf(indicator, "border-top-color");
  expect(enabled, "the enabled indicator should be drawn in the palette's text colour").toBe(
    palette.canvasText,
  );

  await row.evaluate((element) => element.setAttribute("data-disabled", "true"));
  await expect(indicator).toHaveCSS("border-top-color", palette.grayText);
  await expect(row).toHaveCSS("color", palette.grayText);
  expect(palette.grayText).not.toBe(palette.canvasText);
});

test("prefers-contrast: more reaches the option indicators, and spares a chosen one", async ({
  page,
}) => {
  const { kitchenSinkSlug } = readFixtures();
  await page.emulateMedia({ contrast: "more" });
  await pinOrdinaryPalette(page);
  await walkToAnsweredStepTwo(page, kitchenSinkSlug);
  await expectOrdinaryPalette(page);

  const [border, borderStrong, primary] = await resolveColors(page, [
    "var(--color-border)",
    "var(--color-border-strong)",
    "var(--color-primary)",
  ]);

  const unchosen = (type: string) =>
    page
      .locator(`[data-qcms-field] label[data-rac]:has(input[type="${type}"]):not([data-selected])`)
      .first()
      .locator("> div");
  for (const type of ["checkbox", "radio"]) {
    const edge = unchosen(type);
    await expect(edge, `the unchosen ${type} indicator should step up`).toHaveCSS(
      "border-top-color",
      borderStrong,
    );
    expect(borderStrong, "the step-up must actually move the colour").not.toBe(border);
  }

  const chosen = (type: string) =>
    page
      .locator(`[data-qcms-field] label[data-rac][data-selected]:has(input[type="${type}"])`)
      .first()
      .locator("> div");
  for (const type of ["checkbox", "radio"]) {
    const edge = chosen(type);
    await expect(edge, `the chosen ${type} indicator should keep its own edge`).toHaveCSS(
      "border-top-color",
      primary,
    );
  }
});
