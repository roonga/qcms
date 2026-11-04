import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

import { HARNESS_THEME } from "../../portal/e2e/support/harness-config.js";
import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  appearanceTrigger,
  enrollNewAdmin,
  openAppearance,
  signInWithTotp,
} from "./support/flow.js";
import { chooseOption } from "./support/forms.js";
import { createDraft, openPanel } from "./support/questions.js";

// Measure descendant computed styles: carrier classes alone cannot prove that respondent tokens beat authoring styles.
// Portalled overlays escape the carrier; use descendant controls for the isolation check.

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("island");

let totpSecret = "";

const RUN = Date.now().toString(36);

const THEMES = {
  slate: { primary: "#2c6e63", background: "rgb(251, 252, 253)", text: "rgb(15, 23, 41)" },
  harbor: { primary: "#1f5eb8", background: "rgb(232, 238, 246)", text: "rgb(14, 22, 38)" },
  sand: { primary: "#a24e2c", background: "rgb(247, 241, 230)", text: "rgb(35, 26, 18)" },
  plum: { primary: "#6d28a8", background: "rgb(242, 236, 249)", text: "rgb(26, 18, 38)" },
} as const;

const HARBOR_BY_MODE = {
  light: { primary: "#1f5eb8", background: "rgb(232, 238, 246)" },
  dark: { primary: "#6fa8ff", background: "rgb(8, 17, 31)" },

  hc: { primary: "#0a3a8a", background: "rgb(255, 255, 255)" },
} as const;

const PLUM_DARK = { primary: "#c08cf0", background: "rgb(21, 10, 34)" } as const;

// Include geometry as well as colours: the authoring app also overrides respondent corner tokens.
const COBALT_LIGHT = { primary: "#2456c6", radiusControl: "4px" } as const;
const PORTAL_RADIUS_CONTROL = "6px";

const PORTAL_LABEL_WEIGHT = "500";

const TYPE_FLOORS = {
  fontSize: "16px",
  lineHeight: "24px",
  fontWeight: "400",
  letterSpacing: "1.92px",
  wordSpacing: "2.56px",

  fontFamily: "ui-sans-serif",
} as const;

const THEME_LABEL = "Preview theme";
const MODE_LABEL = "Preview mode";

const ADMIN_POLARITY = { dark: "Dark" } as const;

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

test("enrolls the account the rest of this file signs in with", async ({ page }) => {
  test.setTimeout(120_000);
  totpSecret = await enrollNewAdmin(page, EMAIL);
  expect(totpSecret).not.toBe("");
});

function island(page: Page): Locator {
  return page.getByTestId("qcms-preview-surface");
}

function token(target: Locator, name: string): Promise<string> {
  return target.evaluate(
    (element, property) => getComputedStyle(element).getPropertyValue(property).trim(),
    name,
  );
}

function computed(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

function typeScaleOf(target: Locator): Promise<Record<string, string>> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      wordSpacing: style.wordSpacing,
      fontFamily: style.fontFamily.split(",")[0]!.trim(),
    };
  });
}

// Use checkboxes as real carrier descendants; use a segmented date field for locale order.
async function openPreview(page: Page, name: string, typeLabel = "Multiple choice"): Promise<void> {
  await createDraft(page, `e2e-island-${name}-${RUN}`, typeLabel);

  await openPanel(page, "preview");
  await expect(island(page)).toBeVisible();
  await settleTransitions(page);
}

async function setIsland(page: Page, theme: string, mode: string): Promise<void> {
  const switcher = page.getByTestId("qcms-preview-switcher");
  await chooseOption(switcher, THEME_LABEL, theme);
  await chooseOption(switcher, MODE_LABEL, mode);
  await settleTransitions(page);
}

test("the island paints the deployment's configured theme before anything is touched", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "first-paint");

  expect(HARNESS_THEME).not.toBe("slate");
  const surface = island(page);
  await expect(surface).toHaveAttribute("data-theme", HARNESS_THEME);
  await expect(surface).toHaveClass(/\blight\b/);

  const expected = THEMES[HARNESS_THEME as keyof typeof THEMES];
  expect(await token(surface, "--color-primary")).toBe(expected.primary);
  expect(await computed(surface, "background-color")).toBe(expected.background);
  expect(await computed(surface, "color")).toBe(expected.text);

  expect(await token(surface, "--radius-control")).toBe(PORTAL_RADIUS_CONTROL);

  expect(await typeScaleOf(surface)).toEqual(TYPE_FLOORS);

  const control = surface.locator("[data-qcms-field]").first();
  await expect(control).toBeVisible();
  expect(await token(control, "--color-primary")).toBe(expected.primary);
  expect(await token(control, "--color-primary")).not.toBe(COBALT_LIGHT.primary);
  expect(await token(control, "--radius-control")).toBe(PORTAL_RADIUS_CONTROL);
  expect(await token(control, "--radius-control")).not.toBe(COBALT_LIGHT.radiusControl);

  // Read a vendored label: the authoring app's unlayered font-medium override can beat its utility class.
  // Carrier fontWeight alone cannot detect that descendant cascade leak.
  const label = surface.locator(".font-medium").first();
  await expect(label).toBeVisible();
  expect(await computed(label, "font-weight")).toBe(PORTAL_LABEL_WEIGHT);

  const root = page.locator("html");
  expect(await token(root, "--color-primary")).toBe(COBALT_LIGHT.primary);
  expect(await token(root, "--radius-control")).toBe(COBALT_LIGHT.radiusControl);
});

test("switching the island restyles the island only, in both directions", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "isolation");

  const surface = island(page);
  const topbar = page.locator(".qcms-topbar");
  const control = surface.locator("[data-qcms-field]").first();

  const topbarBefore = {
    background: await computed(topbar, "background-color"),
    color: await computed(topbar, "color"),
  };
  const islandBefore = {
    primary: await token(control, "--color-primary"),
    background: await computed(surface, "background-color"),
  };

  await setIsland(page, "Plum", "Dark");

  const islandAfter = {
    primary: await token(control, "--color-primary"),
    background: await computed(surface, "background-color"),
  };

  expect(islandAfter.primary).toBe(PLUM_DARK.primary);
  expect(islandAfter.background).toBe(PLUM_DARK.background);
  expect(islandAfter.primary).not.toBe(islandBefore.primary);
  expect(islandAfter.background).not.toBe(islandBefore.background);

  expect(await computed(topbar, "background-color")).toBe(topbarBefore.background);
  expect(await computed(topbar, "color")).toBe(topbarBefore.color);
  expect(await token(page.locator("html"), "--color-primary")).toBe(COBALT_LIGHT.primary);

  await openAppearance(page);
  await page
    .getByRole("radio", { name: ADMIN_POLARITY.dark, exact: true })
    .locator("xpath=ancestor::label[1]")
    .click();
  await expect(appearanceTrigger(page)).toHaveAccessibleName(`Appearance: ${ADMIN_POLARITY.dark}`);
  await page.keyboard.press("Escape");
  await settleTransitions(page);

  expect(await computed(topbar, "background-color")).not.toBe(topbarBefore.background);

  await expect(surface).toHaveAttribute("data-theme", "plum");
  await expect(surface).toHaveClass(/\bdark\b/);
  expect(await token(control, "--color-primary")).toBe(PLUM_DARK.primary);
  expect(await computed(surface, "background-color")).toBe(PLUM_DARK.background);
});

test("every predefined theme and every mode is selectable, high contrast included", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "matrix");

  const surface = island(page);

  for (const [key, values] of Object.entries(THEMES)) {
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    await setIsland(page, label, "Light");
    await expect(surface).toHaveAttribute("data-theme", key);
    expect(await token(surface, "--color-primary"), `${key} accent`).toBe(values.primary);
    expect(await computed(surface, "background-color"), `${key} background`).toBe(
      values.background,
    );
  }

  const MODE_LABELS = { light: "Light", dark: "Dark", hc: "High contrast" } as const;
  for (const [mode, values] of Object.entries(HARBOR_BY_MODE)) {
    await setIsland(page, "Harbor", MODE_LABELS[mode as keyof typeof MODE_LABELS]);
    expect(await token(surface, "--color-primary"), `harbor ${mode} accent`).toBe(values.primary);
    expect(await computed(surface, "background-color"), `harbor ${mode} background`).toBe(
      values.background,
    );
  }

  const box = surface.locator("label[data-rac] > div").first();
  await expect(box).toBeVisible();
  expect(await computed(box, "border-top-width")).toBe("2px");
  expect(await computed(box, "border-top-color")).toBe("rgb(0, 0, 0)");
});

test("a preview control still accepts input under a switched theme", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "interactive");

  await setIsland(page, "Harbor", "Dark");

  const surface = island(page);
  const yes = surface.getByRole("checkbox", { name: "Yes, always", exact: true });
  const no = surface.getByRole("checkbox", { name: "No, never", exact: true });
  await expect(yes).not.toBeChecked();

  await surface.getByText("Yes, always", { exact: true }).click();
  await expect(yes).toBeChecked();
  await surface.getByText("No, never", { exact: true }).click();
  await expect(no).toBeChecked();

  await expect(yes).toBeChecked();

  await expect(surface).toHaveAttribute("data-theme", "harbor");
  expect(await token(surface, "--color-primary")).toBe(HARBOR_BY_MODE.dark.primary);
});

test("the switcher is localized, keyboard-operable and shows focus", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "keyboard");

  const switcher = page.getByTestId("qcms-preview-switcher");

  const themePicker = switcher.getByRole("button", { name: new RegExp(`${THEME_LABEL}$`) });
  const modePicker = switcher.getByRole("button", { name: new RegExp(`${MODE_LABEL}$`) });
  await expect(themePicker).toBeVisible();
  await expect(modePicker).toBeVisible();

  // Acquire focus by Tab: Chromium's focus-visible heuristic may omit the ring after script-only focus.
  await themePicker.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(themePicker).toBeFocused();

  const indicator = await themePicker.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      ring: style.boxShadow,
    };
  });
  expect(
    (indicator.outlineStyle !== "none" && indicator.outlineWidth !== "0px") ||
      indicator.ring !== "none",
    `the focused switcher trigger draws an indicator (${JSON.stringify(indicator)})`,
  ).toBe(true);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  // End reaches the last option independently of which option React Aria focuses when the list opens.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await settleTransitions(page);

  const surface = island(page);
  await expect(surface).toHaveAttribute("data-theme", "plum");
  expect(await token(surface, "--color-primary")).toBe(THEMES.plum.primary);
});

// Leave QCMS_LOCALE unset to exercise the deployment default through segmented date-field ordering.
test("the island lays out a date field the way the declared locale does", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "locale", "Date");

  const surface = island(page);

  const segments = surface.locator("[data-type]");
  await expect(segments.first()).toBeVisible();
  expect(await segments.evaluateAll((nodes) => nodes.map((node) => node.dataset.type))).toEqual([
    "day",
    "literal",
    "month",
    "literal",
    "year",
  ]);

  await expect(surface.locator('[data-type="month"]')).toHaveText("mm");
  await expect(surface.locator('[data-type="day"]')).toHaveText("dd");
  await expect(surface.locator('[data-type="year"]')).toHaveText("yyyy");
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} [${violation.nodes
          .map((node) => `${node.target.join(" ")} - ${node.failureSummary ?? ""}`)
          .join(" | ")}]`,
    ),
    `axe violations with ${state}`,
  ).toEqual([]);
}

test("axe is green with the island and the chrome in opposite modes", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithTotp(page, EMAIL, totpSecret);
  await openPreview(page, "axe");

  await setIsland(page, "Harbor", "High contrast");
  await expectNoViolations(page, "the island in high contrast and the chrome in light");

  await setIsland(page, "Harbor", "Light");
  await openAppearance(page);
  await page
    .getByRole("switch", { name: /High contrast/u })
    .locator("xpath=ancestor::label[1]")
    .click();

  await expect(appearanceTrigger(page)).toHaveAccessibleName(/^Appearance: .*high contrast$/u);
  await page.keyboard.press("Escape");
  await settleTransitions(page);
  await expectNoViolations(page, "the island in light and the chrome in high contrast");
});
