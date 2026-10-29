import type { Locator, Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  accountTrigger,
  appearanceTrigger,
  openAppearance,
  readSetupKey,
  signInWithTotp,
  submitSignIn,
  submitTotp,
} from "./support/flow.js";

/**
 * The QCMS app's appearance behaviour: polarity crossed with contrast.
 *
 * What is asserted here, and why each one is a browser test rather than a unit test:
 *
 *  - **Auto follows `prefers-color-scheme`, at both contrast levels.** That signal
 *    exists only in a real browser, and the mechanism carrying it is a pair of media
 *    blocks inside the token sheet - CSS no unit test can execute.
 *  - **High contrast is never inferred.** The interesting case is `prefers-contrast:
 *    more`, where the portal DOES switch to High contrast and this app deliberately
 *    does not. Only a browser can tell the two apps apart on that input.
 *  - **A choice persists and repaints with no flash.** The proof that the server
 *    stamped the classes rather than a script correcting them after load is a
 *    measurement of the first painted frames, which needs a compositor.
 *  - **The keyboard model.** A roving tabindex, Home and End, Escape returning focus to
 *    the trigger, and a Tab out of the panel closing it are all focus facts, and focus
 *    is the one thing jsdom reports differently from a browser.
 *  - **Inter and JetBrains Mono actually load.** A computed `font-family` proves the
 *    token; the `FontFace` status proves the file behind it was fetched and parsed
 *    rather than silently falling back to the system stack.
 *
 * NOTHING here hard-codes a colour. Every assertion reads the token the sheet resolved
 * and compares its luminance, so a future palette revision changes the numbers without
 * touching this file - and a palette that stopped switching at all still fails.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("appearance");

/** The classes the control owns, which is what a root-class read has to filter to. */
const CLASSES = ["light", "dark", "hc"] as const;

/**
 * The four states the sheet can paint, with the root classes an EXPLICIT polarity choice
 * stamps for each. Under Auto the polarity class is absent and the sheet's media blocks
 * paint the same four; the Auto test asserts that separately.
 */
const STATES = [
  { name: "light", classes: ["light"] as readonly string[], dark: false, high: false },
  { name: "dark", classes: ["dark"], dark: true, high: false },
  { name: "light high contrast", classes: ["light", "hc"], dark: false, high: true },
  { name: "dark high contrast", classes: ["dark", "hc"], dark: true, high: true },
] as const;
type State = (typeof STATES)[number];

/** Set by the first test, which walks the account through enrollment. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** The appearance classes present on the root element, in the sheet's own vocabulary. */
async function rootClasses(page: Page): Promise<string[]> {
  const className = await page.evaluate(() => document.documentElement.className);
  return CLASSES.filter((candidate) => className.split(/\s+/u).includes(candidate));
}

/**
 * The resolved value of a colour token, normalised to `rgb(...)` by the browser.
 *
 * Read through a probe element rather than from the custom property directly,
 * because `getPropertyValue` hands back the authored text (`#0b0f1a`) while
 * everything worth comparing it to is computed (`rgb(11, 15, 26)`). Setting the
 * probe's `color` and reading it back makes the browser do the conversion.
 */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((property) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${property})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}

/** WCAG relative luminance of an `rgb(...)` string, 0 (black) to 1 (white). */
function luminance(rgb: string): number {
  const parts =
    rgb
      .match(/\d+(?:\.\d+)?/gu)
      ?.slice(0, 3)
      .map(Number) ?? [];
  const channels = parts.map((value) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

/** The WCAG ratio between two `rgb(...)` strings. */
function ratio(a: string, b: string): number {
  const ordered = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((ordered[0] ?? 0) + 0.05) / ((ordered[1] ?? 0) + 0.05);
}

async function computed(locator: Locator, property: string): Promise<string> {
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/**
 * Assert the page is painted in `state`, from the tokens rather than from a list of
 * colours. Polarity is the field's luminance; contrast is the distance between the text
 * and the field, which is the only thing separating Light from light High contrast, plus
 * the pure extreme both high states take their text to.
 */
async function expectPalette(page: Page, state: State, label: string): Promise<void> {
  const backgroundToken = await token(page, "--color-background");
  const background = luminance(backgroundToken);
  const textToken = await token(page, "--color-text");
  const text = luminance(textToken);
  // The body actually wears the background token - the theme is applied, not just declared.
  expect(
    await computed(page.locator("body"), "background-color"),
    `${label}: body background`,
  ).toBe(backgroundToken);

  if (state.dark) {
    expect(background, `${label}: background should be dark`).toBeLessThan(0.1);
    expect(text, `${label}: text should be light`).toBeGreaterThan(0.5);
  } else {
    expect(background, `${label}: background should be light`).toBeGreaterThan(0.8);
    expect(text, `${label}: text should be dark`).toBeLessThan(0.1);
  }

  if (state.high) {
    // The high states are the only ones that take text all the way to an extreme, and
    // the only ones held to AAA.
    expect(text, `${label}: HC text is a pure extreme`).toBe(state.dark ? 1 : 0);
    expect(ratio(textToken, backgroundToken), `${label}: AAA body text`).toBeGreaterThanOrEqual(7);
    expect(
      ratio(await token(page, "--color-border-strong"), backgroundToken),
      `${label}: 3:1 edges`,
    ).toBeGreaterThanOrEqual(3);
  } else {
    expect(text, `${label}: a normal-contrast extreme would be the HC palette`).not.toBe(
      state.dark ? 1 : 0,
    );
  }
}

/**
 * A LENGTH token as it resolves on one element, trimmed.
 *
 * Custom properties compute to their authored text, so `--radius-modal` comes back as
 * `"8px"` (often with the leading space the declaration was written with) while
 * `border-radius` computes to `"8px"`. Trimming is the whole conversion; the colour
 * equivalent needs the probe element in `token` above, because a colour's authored text
 * (`#0b0f1a`) never matches its computed form.
 */
async function tokenLength(locator: Locator, property: string): Promise<string> {
  return (await computed(locator, property)).trim();
}

function polarity(page: Page, name: "Auto" | "Light" | "Dark"): Locator {
  return page.getByRole("radio", { name, exact: true });
}

/**
 * The painted control, which is what a pointer actually hits and what the styles are on:
 * react-aria renders the radio and the switch as visually hidden inputs inside a span
 * inside their labels, so a click aimed at the role is intercepted by the label.
 */
const painted = (control: Locator): Locator => control.locator("xpath=ancestor::label[1]");

function contrastSwitch(page: Page): Locator {
  return page.getByRole("switch", { name: /High contrast/u });
}

const panel = (page: Page): Locator => page.getByRole("dialog", { name: "Appearance" });

/**
 * Select a state the way an operator does: open the panel, press the two controls.
 *
 * Every step is the real control. Nothing here reaches for a class or pokes the root
 * element, because what is under test is whether the CONTROL applies the state - a test
 * that set the classes itself would pass with the control removed.
 */
async function choose(
  page: Page,
  options: { readonly polarity?: "Auto" | "Light" | "Dark"; readonly high?: boolean },
): Promise<void> {
  await openAppearance(page);
  if (options.polarity !== undefined) await painted(polarity(page, options.polarity)).click();
  if (options.high !== undefined) {
    const toggle = contrastSwitch(page);
    if ((await toggle.isChecked()) !== options.high) await painted(toggle).click();
  }
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
}

test("enrolls the account the shell tests sign in with", async ({ page }) => {
  await submitSignIn(page, EMAIL);
  await expect(page).toHaveURL(/\/two-factor\/enroll$/);
  totpSecret = await readSetupKey(page);
  await submitTotp(page, totpSecret);
  await expect(page).toHaveURL(/\/two-factor\/recovery-codes$/);
  await page.getByRole("button", { name: "I have saved these codes" }).click();
  await expect(page).toHaveURL(/\/questions$/);
});

test("with no choice made, the app follows prefers-color-scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", contrast: "no-preference" });
  await page.goto("/sign-in");
  // No class at all: Light is the sheet's bare `:root` block, and the absence is
  // what lets the media block take over when the machine prefers dark.
  expect(await rootClasses(page)).toEqual([]);
  await expectPalette(page, STATES[0], "OS prefers light");

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await rootClasses(page)).toEqual([]);
  await expectPalette(page, STATES[1], "OS prefers dark");

  // Nothing was persisted: an operator who has expressed no preference has no cookie.
  const cookies = await page.context().cookies();
  expect(cookies.map((c) => c.name)).not.toContain("qcms-app-mode");
});

test("high contrast is never inferred, whatever the machine asks for", async ({ page }) => {
  // The portal DOES resolve `prefers-contrast: more` to High contrast (task 053).
  // This app deliberately does not: HC changes far more than a palette, and the
  // operator chooses it or it does not happen.
  await page.emulateMedia({ colorScheme: "light", contrast: "more" });
  await page.goto("/sign-in");
  expect(await rootClasses(page), "prefers-contrast must not select HC").toEqual([]);
  await expectPalette(page, STATES[0], "OS prefers contrast, light");

  await page.emulateMedia({ colorScheme: "dark", contrast: "more" });
  expect(await rootClasses(page), "prefers-contrast must not select HC").toEqual([]);
  await expectPalette(page, STATES[1], "OS prefers contrast, dark");
});

test("Inter is the app face, and the file behind it really loaded", async ({ page }) => {
  await page.goto("/sign-in");
  await expect
    .poll(async () => computed(page.locator("body"), "font-family"))
    .toMatch(/^"?Inter"?/u);

  // The token reaches the vendored controls too, which inherit rather than declare.
  await expect(page.getByLabel("Email")).toHaveCSS("font-family", /Inter/u);

  const statuses = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((face) => face.family === "Inter").map((f) => f.status);
  });
  expect(statuses, "the Inter face should be declared once and loaded").toEqual(["loaded"]);
});

/**
 * The data face is the other half of the rev 8 pair, and it cannot be proved the way the
 * one above is. `--font-mono` reaches ids, hashes and versions, and the sign-in screen
 * shows none, so the face is declared and deliberately still `unloaded`: a browser fetches
 * a webfont when something on the page asks for it and not before. Asking for it is
 * therefore the test - `document.fonts.load` resolves to the matched faces only if the
 * declaration resolves to a file the browser can parse, which is the failure a token
 * assertion on its own would miss.
 */
test("JetBrains Mono is the data face and its file parses", async ({ page }) => {
  await page.goto("/sign-in");
  expect(await tokenLength(page.locator(":root"), "--font-mono")).toMatch(/^"JetBrains Mono"/u);

  const declared = await page.evaluate(
    () => [...document.fonts].filter((face) => face.family === "JetBrains Mono").length,
  );
  expect(declared, "the mono face should be declared exactly once").toBe(1);

  const loaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('400 1rem "JetBrains Mono"');
    return faces.map((face) => face.status);
  });
  expect(loaded, "and its file should load when something asks for it").toEqual(["loaded"]);
});

test("the control reaches all four states and each survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signInWithTotp(page, EMAIL, totpSecret);
  await expect(appearanceTrigger(page)).toBeVisible();

  for (const state of STATES) {
    const chosen = state.dark ? "Dark" : "Light";
    await choose(page, { polarity: chosen, high: state.high });
    expect(await rootClasses(page), `after choosing ${state.name}`).toEqual([...state.classes]);
    await expectPalette(page, state, `after choosing ${state.name}`);

    // The trigger is wordless, so its accessible name is the only place the chosen
    // state is spelled out, both axes of it.
    const expected = state.high ? `Appearance: ${chosen}, high contrast` : `Appearance: ${chosen}`;
    await expect(appearanceTrigger(page)).toHaveAccessibleName(expected);

    // The reload is the persistence proof, and it is a SERVER-side one: the classes are
    // in the HTML the server sent, so nothing had to run in the document to fix them.
    await page.reload();
    expect(await rootClasses(page), `${state.name} survives a reload`).toEqual([...state.classes]);
    await expectPalette(page, state, `${state.name} after reload`);
    await openAppearance(page);
    await expect(polarity(page, chosen)).toBeChecked();
    expect(await contrastSwitch(page).isChecked(), `${state.name}: the switch`).toBe(state.high);
    await page.keyboard.press("Escape");
  }
});

test("Auto keeps following the machine, at both contrast levels", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signInWithTotp(page, EMAIL, totpSecret);

  // Auto carries no polarity class, which is the whole point: the sheet's media blocks
  // are what paint it, so the one state the server cannot stamp still arrives correct.
  await choose(page, { polarity: "Auto", high: false });
  expect(await rootClasses(page)).toEqual([]);
  await expectPalette(page, STATES[0], "Auto on a light machine");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPalette(page, STATES[1], "Auto after the machine went dark");

  // And the same under high contrast, which is the state no root class can name on its
  // own: `hc` alone is the light field, and the sheet's auto dark-HC block is what makes
  // the dark field reachable without a `dark` class.
  await choose(page, { high: true });
  expect(await rootClasses(page)).toEqual(["hc"]);
  await expectPalette(page, STATES[3], "Auto high contrast on a dark machine");
  await page.emulateMedia({ colorScheme: "light" });
  await expectPalette(page, STATES[2], "Auto high contrast on a light machine");

  await expect(appearanceTrigger(page)).toHaveAccessibleName(
    "Appearance: Auto, Light now, high contrast",
  );
  await openAppearance(page);
  await expect(page.getByText("Following your system: Light now.")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a legacy hc cookie still means Light plus high contrast", async ({ page }) => {
  // The one piece of the two-axis move with a correctness risk rather than a taste risk.
  // Written straight into the jar, because the control can no longer produce this value
  // and the operators it matters for already have it.
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.context().addCookies([{ name: "qcms-app-mode", value: "hc", url: page.url() }]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();

  expect(await rootClasses(page), "a legacy cookie is Light plus high contrast").toEqual([
    "light",
    "hc",
  ]);
  await expectPalette(page, STATES[2], "legacy hc cookie on a dark machine");
  await openAppearance(page);
  await expect(polarity(page, "Light")).toBeChecked();
  expect(await contrastSwitch(page).isChecked()).toBe(true);
  await page.keyboard.press("Escape");
});

test("an explicit Light choice outranks a dark-preferring machine", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, { polarity: "Light", high: false });
  await page.reload();
  expect(await rootClasses(page)).toEqual(["light"]);
  await expectPalette(page, STATES[0], "explicit Light on a dark machine");
});

test("choosing the polarity already shown still persists it", async ({ page }) => {
  // The opt-out that is easy to lose. With no cookie the control shows Auto, so an
  // operator on a light machine who wants to STAY light when the machine flips at sunset
  // has to be able to pick Light, and pressing that radio has to write the cookie.
  await page.emulateMedia({ colorScheme: "light" });
  await signInWithTotp(page, EMAIL, totpSecret);
  expect(await rootClasses(page), "no cookie yet, so no class").toEqual([]);

  await choose(page, { polarity: "Light" });
  const stored = (await page.context().cookies()).find((c) => c.name === "qcms-app-mode");
  expect(stored?.value, "choosing the displayed field has to persist it").toBe("light");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await rootClasses(page), "the choice outranks the machine").toEqual(["light"]);
  await expectPalette(page, STATES[0], "pinned Light after the machine went dark");
});

test("the panel is reachable, navigable and dismissable from the keyboard alone", async ({
  page,
}) => {
  // The trigger has no text, so a keyboard operator reaches it by tab order and reads it
  // by name; if either the roving order or the name breaks, the control is unusable in a
  // way axe cannot detect (the issue #144 defect class).
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, { polarity: "Light", high: false });
  const trigger = appearanceTrigger(page);

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();

  // ROVING TABINDEX: one radio is in the tab order and the arrows move both the focus and
  // the selection, so Tab leaves the group rather than walking it.
  const radios = page.getByRole("radio");
  await expect(radios).toHaveCount(3);
  const tabbable = await radios.evaluateAll(
    (nodes) => nodes.filter((node) => (node as HTMLElement).tabIndex === 0).length,
  );
  expect(tabbable, "exactly one radio is tabbable").toBe(1);

  await polarity(page, "Light").focus();
  await page.keyboard.press("ArrowRight");
  await expect(polarity(page, "Dark")).toBeFocused();
  await expect(polarity(page, "Dark")).toBeChecked();
  expect(await rootClasses(page), "selection follows focus").toEqual(["dark"]);

  await page.keyboard.press("Home");
  await expect(polarity(page, "Auto")).toBeFocused();
  await expect(polarity(page, "Auto")).toBeChecked();
  await page.keyboard.press("End");
  await expect(polarity(page, "Dark")).toBeFocused();
  await expect(polarity(page, "Dark")).toBeChecked();

  // The switch is the next stop after the group, and Space works it.
  await page.keyboard.press("Tab");
  await expect(contrastSwitch(page)).toBeFocused();
  await page.keyboard.press(" ");
  expect(await rootClasses(page)).toEqual(["dark", "hc"]);

  // ESCAPE closes and returns focus to the trigger rather than dropping it to the body,
  // which is what keeps a keyboard operator's place in the bar.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(trigger).toBeFocused();

  // TABBING PAST THE END closes it too. The panel is non-modal, so focus is not
  // contained and an open panel left behind the operator is the failure.
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await contrastSwitch(page).focus();
  await page.keyboard.press("Tab");
  await expect(panel(page)).toBeHidden();
  await expect(trigger).not.toBeFocused();
});

test("the preview strip is a pointer shortcut and is hidden from assistive technology", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, { polarity: "Light", high: false });
  await openAppearance(page);

  // Four tiles, none of them in the accessibility tree and none of them focusable, which
  // is what keeps `aria-hidden` honest: the two controls above carry every state it
  // offers, so nothing is lost and axe's `aria-hidden-focus` rule has nothing to report.
  const tiles = page.locator(".qcms-appearance__tile");
  await expect(tiles).toHaveCount(4);
  await expect(page.locator('[aria-hidden="true"] .qcms-appearance__tile')).toHaveCount(4);
  expect(
    await tiles.evaluateAll((nodes) =>
      nodes.every((node) => (node as HTMLElement).tabIndex === -1),
    ),
  ).toBe(true);

  // Each swatch paints from the state's REAL tokens rather than a second set of colours,
  // so the dark tile's field is dark while the panel around it is light.
  const field = async (index: number): Promise<number> =>
    luminance(
      await tiles
        .nth(index)
        .locator(".qcms-themepreview")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    );
  expect(await field(0), "the Light tile").toBeGreaterThan(0.8);
  expect(await field(1), "the Dark tile").toBeLessThan(0.1);

  // And a tile applies its state, without taking focus into the hidden subtree.
  await tiles.nth(3).click();
  expect(await rootClasses(page)).toEqual(["dark", "hc"]);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a persisted choice is on screen in the first painted frame", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, { polarity: "Dark", high: true });

  /*
   * The no-flash proof has to be a measurement, not an assertion about the end state,
   * which is always right by the time a test looks. A `requestAnimationFrame`
   * callback runs immediately BEFORE the browser paints that frame, so the first
   * sample with a `<body>` in it is the earliest frame in which the page background
   * could have appeared at all. If that colour is already the settled one, no other
   * colour was ever on screen. (`querySelector` rather than `document.body` purely
   * for the type: the DOM lib declares `body` non-nullable, and during parsing it
   * genuinely is not there yet - which is exactly the frame worth sampling.)
   */
  await page.addInitScript(() => {
    const store = window as unknown as { __qcmsFrames?: { cls: string; bg: string | null }[] };
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

  await page.reload();
  const settled = await computed(page.locator("body"), "background-color");
  const frames = await page.evaluate(
    () =>
      (window as unknown as { __qcmsFrames: { cls: string; bg: string | null }[] }).__qcmsFrames,
  );

  expect(frames.length, "no frames were sampled").toBeGreaterThan(0);
  for (const [index, frame] of frames.entries()) {
    const classes = frame.cls.split(/\s+/u);
    expect(classes, `frame ${index} classes`).toContain("dark");
    expect(classes, `frame ${index} classes`).toContain("hc");
  }
  const firstPainted = frames.find((frame) => frame.bg !== null);
  expect(firstPainted, "no sampled frame had a <body>").toBeDefined();
  expect(
    firstPainted?.bg,
    `the first painted frame was ${String(firstPainted?.bg)} but the page settled at ${settled} - that difference IS the flash`,
  ).toBe(settled);
});

test("the chosen polarity is distinguishable without colour, in both HC fields", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  for (const dark of [false, true]) {
    await choose(page, { polarity: dark ? "Dark" : "Light", high: true });
    await openAppearance(page);
    await settleTransitions(page);
    const label = dark ? "dark HC" : "light HC";
    const chosen = painted(polarity(page, dark ? "Dark" : "Light"));
    const other = painted(polarity(page, "Auto"));

    // Two non-colour differences on the segment, each of which survives a two-colour
    // palette: the heavier weight carries at distance and the drawn edge survives a
    // monochrome rendering. The semantics behind them is the radio's own checked state,
    // which is what a screen reader actually uses.
    expect(
      Number(await computed(chosen, "font-weight")),
      `${label}: the chosen segment is heavier`,
    ).toBeGreaterThan(Number(await computed(other, "font-weight")));
    expect(
      await computed(chosen, "border-top-color"),
      `${label}: the chosen segment's edge is drawn, not transparent`,
    ).not.toBe("rgba(0, 0, 0, 0)");
    await expect(polarity(page, dark ? "Dark" : "Light")).toBeChecked();
    await expect(polarity(page, "Auto")).not.toBeChecked();

    // The switch says the word, so its state is never the knob's position alone.
    await expect(page.getByText("On", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("the appearance trigger is borderless at rest and bordered in high contrast", async ({
  page,
}) => {
  // The card's one deliberate high-contrast exception, and the kind of detail a theme
  // change silently drops: at rest the glyph alone is the button, but in HC a borderless
  // icon is precisely what an operator cannot find, so the border returns.
  await signInWithTotp(page, EMAIL, totpSecret);
  const trigger = appearanceTrigger(page);

  await choose(page, { polarity: "Light", high: false });
  expect(await computed(trigger, "border-top-width")).toBe("0px");
  expect(await computed(trigger, "background-color")).toBe("rgba(0, 0, 0, 0)");

  await choose(page, { high: true });
  expect(await computed(trigger, "border-top-width")).toBe("2px");
  // In both fields, because the exception is about contrast rather than polarity.
  await choose(page, { polarity: "Dark" });
  expect(await computed(trigger, "border-top-width")).toBe("2px");
});

test("both topbar triggers are 32px squares, not stretched by the control floor", async ({
  page,
}) => {
  // The bare `button` rule sets
  // `min-block-size: var(--admin-control-h)` (40px), and a min-block-size beats a
  // block-size, so both triggers rendered 32 wide by 40 tall. On the avatar, whose
  // `border-radius: 50%` turns any non-square box into an oval, it was obvious; on the
  // appearance trigger it was a quieter rectangle. Measuring the rendered box is the
  // only assertion that catches this - every property the CSS declares was already
  // correct on its own.
  await signInWithTotp(page, EMAIL, totpSecret);

  // Through the shared helper rather than a local role query: the account trigger's
  // accessible name opens with the account's own initials since issue #1010, so a pattern
  // written out here would have to be kept in step with one written out there.
  for (const trigger of [appearanceTrigger(page), accountTrigger(page)]) {
    const box = await trigger.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(32);
    expect(Math.round(box!.height)).toBe(32);
  }
});

/**
 * COMPONENT_GUIDELINES step 9, the popover side.
 *
 * Every number below is read from a TOKEN rather than written down, exactly as the rest
 * of this file works. Step 9's contract is "styles consume the four token groups only",
 * so an assertion that hardcoded `8px` would keep passing after the radius stopped coming
 * from `--radius-modal`, which is the failure it exists to catch.
 */
test("the appearance panel takes its metrics from the tokens", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, { polarity: "Light", high: false });
  await openAppearance(page);

  const popover = page.locator(".qcms-appearance__pop");
  // It FLOATS, so it takes the modal corner, like the two menus beside it.
  expect(await computed(popover, "border-radius")).toBe(
    await tokenLength(popover, "--radius-modal"),
  );
  expect(await computed(page.locator(".qcms-appearance__segments"), "border-radius")).toBe(
    await tokenLength(popover, "--radius-control"),
  );
  await page.keyboard.press("Escape");
});

test("the appearance panel carries the high-contrast border treatment, in both fields", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);

  for (const dark of [false, true]) {
    await choose(page, { polarity: dark ? "Dark" : "Light", high: true });
    await openAppearance(page);
    // Never sample a colour straight after a class swap: the vendored kit carries
    // `transition-colors`, so an immediate read returns a mid-transition value and two
    // runs disagree on the number.
    await settleTransitions(page);

    const popover = page.locator(".qcms-appearance__pop");
    const label = dark ? "dark HC" : "light HC";
    // HC's border treatment is a hard edge at full contrast plus a flat surface. The
    // colour comes from `--color-border-strong`, which both HC layers take to a pure
    // extreme, and the shadow that gives the panel depth in the other states is removed:
    // depth cues are exactly what an operator in this mode cannot resolve.
    expect(await computed(popover, "border-top-color"), label).toBe(
      await token(page, "--color-border-strong"),
    );
    expect(Number.parseFloat(await computed(popover, "border-top-width")), label).toBe(2);
    expect(await computed(popover, "box-shadow"), label).toBe("none");
    await page.keyboard.press("Escape");
  }
});

test("there is no sideways scroll at 390px", async ({ page }) => {
  // The panel is anchored to a trigger at the end of the bar, so a fixed width wider
  // than a phone would push the document sideways rather than clip.
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAppearance(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the open panel must not widen the document").toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
});
