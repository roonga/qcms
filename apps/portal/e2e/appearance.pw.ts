/**
 * The respondent appearance controls and the brand mark, in a real browser. The unit
 * suites prove the resolution rules and the token values; none of them can prove what
 * this file exists for: that a choice survives a reload because the server read the
 * cookie, that a first visit defaults from the OS signals, that there is no flash
 * (sampled on the first frame the page could have painted rather than asserted on the
 * end state), that the selected chip is distinguishable without colour in a two-colour
 * palette, that every target clears WCAG 2.5.8's floor at compact on rendered boxes,
 * that the WCAG 1.4.12 floors hold at every font and density, that the brand comes from
 * config with no engine name left in the shell, and that all of it is axe-clean.
 */

import { writeFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";
import { FONT_REGISTRY, fontClass } from "@roonga/qcms-ui/fonts";

import { DENSITY_LEVELS, densityClass } from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import { startAnonymousFlow } from "./support/flow.js";
import { expect, test } from "./support/gates.js";
import { waitForHydration } from "./support/hydration.js";
import {
  APPEARANCE_FLOORS_PATH,
  APPEARANCE_METRICS_PATH,
  HARNESS_BRAND_LOGO,
  HARNESS_BRAND_NAME,
  PORTAL_PORT,
} from "./support/harness-config.js";
import { KS, startKitchenSink } from "./support/kitchen-sink.js";

const MODES = ["light", "dark", "hc"] as const;
type Mode = (typeof MODES)[number];

/** WCAG 2.5.8. */
const TARGET_SIZE_MINIMUM = 24;

const ORIGIN = `http://localhost:${PORTAL_PORT}`;

function computed(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

async function px(target: Locator, property: string): Promise<number> {
  return Number.parseFloat(await computed(target, property));
}

/** The truth about what is rendered. */
async function liveMode(page: Page): Promise<string | undefined> {
  return page.evaluate(
    (modes) => modes.find((mode) => document.documentElement.classList.contains(mode)),
    [...MODES],
  );
}

/**
 * The hydration wait is the helper. The flow page's progressive swap unmounts the
 * header's `<details>` and mounts a fresh one, so a `summary` click landing before the
 * swap opens an element about to be thrown away and the panel never appears. That is
 * silent at full speed and reproduces every run under a 6x CPU throttle.
 *
 * It is a wait rather than a longer timeout: on an already-hydrated page it resolves on
 * its first poll. `no-js-appearance.pw.ts` keeps a copy of this helper without the wait,
 * because with scripting off the marker is never stamped and the disclosure is a native
 * `<details>`.
 */
async function openAppearance(page: Page): Promise<void> {
  await waitForHydration(page);
  const disclosure = page.getByTestId("appearance");
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('[data-testid="appearance"] > summary').click();
  }
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(page.getByTestId("appearance-mode")).toBeVisible();
}

/** Addressed by value rather than position. */
function chip(page: Page, group: "mode" | "density", value: string): Locator {
  return page.locator(`[data-testid="appearance-${group}"] label[data-value="${value}"]`);
}

async function pickChip(page: Page, group: "mode" | "density", value: string): Promise<void> {
  await chip(page, group, value).click();
  await settleTransitions(page);
}

async function appearanceCookies(page: Page): Promise<Record<string, string>> {
  const jar = await page.context().cookies();
  return Object.fromEntries(
    jar.filter((entry) => entry.name.startsWith("qcms-")).map((entry) => [entry.name, entry.value]),
  );
}

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
}

/* ==========================================================================
   EXIT CRITERION 3 - the brand mark is config, and the literal is gone.
   ========================================================================== */

test("the brand mark and the document title come from config, with no QCMS literal left", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  await expect(page.getByTestId("brand-mark")).toHaveText(HARNESS_BRAND_NAME);
  await expect(page).toHaveTitle(HARNESS_BRAND_NAME);

  const logo = page.locator('[data-testid="brand-mark"] img');
  await expect(logo).toHaveAttribute("src", HARNESS_BRAND_LOGO);
  await expect(logo).toHaveAttribute("alt", "");
  expect(
    await logo.evaluate((element) => (element as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);

  const visible = await page.locator("body").innerText();
  expect(visible, "a QCMS brand literal is still rendered in the portal shell").not.toContain(
    "QCMS",
  );
  expect(await page.title()).not.toContain("QCMS");
});

/* ==========================================================================
   EXIT CRITERION 1 - the controls work, persist, and default from the OS.
   ========================================================================== */

test("each control switches its axis and the choice survives a reload", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);
  const root = page.locator("html");
  const input = page.getByRole("textbox", { name: KS.fullName });

  await openAppearance(page);

  await pickChip(page, "mode", "dark");
  await expect(root).toHaveClass(/\bdark\b/u);
  await pickChip(page, "mode", "hc");
  await expect(root).toHaveClass(/\bhc\b/u);
  await expect(root).not.toHaveClass(/\bdark\b/u);

  await page.getByTestId("appearance-font").selectOption("atkinson");
  await expect(root).toHaveClass(new RegExp(`\\b${fontClass("atkinson")}\\b`, "u"));
  expect(await computed(page.locator("body"), "font-family")).toContain("Atkinson Hyperlegible");

  expect(await px(input, "min-height")).toBeCloseTo(44, 0);
  await pickChip(page, "density", "compact");
  await expect(root).toHaveClass(/\bdensity-compact\b/u);
  expect(await px(input, "min-height")).toBeCloseTo(36, 0);

  expect(await appearanceCookies(page)).toEqual({
    "qcms-theme": "hc",
    "qcms-font": "atkinson",
    "qcms-density": "compact",
  });

  const served = await page.reload();
  const html = (await served?.text()) ?? "";
  expect(html).toMatch(/<html[^>]*\bclass="[^"]*\bhc\b/u);
  expect(html).toMatch(/<html[^>]*\bclass="[^"]*\bfont-atkinson\b/u);
  expect(html).toMatch(/<html[^>]*\bclass="[^"]*\bdensity-compact\b/u);

  await openAppearance(page);
  await expect(chip(page, "mode", "hc")).toHaveAttribute("data-selected", "true");
  await expect(chip(page, "density", "compact")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("appearance-font")).toHaveValue("atkinson");
});

test("a first visit defaults from prefers-color-scheme and prefers-contrast", async ({ page }) => {
  const { slug } = readFixtures();

  await page.emulateMedia({ colorScheme: "light", contrast: "no-preference" });
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("light");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("dark");

  await page.emulateMedia({ colorScheme: "dark", contrast: "more" });
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("hc");

  await page.emulateMedia({ colorScheme: "light", contrast: "more" });
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("hc");

  await page.context().addCookies([{ name: "qcms-theme", value: "light", url: ORIGIN }]);
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("light");
});

/* ==========================================================================
   EXIT CRITERION 1 - no flash. Proven on the first frame that could have painted.
   ========================================================================== */

interface Frame {
  readonly cls: string;
  readonly bg: string | null;
}

/**
 * The no-flash proof has to be a measurement rather than an assertion about the end
 * state, which is always right by the time a test looks. A `requestAnimationFrame`
 * callback runs immediately before that frame is painted, so the first sample carrying a
 * `<body>` is the earliest frame in which a background could have appeared at all: if it
 * already equals the settled colour, no other colour was ever on screen.
 */
async function recordFirstFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __qcmsFrames?: Frame[] };
    store.__qcmsFrames = [];
    const sample = (): void => {
      const frames = store.__qcmsFrames;
      if (frames === undefined || frames.length >= 6) return;
      const body = document.querySelector("body");
      frames.push({
        cls: document.documentElement.className,
        bg: body === null ? null : getComputedStyle(body).backgroundColor,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function readFrames(page: Page): Promise<readonly Frame[]> {
  return page.evaluate(() => (window as unknown as { __qcmsFrames: Frame[] }).__qcmsFrames);
}

/** Returns the frames so a failure can print them. */
async function expectNoFlash(page: Page, expectedMode: Mode, label: string): Promise<void> {
  await settleTransitions(page);
  const settledBackground = await computed(page.locator("body"), "background-color");
  const frames = await readFrames(page);
  expect(frames.length, `${label}: no frames were sampled`).toBeGreaterThan(0);

  for (const [index, frame] of frames.entries()) {
    const modes = MODES.filter((mode) => frame.cls.split(/\s+/u).includes(mode));
    expect(modes, `${label}: frame ${index} classes were "${frame.cls}"`).toEqual([expectedMode]);
  }

  const firstPainted = frames.find((frame) => frame.bg !== null);
  expect(firstPainted, `${label}: no sampled frame had a <body>`).toBeDefined();
  expect(
    firstPainted?.bg,
    `${label}: the first painted frame was ${String(firstPainted?.bg)} but the page settled at ` +
      `${settledBackground} - that difference IS the flash`,
  ).toBe(settledBackground);
}

test("a persisted choice paints with no flash, and so does an OS-derived default", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await recordFirstFrames(page);

  for (const mode of MODES) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "qcms-theme", value: mode, url: ORIGIN }]);
    await page.goto(`/f/${slug}`);
    await expectNoFlash(page, mode, `cookie=${mode}`);
  }

  await page.context().clearCookies();
  await page.emulateMedia({ colorScheme: "dark", contrast: "no-preference" });
  await page.goto(`/f/${slug}`);
  await expectNoFlash(page, "dark", "OS dark, no cookie");

  await page.emulateMedia({ colorScheme: "light", contrast: "more" });
  await page.goto(`/f/${slug}`);
  await expectNoFlash(page, "hc", "OS prefers-contrast: more, no cookie");
});

/* ==========================================================================
   EXIT CRITERION 1 - keyboard operation, and a selected state that is not colour.
   ========================================================================== */

test("the controls are operable from the keyboard alone", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await waitForHydration(page);
  const root = page.locator("html");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Tab");
  const summary = page.locator('[data-testid="appearance"] > summary');
  await expect(summary).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("appearance-mode")).toBeVisible();

  const light = page.locator('[data-testid="appearance-mode"] input[value="light"]');
  await light.press("ArrowRight");
  await settleTransitions(page);
  await expect(root).toHaveClass(/\bdark\b/u);
  await expect(chip(page, "mode", "dark")).toHaveAttribute("data-selected", "true");

  const comfortable = page.locator('[data-testid="appearance-density"] input[value="comfortable"]');
  await comfortable.press("ArrowRight");
  await settleTransitions(page);
  await expect(root).toHaveClass(/\bdensity-spacious\b/u);

  await page.getByTestId("appearance-font").selectOption("merriweather");
  await expect(root).toHaveClass(new RegExp(`\\b${fontClass("merriweather")}\\b`, "u"));
});

test("the selected chip is distinguishable without colour, including in High-contrast", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await openAppearance(page);

  for (const mode of MODES) {
    await pickChip(page, "mode", mode);
    await settleTransitions(page);

    for (const group of ["mode", "density"] as const) {
      const chips = page.locator(`[data-testid="appearance-${group}"] label[data-value]`);
      const flags = await chips.evaluateAll((labels) =>
        labels.map((label) => label.getAttribute("data-selected")),
      );
      expect(
        flags.filter((flag) => flag === "true"),
        `${mode}/${group}: chip selection flags were ${flags.join(",")}`,
      ).toHaveLength(1);

      const on = chips.nth(flags.indexOf("true"));
      const off = chips.nth(flags.indexOf("false"));

      const mark = await on.locator(".qcms-seg__mark").innerText();
      expect(mark.trim(), `${mode}/${group}: selected chip has no mark glyph`).not.toBe("");
      expect((await off.locator(".qcms-seg__mark").innerText()).trim()).toBe("");

      expect(await px(on, "font-weight"), `${mode}/${group}: weight`).toBeGreaterThan(
        await px(off, "font-weight"),
      );

      expect(await px(on, "border-top-width"), `${mode}/${group}: border`).toBeGreaterThan(
        await px(off, "border-top-width"),
      );
    }
  }
});

/* ==========================================================================
   EXIT CRITERION 2 - target size at Compact, and the 1.4.12 floors per density.
   ========================================================================== */

async function measureTargets(page: Page): Promise<{ name: string; w: number; h: number }[]> {
  const targets: { name: string; locator: Locator }[] = [
    { name: "appearance summary", locator: page.locator('[data-testid="appearance"] > summary') },
    { name: "font select", locator: page.getByTestId("appearance-font") },
    { name: "primary action", locator: page.getByTestId("primary-action") },
  ];
  for (const mode of MODES) {
    targets.push({ name: `mode chip ${mode}`, locator: chip(page, "mode", mode) });
  }
  for (const level of DENSITY_LEVELS) {
    targets.push({ name: `density chip ${level}`, locator: chip(page, "density", level) });
  }
  targets.push({
    name: "mode radio input",
    locator: page.locator('[data-testid="appearance-mode"] input[value="dark"]'),
  });
  targets.push({
    name: "form option row",
    locator: page.locator("[data-qcms-field] label[data-rac]").first(),
  });

  const measured: { name: string; w: number; h: number }[] = [];
  for (const target of targets) {
    const box = await target.locator.boundingBox();
    expect(box, `${target.name} has no box`).not.toBeNull();
    measured.push({ name: target.name, w: box?.width ?? 0, h: box?.height ?? 0 });
  }
  return measured;
}

test("every control target clears the WCAG 2.5.8 minimum at Compact", async ({
  page,
}, testInfo) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  await openAppearance(page);

  const table: string[] = [];
  for (const level of DENSITY_LEVELS) {
    await pickChip(page, "density", level);
    for (const target of await measureTargets(page)) {
      table.push(
        `${level.padEnd(12)} ${target.name.padEnd(22)} ${target.w.toFixed(1)} x ${target.h.toFixed(1)} px`,
      );
      expect(
        Math.min(target.w, target.h),
        `${level}: "${target.name}" is ${target.w.toFixed(1)}x${target.h.toFixed(1)}px, below the ` +
          `${TARGET_SIZE_MINIMUM}px WCAG 2.5.8 minimum`,
      ).toBeGreaterThanOrEqual(TARGET_SIZE_MINIMUM);
    }
  }
  const measured = `${table.join("\n")}\n`;
  await testInfo.attach("wcag-2.5.8-target-sizes-per-density.txt", {
    body: measured,
    contentType: "text/plain",
  });
  writeFileSync(APPEARANCE_METRICS_PATH, measured, "utf8");
});

interface Floors {
  readonly bodySize: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly wordSpacing: number;
  readonly labelSize: number;
  readonly hintSize: number;
}

/**
 * Batched into one round trip: this runs every density against the whole font registry,
 * and one `evaluate` per measurement would be six times the traffic for the same
 * numbers.
 */
async function measureFloors(page: Page): Promise<Floors> {
  return page.evaluate(() => {
    const value = (element: Element | null, property: string): number =>
      element === null
        ? Number.NaN
        : Number.parseFloat(getComputedStyle(element).getPropertyValue(property));
    const body = document.body;
    return {
      bodySize: value(body, "font-size"),
      lineHeight: value(body, "line-height"),
      letterSpacing: value(body, "letter-spacing"),
      wordSpacing: value(body, "word-spacing"),
      labelSize: value(document.querySelector("[data-qcms-field] label[for]"), "font-size"),
      hintSize: value(document.querySelector('[slot="description"]'), "font-size"),
    };
  });
}

function expectFloors(floors: Floors, label: string): void {
  expect(floors.bodySize, `${label}: body >= 16px`).toBeGreaterThanOrEqual(16);
  expect(floors.lineHeight, `${label}: line-height >= 1.5`).toBeGreaterThanOrEqual(
    1.5 * floors.bodySize,
  );
  expect(floors.letterSpacing, `${label}: letter-spacing >= 0.12em`).toBeGreaterThanOrEqual(
    0.12 * floors.bodySize,
  );
  expect(floors.wordSpacing, `${label}: word-spacing >= 0.16em`).toBeGreaterThanOrEqual(
    0.16 * floors.bodySize,
  );
  expect(floors.labelSize, `${label}: vendored label slot >= 16px`).toBeGreaterThanOrEqual(16);
  expect(floors.hintSize, `${label}: vendored hint slot >= 14px`).toBeGreaterThanOrEqual(14);
}

test("the WCAG 1.4.12 floors hold at every font AND every density", async ({ page }, testInfo) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  const fontKeys = FONT_REGISTRY.map((entry) => entry.key);
  const table: string[] = [];
  for (const level of DENSITY_LEVELS) {
    for (const key of fontKeys) {
      await page.evaluate(
        ({ nextFont, allFonts, nextDensity, allDensities }) => {
          const root = document.documentElement;
          for (const className of allFonts) root.classList.remove(className);
          root.classList.add(nextFont);
          for (const className of allDensities) root.classList.remove(className);
          if (nextDensity !== "") root.classList.add(nextDensity);
        },
        {
          nextFont: fontClass(key),
          allFonts: fontKeys.map((candidate) => fontClass(candidate)),
          nextDensity: densityClass(level),
          allDensities: DENSITY_LEVELS.map((candidate) => densityClass(candidate)).filter(
            (className) => className !== "",
          ),
        },
      );
      const floors = await measureFloors(page);
      expectFloors(floors, `${level} / ${key}`);
      table.push(
        `${level.padEnd(12)} ${key.padEnd(18)} body ${floors.bodySize}px  ` +
          `line-height ${floors.lineHeight}px  letter ${floors.letterSpacing}px  ` +
          `word ${floors.wordSpacing}px  label ${floors.labelSize}px  hint ${floors.hintSize}px`,
      );
    }
  }
  const measured = `${table.join("\n")}\n`;
  await testInfo.attach("wcag-1.4.12-floors-per-density-and-font.txt", {
    body: measured,
    contentType: "text/plain",
  });
  writeFileSync(APPEARANCE_FLOORS_PATH, measured, "utf8");
  expect(table).toHaveLength(DENSITY_LEVELS.length * fontKeys.length);
});

/* ==========================================================================
   EXIT CRITERION 4 - axe across the whole matrix, with the panel open.
   ========================================================================== */

test("the appearance panel is axe-clean in every mode x density", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);
  await openAppearance(page);

  for (const mode of MODES) {
    await pickChip(page, "mode", mode);
    for (const level of DENSITY_LEVELS) {
      await pickChip(page, "density", level);
      await expect(page.getByTestId("appearance-mode")).toBeVisible();
      await expectNoAxeViolations(page, `${mode} / ${level} (appearance panel open)`);
    }
  }
});

/* ==========================================================================
   The no-JS posture: a control that works without scripting is shown (issue #195).
   ========================================================================== */

test("without JavaScript the controls are shown, because they now work (issue #195)", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    const { slug } = readFixtures();
    await page.goto(`${ORIGIN}/f/${slug}`);

    await expect(page.getByTestId("brand-mark")).toHaveText(HARNESS_BRAND_NAME);
    await expect(page.locator("html")).toHaveClass(/\blight\b/u);

    await expect(page.getByTestId("appearance")).toBeVisible();
  } finally {
    await context.close();
  }
});
