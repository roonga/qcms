/**
 * The respondent appearance controls and the brand mark, in a real browser
 * (task 053, all four exit criteria).
 *
 * `lib/server/theme.test.ts` and `lib/appearance.test.ts` prove the resolution
 * rules; `packages/ui/src/theme-tokens.test.ts` proves the density token values and
 * their boundaries. None of that can prove the things this file exists for:
 *
 *  - the controls actually switch mode, font and density, and the choice SURVIVES a
 *    reload because the server read the cookie (exit criterion 1);
 *  - a first visit defaults from `prefers-color-scheme` and `prefers-contrast: more`
 *    (exit criterion 1);
 *  - there is NO FLASH - proven by sampling the first frame the page could have
 *    painted, not by asserting the end state (exit criterion 1);
 *  - the selected chip is distinguishable WITHOUT colour, checked in High-contrast
 *    where the palette has two colours in it (exit criterion 1);
 *  - every control target clears WCAG 2.5.8's 24px minimum at COMPACT, measured on
 *    rendered boxes (exit criterion 2);
 *  - the WCAG 1.4.12 floors hold at every font x every density (exit criterion 2);
 *  - the brand mark and the document title come from config, with no `QCMS` literal
 *    left in the rendered shell (exit criterion 3);
 *  - the whole thing is axe-clean in every mode x density, and the #147 browser
 *    console gate applies to all of it automatically (exit criterion 4).
 */

import { writeFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { settleTransitions } from "@qcms/e2e-support/animations";
import { FONT_REGISTRY, fontClass } from "@qcms/ui/fonts";

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

/** WCAG 2.5.8 Target Size (Minimum), AA in WCAG 2.2. */
const TARGET_SIZE_MINIMUM = 24;

/** The origin the harness serves, for cookies seeded before the first navigation. */
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

/** The mode class actually on `<html>`, which is the truth about what is rendered. */
async function liveMode(page: Page): Promise<string | undefined> {
  return page.evaluate(
    (modes) => modes.find((mode) => document.documentElement.classList.contains(mode)),
    [...MODES],
  );
}

/** The header disclosure, opened. Idempotent, so a test can call it after a reload. */
async function openAppearance(page: Page): Promise<void> {
  const disclosure = page.getByTestId("appearance");
  if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.locator('[data-testid="appearance"] > summary').click();
  }
  await expect(page.getByTestId("appearance-mode")).toBeVisible();
}

/** One chip of a segmented group, addressed by its value rather than its position. */
function chip(page: Page, group: "mode" | "density", value: string): Locator {
  return page.locator(`[data-testid="appearance-${group}"] label[data-value="${value}"]`);
}

/** Pick a chip the way a respondent does: click the visible chip. */
async function pickChip(page: Page, group: "mode" | "density", value: string): Promise<void> {
  await chip(page, group, value).click();
  await settleTransitions(page);
}

/** The cookies the controls wrote, as a name -> value map. */
async function appearanceCookies(page: Page): Promise<Record<string, string>> {
  const jar = await page.context().cookies();
  return Object.fromEntries(
    jar.filter((entry) => entry.name.startsWith("qcms-")).map((entry) => [entry.name, entry.value]),
  );
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

/* ==========================================================================
   EXIT CRITERION 3 - the brand mark is config, and the literal is gone.
   ========================================================================== */

test("the brand mark and the document title come from config, with no QCMS literal left", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  // The harness runs on a non-default brand on purpose, so a shell that had gone
  // back to a literal could not pass this by coincidence.
  await expect(page.getByTestId("brand-mark")).toHaveText(HARNESS_BRAND_NAME);
  await expect(page).toHaveTitle(HARNESS_BRAND_NAME);

  // The optional logo: a `data:` image the shipped CSP (`img-src 'self' data:`)
  // permits, decorative because the brand NAME carries the accessible meaning.
  const logo = page.locator('[data-testid="brand-mark"] img');
  await expect(logo).toHaveAttribute("src", HARNESS_BRAND_LOGO);
  await expect(logo).toHaveAttribute("alt", "");
  // A `data:` image that the CSP had blocked would decode to nothing.
  expect(
    await logo.evaluate((element) => (element as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);

  // Issue #25's actual requirement, stated as the respondent experiences it: the
  // engine's name appears nowhere on the page they were sent.
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

  // MODE. The class swap is immediate; the cookie is what the next server render
  // reads.
  await pickChip(page, "mode", "dark");
  await expect(root).toHaveClass(/\bdark\b/u);
  await pickChip(page, "mode", "hc");
  await expect(root).toHaveClass(/\bhc\b/u);
  await expect(root).not.toHaveClass(/\bdark\b/u);

  // FONT. The harness curates four families plus System; Atkinson Hyperlegible is
  // in the Accessibility group, which is the case that matters most here.
  await page.getByTestId("appearance-font").selectOption("atkinson");
  await expect(root).toHaveClass(new RegExp(`\\b${fontClass("atkinson")}\\b`, "u"));
  expect(await computed(page.locator("body"), "font-family")).toContain("Atkinson Hyperlegible");

  // DENSITY. Measured on a rendered control, not on the class: this is the
  // assertion that fails if the density blocks stop reaching the vendored DOM.
  expect(await px(input, "min-height")).toBeCloseTo(44, 0);
  await pickChip(page, "density", "compact");
  await expect(root).toHaveClass(/\bdensity-compact\b/u);
  expect(await px(input, "min-height")).toBeCloseTo(36, 0);

  // All three are persisted, under the documented cookie names.
  expect(await appearanceCookies(page)).toEqual({
    "qcms-theme": "hc",
    "qcms-font": "atkinson",
    "qcms-density": "compact",
  });

  // THE POINT OF THE COOKIES: the SERVER applies them, so the reloaded document is
  // already correct in its first byte rather than corrected afterwards.
  const served = await page.reload();
  const html = (await served?.text()) ?? "";
  expect(html).toMatch(/<html[^>]*\bclass="[^"]*\bhc\b/u);
  expect(html).toMatch(/<html[^>]*\bclass="[^"]*\bfont-atkinson\b/u);
  expect(html).toMatch(/<html[^>]*\bclass="[^"]*\bdensity-compact\b/u);
  // This line is the only browser evidence the density RESOLVER has, and that is worth
  // knowing rather than assuming (issue #196). Theme, corners, font and brand each reach a
  // browser from `QCMS_PORTAL_*` as well, because the harness runs them at a non-default
  // value; `QCMS_PORTAL_DENSITY` is deliberately unset, so the env leg of the same resolver
  // is proven only in `lib/server/theme.test.ts`. The reasoning, and the two shapes that
  // would close it, are in `support/harness-config.ts` beside the constants it is about.

  // ...and the controls agree with the page after the reload, so a respondent who
  // reopens the panel sees their own choices selected.
  await openAppearance(page);
  await expect(chip(page, "mode", "hc")).toHaveAttribute("data-selected", "true");
  await expect(chip(page, "density", "compact")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("appearance-font")).toHaveValue("atkinson");
});

test("a first visit defaults from prefers-color-scheme and prefers-contrast", async ({ page }) => {
  const { slug } = readFixtures();

  // The harness leaves `QCMS_PORTAL_MODE` unset, so the deployment default is
  // `auto`: exactly the config value that means "ask the OS".
  await page.emulateMedia({ colorScheme: "light", contrast: "no-preference" });
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("light");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("dark");

  // `prefers-contrast: more` selects High-contrast, and it OUTRANKS a dark colour
  // preference: a contrast preference is an accessibility need someone went into
  // their system settings to state, and honouring the weaker signal first would hand
  // them a dark theme instead of the contrast they asked for.
  await page.emulateMedia({ colorScheme: "dark", contrast: "more" });
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("hc");

  await page.emulateMedia({ colorScheme: "light", contrast: "more" });
  await page.goto(`/f/${slug}`);
  expect(await liveMode(page)).toBe("hc");

  // An explicit choice always beats the OS. This is the whole reason the control
  // exists: a respondent whose OS says one thing and who wants another gets what
  // they picked, on every subsequent request.
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
 * Record the class and the painted page background on each of the first few
 * animation frames.
 *
 * This is the no-flash proof and it has to be a measurement rather than an
 * assertion about the end state, which is always right by the time a test looks.
 * A `requestAnimationFrame` callback runs immediately BEFORE the browser paints
 * that frame, so the first sample with a `<body>` in it is the earliest frame in
 * which the page background could have appeared at all. If that colour already
 * equals the settled colour, then no other colour was ever on screen.
 *
 * The class is sampled from the very first frame too, including the frames before
 * `<body>` exists, because the pre-paint script runs synchronously in `<head>`
 * during parsing: by the time any frame is drawn, its correction has already
 * happened, and that is what a flash-free mode switch means.
 */
async function recordFirstFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __qcmsFrames?: Frame[] };
    store.__qcmsFrames = [];
    const sample = (): void => {
      const frames = store.__qcmsFrames;
      if (frames === undefined || frames.length >= 6) return;
      // `querySelector`, not `document.body`, purely for the TYPE: the DOM lib
      // declares `body` non-nullable, but during parsing it genuinely is not there
      // yet, and that early frame is exactly the one this sweep needs to record.
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

/**
 * Assert that the very first painted frame already carried the final appearance.
 * Returns the frames so a failure can print them.
 */
async function expectNoFlash(page: Page, expectedMode: Mode, label: string): Promise<void> {
  await settleTransitions(page);
  const settledBackground = await computed(page.locator("body"), "background-color");
  const frames = await readFrames(page);
  expect(frames.length, `${label}: no frames were sampled`).toBeGreaterThan(0);

  // Every frame, from the first, resolved to the mode under test: the pre-paint
  // script never left a wrong class on the root where a paint could see it.
  for (const [index, frame] of frames.entries()) {
    const modes = MODES.filter((mode) => frame.cls.split(/\s+/u).includes(mode));
    expect(modes, `${label}: frame ${index} classes were "${frame.cls}"`).toEqual([expectedMode]);
  }

  // The first frame that had a body is the first frame that could have painted the
  // page background, and its colour is already the final one.
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

  // The cookie path: the server stamped the class, so there is nothing to correct
  // and the first frame is already dark. Light is a real assertion here rather than
  // a trivial one - it is the value a broken swap would fall back to.
  for (const mode of MODES) {
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "qcms-theme", value: mode, url: ORIGIN }]);
    await page.goto(`/f/${slug}`);
    await expectNoFlash(page, mode, `cookie=${mode}`);
  }

  // The OS path: no cookie, so the SERVER stamped `light` (it cannot see a media
  // query) and the pre-paint script corrected it. This is the case a flash comes
  // from, and the sampled frames are what show it did not.
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
  // This test navigates itself rather than entering through a flow helper, so it is
  // the one place in the file that has to ask for hydration explicitly (issue #391).
  // Without it the Tab/Tab/Enter below toggles the NATIVE `<details>` before React
  // attaches, and React then hydrates against a DOM whose `open` attribute the
  // browser changed underneath it. That is the appearance panel's `open`-attribute
  // hydration mismatch, which the console-fault gate reds the run on; it needs the
  // un-hydrated window to be wide enough to Tab through, so it presents as a
  // load-dependent flake on mobile-chromium rather than as a failure.
  //
  // The PROBE is the panel's own summary, not the helper's default. The default
  // watches a step control, and this page is not a step: `/f/<slug>` is the entry
  // page and renders no `primary-action` at all, so the default hangs to the test
  // timeout instead of waiting for anything. The summary is the right node on its
  // own terms too - it is React-owned (`components/appearance-controls.tsx` is a
  // client component) and it is the exact element the keypresses below toggle.
  await waitForHydration(page, { probe: '[data-testid="appearance"] > summary' });
  const root = page.locator("html");

  // Reachable by Tab: the skip link is the page's first focusable, the appearance
  // disclosure is the second. Nothing before it in the header takes focus.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Tab");
  const summary = page.locator('[data-testid="appearance"] > summary');
  await expect(summary).toBeFocused();

  // Enter opens the disclosure: native `<summary>` behaviour, not a handler.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("appearance-mode")).toBeVisible();

  // Arrow keys move a native radio group's selection AND fire change, so the mode
  // applies without a click anywhere. Starting from Light, one step right is Dark.
  const light = page.locator('[data-testid="appearance-mode"] input[value="light"]');
  await light.press("ArrowRight");
  await settleTransitions(page);
  await expect(root).toHaveClass(/\bdark\b/u);
  await expect(chip(page, "mode", "dark")).toHaveAttribute("data-selected", "true");

  // The density group behaves the same way, and its own selection is independent.
  const comfortable = page.locator('[data-testid="appearance-density"] input[value="comfortable"]');
  await comfortable.press("ArrowRight");
  await settleTransitions(page);
  await expect(root).toHaveClass(/\bdensity-spacious\b/u);

  // The font select is a native control, so a keyboard user gets the platform's own
  // listbox; changing its value applies the font.
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
      // Exactly one chip is selected, which is what a radio group means.
      const flags = await chips.evaluateAll((labels) =>
        labels.map((label) => label.getAttribute("data-selected")),
      );
      expect(
        flags.filter((flag) => flag === "true"),
        `${mode}/${group}: chip selection flags were ${flags.join(",")}`,
      ).toHaveLength(1);

      const on = chips.nth(flags.indexOf("true"));
      const off = chips.nth(flags.indexOf("false"));

      // 1. TEXT: a check glyph the unselected chips do not have. This is the signal
      //    that survives any palette, including a two-colour one.
      const mark = await on.locator(".qcms-seg__mark").innerText();
      expect(mark.trim(), `${mode}/${group}: selected chip has no mark glyph`).not.toBe("");
      expect((await off.locator(".qcms-seg__mark").innerText()).trim()).toBe("");

      // 2. WEIGHT: the selected label is bolder.
      expect(await px(on, "font-weight"), `${mode}/${group}: weight`).toBeGreaterThan(
        await px(off, "font-weight"),
      );

      // 3. BORDER: the selected chip's edge is heavier. In HC both are already heavy
      //    (2px), so the selected one goes to 3px rather than collapsing the
      //    difference - which is exactly the mode where colour helps least.
      expect(await px(on, "border-top-width"), `${mode}/${group}: border`).toBeGreaterThan(
        await px(off, "border-top-width"),
      );
    }
  }
});

/* ==========================================================================
   EXIT CRITERION 2 - target size at Compact, and the 1.4.12 floors per density.
   ========================================================================== */

/** Every rendered box a respondent has to hit, at whatever density is in force. */
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
  // The radio INPUT, not only the chip: WCAG 2.5.8 measures the target, and the
  // input is what receives the pointer and the focus.
  targets.push({
    name: "mode radio input",
    locator: page.locator('[data-testid="appearance-mode"] input[value="dark"]'),
  });
  // An option row in the form itself - the target is the whole label row, whose
  // height at Compact is a 24px line box plus 2 x 6px of `--space-stack`.
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
  // The anonymous flow rather than the kitchen sink, because its first step is a
  // CHOICE question: the option row (a `label[data-rac]`, whose target is the whole
  // row and whose height is `--space-stack` above and below a line box) is the one
  // form target density can shrink, so it has to be on screen to be measured. The
  // vendored text control's height is asserted per density in the persistence test.
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
      // Compact is the level this criterion is actually about, but asserting all
      // three costs nothing and catches a Spacious value edited into the wrong block.
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
 * Every 1.4.12 floor in one round trip. Batched deliberately: this runs 3 densities
 * x the whole font registry, and one `evaluate` per measurement would be six times
 * the traffic for the same numbers.
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

  // Swap the two root classes directly rather than driving the controls: this sweep
  // is 69 combinations, only a handful of which a deployment even offers, and the
  // controls' own wire to these classes is proven by the tests above.
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
  // The claim docs/theming.md makes has numbers in it, so the numbers have to be
  // readable after a GREEN run, not only after a red one.
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
      // The panel stays open across every combination on purpose: a collapsed
      // `<details>` hides its contents from axe, so the controls themselves would
      // never be scanned.
      await expect(page.getByTestId("appearance-mode")).toBeVisible();
      await expectNoAxeViolations(page, `${mode} / ${level} (appearance panel open)`);
    }
  }
});

/* ==========================================================================
   The no-JS posture: a control that cannot work is not shown.
   ========================================================================== */

test("without JavaScript the controls are hidden and the configured default still applies", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    const { slug } = readFixtures();
    await page.goto(`${ORIGIN}/f/${slug}`);

    // The brand mark is server-rendered, so a no-JS respondent still gets a branded,
    // themed, readable page...
    await expect(page.getByTestId("brand-mark")).toHaveText(HARNESS_BRAND_NAME);
    await expect(page.locator("html")).toHaveClass(/\blight\b/u);

    // ...but not a radio they can move that changes nothing. The `<noscript>` rule in
    // `app/layout.tsx` hides the disclosure entirely.
    await expect(page.getByTestId("appearance")).toBeHidden();
  } finally {
    await context.close();
  }
});
