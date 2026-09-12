/**
 * The automatic, user-agent-driven contrast baseline (issue #28), measured in a
 * real browser.
 *
 * Two system settings, neither of them a respondent choice and neither of them
 * the operator's `.hc` mode:
 *
 * - **`forced-colors: active`** is Windows High Contrast Mode and its
 *   equivalents. The user agent replaces the palette outright: `color`,
 *   `background-color`, `border-color`, `outline-color`, `fill` and `stroke`
 *   are forced to system colours, and `box-shadow`, `text-shadow` and
 *   non-`url()` `background-image` are forced to `none`. An author declaration
 *   is honoured only where its value is a system-colour keyword.
 * - **`prefers-contrast: more`** leaves the palette alone and asks for more
 *   contrast inside it.
 *
 * WHY THIS SPEC HAS TO BE A BROWSER TEST
 * The defects it covers are invisible to a stylesheet reader and invisible to
 * `theme-tokens.test.ts`, because none of them is a token value. A Tailwind
 * `ring-*` is a `box-shadow`, so the vendored text controls' focus indicator is
 * deleted by forced colours rather than recoloured; those same controls set
 * `focus:border-transparent` on the assumption that the ring replaces the
 * border; and the radio's dot, the date segment being edited and the focused
 * listbox row are each a bare background fill, so forcing the fill to `Canvas`
 * erases the STATE and not only its colour. Every one of those reads as a
 * perfectly good stylesheet and as a control that has vanished.
 *
 * HOW THE ASSERTIONS AVOID BEING VACUOUS
 * Emulating the media feature is not the same as the palette actually being
 * forced, and a spec that only proved the former would pass against completely
 * unfixed CSS. So every forced-colours test first asserts that the page body's
 * background really is `Canvas` - the palette is in force, not merely queried -
 * and then compares each measurement against system colours resolved from the
 * live page rather than against literals, because the forced palette is the
 * user's and its values are not knowable up front.
 *
 * The contract this measures, and what a theme may and may not override under
 * forced colours, is documented in `docs/theming.md`. The CSS lives in two
 * places: `packages/ui/src/theme-components.css` for the component kit and
 * `apps/portal/app/globals.css` for the portal's own chrome.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

import { MODE_COOKIE } from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import { expect, test } from "./support/gates.js";
import { PORTAL_PORT } from "./support/harness-config.js";
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

/** The origin the harness serves, for the cookie seeded before a navigation. */
const ORIGIN = `http://localhost:${PORTAL_PORT}`;

/**
 * Pin the respondent's mode to Light before the first navigation, and prove it
 * stuck.
 *
 * This is what stops the whole spec from measuring the wrong thing. The portal's
 * pre-paint script defaults the mode from the OS when `QCMS_PORTAL_MODE` is
 * `auto`, and `prefers-contrast: more` is one of the signals it reads: emulate
 * that feature and the page can arrive already in `.hc`, whose mode layer sets
 * 2px `--color-border-strong` edges and a 3px ring of its own. Every assertion
 * below would then pass against a mode switch rather than against the media
 * query it is supposed to be testing. The `qcms-theme` cookie is the respondent's
 * own choice and outranks the OS signals, so seeding it holds the ordinary
 * palette in place and the two blocks under test are the only thing that can
 * move an edge.
 */
async function pinOrdinaryPalette(page: Page): Promise<void> {
  await page.context().addCookies([{ name: MODE_COOKIE, value: "light", url: ORIGIN }]);
}

/** The page is on the ordinary Light palette, so nothing measured came from `.hc`. */
async function expectOrdinaryPalette(page: Page): Promise<void> {
  const root = page.locator("html");
  await expect(root).toHaveClass(/\blight\b/u);
  await expect(
    root,
    "the page fell into High-contrast, so nothing below measures the media query",
  ).not.toHaveClass(/\bhc\b/u);
}

/** The system colours this spec compares against, resolved from the live page. */
interface SystemPalette {
  readonly canvas: string;
  readonly canvasText: string;
  readonly highlight: string;
  readonly highlightText: string;
  readonly grayText: string;
}

/**
 * Resolve colour keywords (or `var(--token)` references) against the page as it
 * is currently rendering.
 *
 * A probe element is used rather than a literal table because under forced
 * colours the palette belongs to the USER: `Canvas` is whatever they chose, and
 * the emulated palette Chromium supplies is its own. Resolving through
 * `background-color` also proves the value is one the engine honours here - an
 * unsupported keyword would come back as the initial `rgba(0, 0, 0, 0)` and fail
 * the assertion that uses it, rather than silently comparing two unknowns.
 */
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

/** The four system colours every forced-colours assertion below is written against. */
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

/** One computed property off one element. */
function computedOf(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/**
 * Assert the forced palette is really in force, not merely reported by
 * `matchMedia`. Without this every other assertion in the test could pass
 * against the ordinary theme.
 */
async function expectForcedPaletteInEffect(page: Page): Promise<SystemPalette> {
  // The vendored controls and the portal's chrome buttons carry `transition-colors`,
  // so any state change just before this starts a colour animation and an immediate
  // read samples a MID-TRANSITION value. Under forced colours that frame is not even
  // in the user's palette, which is how it first showed up: axe reported the primary
  // action at 1.44:1 on `#e4d3d3` while the settled colour was ButtonText. Same race
  // and same signature as issue #187; `settleTransitions` is the shared answer to it.
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
 * A colour draws nothing only when its ALPHA is zero.
 *
 * The component count is what decides that, and reading the last number instead
 * is the trap: `rgb(0, 0, 0)` is opaque black, and a pattern that took its final
 * channel as an alpha would call the forced palette's own text colour invisible
 * and fail every assertion in this file for the opposite of the right reason.
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

/** Read the widest drawn border plus the outline off one element. */
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
 * Every control must be enclosed by SOMETHING that is actually painted: a border
 * or an outline, of non-zero width, with a style that draws and a colour that is
 * not fully transparent. Which of the two carries it is the stylesheet's
 * business; that neither does is the bug.
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

/** Run axe over the current page state; fail on any violation, prove it ran. */
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

/** The header Appearance disclosure, opened. */
async function openAppearance(page: Page): Promise<void> {
  const disclosure = page.getByTestId("appearance");
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('[data-testid="appearance"] > summary').click();
  }
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

  // Step 1: the short-text control, the segmented date control's box, the
  // portal's own primary action, and the header disclosure.
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

  // Step 2 adds the boolean radio, the number field's box and the multi-choice
  // checkboxes: the remaining shapes the renderer draws a box around. (Step 3's
  // single choice is the same RadioGroup as the boolean, so it adds no shape.)
  await expectDrawnBoundary(
    page.locator('[data-qcms-field] label[data-rac]:has(input[type="radio"]) > div').first(),
    "radio indicator",
  );
  await expectDrawnBoundary(
    page.locator('[data-qcms-field] label[data-rac]:has(input[type="checkbox"]) > div').first(),
    "checkbox indicator",
  );
  // The number field is behind the boolean's branch, so it has to be revealed
  // before it can be measured: walking to step 2 without answering "Yes" leaves
  // the locator resolving to nothing, which is a timeout rather than a verdict.
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

  // The keyboard's first stop is the skip link: chrome, not a form control, and
  // it takes the same ring. Taken FIRST, because "the first Tab stop" is only
  // the skip link from the document's starting position - one Tab after focusing
  // a field lands on whatever follows that field.
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

  // A text input matches `:focus-visible` however focus arrived, so this is the
  // whole interaction. The vendored control answers focus with
  // `focus:border-transparent` plus `focus:ring-2`, and forced colours delete
  // every box-shadow: without the fix the edge is given up for an indicator that
  // was never painted, and the control disappears at the exact moment the
  // respondent is using it.
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
  // The ring is the platform's selection colour, not a theme colour the palette
  // would have flattened into the page.
  expect(focused.outlineColor).toBe(palette.highlight);
  // And the shadow the ring used to be really is gone, which is the reason the
  // outline has to exist.
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

  // THE RADIO. Its selected state is a filled dot with no border and no glyph,
  // so a forced fill of Canvas would leave selected and unselected identical.
  // Exactly one dot exists once one option is chosen, and it is painted in the
  // palette's text colour rather than in its background colour.
  const dot = page.locator(
    '[data-qcms-field] label[data-rac]:has(input[type="radio"]) > div > div',
  );
  await expect(dot, "a chosen radio should render exactly one dot").toHaveCount(1);
  await expect(dot).toHaveCSS("background-color", palette.canvasText);
  expect(palette.canvasText).not.toBe(palette.canvas);

  // THE CHECKBOX needs no rule of its own: its tick is an SVG drawn in
  // `currentColor`, which forces to CanvasText inside a Canvas box. Asserted
  // because "no rule needed" is a claim that can rot.
  const tick = page
    .locator('[data-qcms-field] label[data-rac]:has(input[type="checkbox"]) svg')
    .first();
  await expect(tick).toBeVisible();
  await expect(tick).toHaveCSS("color", palette.canvasText);

  // THE DATE SEGMENT being edited. Its highlight is a background fill on step 1,
  // so this walks back to reach it: `data-focused` is what the vendored style
  // keys on, and the pair has to be the platform's own selection pair.
  await backStep(page);
  const month = page
    .getByRole("group", { name: KS.dob })
    .getByRole("spinbutton", { name: /month/iu });
  await month.click();
  await expect(month).toHaveAttribute("data-focused", /.*/u);
  await expect(month).toHaveCSS("background-color", palette.highlight);
  await expect(month).toHaveCSS("color", palette.highlightText);

  // THE APPEARANCE CHIP. Its four selected signals are a check glyph, a heavier
  // weight, a heavier border and a fill; only the fill is lost, and it comes
  // back as the platform's own "chosen item" pair rather than as a theme colour.
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

  // The two halves of the authored pair, resolved from whichever theme the
  // harness is configured with rather than written down here.
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

  // An UNSELECTED chip: the selected one keeps `--color-primary` on its edge,
  // which is the selected treatment rather than a neutral border, and the
  // step-up rule is deliberately less specific than the rule that draws it.
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

  // The ring steps from 2px to the 3px the High-contrast mode already uses.
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

  // WHY THE ATTRIBUTE IS SET HERE RATHER THAN RENDERED.
  // Nothing in the compiled form renders a disabled control: neither
  // `packages/a2ui-compiler` nor `registry.tsx` ever passes `isDisabled`, so there
  // is no fixture that can produce one. What CAN be tested, and is what the review
  // at defd8754 found broken, is whether the rule matches the SHAPE react-aria
  // renders when it does mark a row disabled. `data-disabled` on the
  // `label[data-rac]` root is that shape, verbatim: `react-aria-components`
  // CheckboxButton and RadioButton both emit exactly this attribute, and the first
  // cut of the rule looked for it on the indicator child instead, where it never
  // appears. So this sets the attribute react-aria would set, on the real rendered
  // element, and measures the real sheet.
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

  // The review at defd8754 measured these two edges sitting at `--color-border`,
  // near 1.5:1, while every other control stepped to about 4.4:1. They are the
  // controls the step-up was most needed for.
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

  // And the chosen one keeps `--color-primary`, because there the edge colour IS
  // the selected state rather than chrome. Both a checkbox and a radio are already
  // chosen by the walk.
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
