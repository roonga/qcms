import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../portal/e2e/support/gates.js";

import { createTestAdmin, uniqueAdminEmail } from "./support/admin-account.js";
import {
  appearanceTrigger,
  openMenu,
  readSetupKey,
  settleTransitions,
  signInWithTotp,
  submitSignIn,
  submitTotp,
} from "./support/flow.js";

/**
 * The QCMS app's appearance behaviour (task 055, exit criteria 3 and 4).
 *
 * What is asserted here, and why each one is a browser test rather than a unit test:
 *
 *  - **The default follows `prefers-color-scheme`.** That signal exists only in a
 *    real browser, and the mechanism carrying it is a media block inside the token
 *    sheet - CSS that no unit test can execute.
 *  - **High-contrast is never inferred.** The interesting case is `prefers-contrast:
 *    more`, where the portal DOES switch to High-contrast and this app deliberately
 *    does not. Only a browser can tell the two apps apart on that input.
 *  - **A choice persists and repaints with no flash.** The proof that the server
 *    stamped the class rather than a script correcting it after load is a
 *    measurement of the first painted frames, which needs a compositor.
 *  - **Lexend actually loads.** A computed `font-family` proves the token; the
 *    `FontFace` status proves the file behind it was fetched and parsed rather than
 *    silently falling back to the system stack.
 *
 * NOTHING here hard-codes a colour. Every assertion reads the token the sheet
 * resolved and compares its luminance, so a future palette revision changes the
 * numbers without touching this file - and a palette that stopped switching at all
 * still fails.
 */

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("appearance");
const MODES = ["light", "dark", "hc"] as const;
type Mode = (typeof MODES)[number];

/** Set by the first test, which walks the account through enrollment. */
let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

/** The mode classes present on the root element, in the sheet's own vocabulary. */
async function rootModes(page: Page): Promise<string[]> {
  const className = await page.evaluate(() => document.documentElement.className);
  return MODES.filter((mode) => className.split(/\s+/u).includes(mode));
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

/**
 * Assert the page is painted in `mode`, from the tokens rather than from a list of
 * colours: Light and High-contrast are both light-on-dark-text but High-contrast
 * pushes text to pure black, and Dark inverts the pair entirely.
 */
async function expectPalette(page: Page, mode: Mode, label: string): Promise<void> {
  const background = luminance(await token(page, "--color-background"));
  const text = luminance(await token(page, "--color-text"));
  // The body actually wears the background token - the theme is applied, not just declared.
  expect(
    await computed(page.locator("body"), "background-color"),
    `${label}: body background`,
  ).toBe(await token(page, "--color-background"));

  if (mode === "dark") {
    expect(background, `${label}: background should be dark`).toBeLessThan(0.1);
    expect(text, `${label}: text should be light`).toBeGreaterThan(0.5);
    return;
  }
  expect(background, `${label}: background should be light`).toBeGreaterThan(0.8);
  expect(text, `${label}: text should be dark`).toBeLessThan(0.1);
  // High-contrast is the only mode that takes text all the way to black.
  if (mode === "hc") expect(text, `${label}: HC text is pure black`).toBe(0);
  else expect(text, `${label}: Light text is not pure black`).toBeGreaterThan(0);
}

async function computed(locator: Locator, property: string): Promise<string> {
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/**
 * A LENGTH token as it resolves on one element, trimmed.
 *
 * Custom properties compute to their authored text, so `--radius-card` comes back as
 * `"8px"` (often with the leading space the declaration was written with) while
 * `border-radius` computes to `"8px"`. Trimming is the whole conversion; the colour
 * equivalent needs the probe element in `token` above, because a colour's authored text
 * (`#0b0f1a`) never matches its computed form.
 */
async function tokenLength(locator: Locator, property: string): Promise<string> {
  return (await computed(locator, property)).trim();
}

/** The human label for a mode, which is what the menu row and the trigger both say. */
const LABEL: Record<Mode, string> = { light: "Light", dark: "Dark", hc: "High contrast" };

/** One row of the open appearance menu, by role and accessible name. */
function row(page: Page, mode: Mode): Locator {
  return page.getByRole("menuitemradio", { name: LABEL[mode], exact: true });
}

/**
 * Choose a mode the way an operator does: open the menu, click the row.
 *
 * Every step is the real control (task 032). Nothing here reaches for a class or
 * pokes the root element, because what is under test is whether the CONTROL applies
 * the mode - a test that set the class itself would pass with the control removed.
 */
async function choose(page: Page, mode: Mode): Promise<void> {
  await openMenu(appearanceTrigger(page));
  await row(page, mode).click();
  await expect(page.getByRole("menu")).toBeHidden();
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
  expect(await rootModes(page)).toEqual([]);
  await expectPalette(page, "light", "OS prefers light");

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await rootModes(page)).toEqual([]);
  await expectPalette(page, "dark", "OS prefers dark");

  // Nothing was persisted: an operator who has expressed no preference has no cookie.
  const cookies = await page.context().cookies();
  expect(cookies.map((c) => c.name)).not.toContain("qcms-app-mode");
});

test("high-contrast is never inferred, whatever the machine asks for", async ({ page }) => {
  // The portal DOES resolve `prefers-contrast: more` to High-contrast (task 053).
  // This app deliberately does not: HC changes far more than a palette, and the
  // operator chooses it or it does not happen.
  await page.emulateMedia({ colorScheme: "light", contrast: "more" });
  await page.goto("/sign-in");
  expect(await rootModes(page), "prefers-contrast must not select HC").toEqual([]);
  await expectPalette(page, "light", "OS prefers contrast, light");

  await page.emulateMedia({ colorScheme: "dark", contrast: "more" });
  expect(await rootModes(page), "prefers-contrast must not select HC").toEqual([]);
  await expectPalette(page, "dark", "OS prefers contrast, dark");
});

test("Lexend is the app face, and the file behind it really loaded", async ({ page }) => {
  await page.goto("/sign-in");
  await expect
    .poll(async () => computed(page.locator("body"), "font-family"))
    .toMatch(/^"?Lexend"?/u);

  // The token reaches the vendored controls too, which inherit rather than declare.
  await expect(page.getByLabel("Email")).toHaveCSS("font-family", /Lexend/u);

  const statuses = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((face) => face.family === "Lexend").map((f) => f.status);
  });
  expect(statuses, "the Lexend face should be declared once and loaded").toEqual(["loaded"]);
});

test("the mode control moves through all three modes and persists across a reload", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await expect(appearanceTrigger(page)).toBeVisible();

  for (const mode of MODES) {
    await choose(page, mode);
    expect(await rootModes(page), `after choosing ${mode}`).toEqual([mode]);
    await expectPalette(page, mode, `after choosing ${mode}`);
    // The trigger is wordless, so its accessible name is the only place the chosen
    // mode is spelled out. It has to follow the choice or a screen-reader operator
    // has no way to read the state at all.
    await expect(appearanceTrigger(page)).toHaveAccessibleName(`Appearance: ${LABEL[mode]}`);

    // The reload is the persistence proof, and it is a SERVER-side one: the class is
    // in the HTML the server sent, so nothing had to run in the document to fix it.
    await page.reload();
    expect(await rootModes(page), `${mode} survives a reload`).toEqual([mode]);
    await expectPalette(page, mode, `${mode} after reload`);
    await openMenu(appearanceTrigger(page));
    await expect(row(page, mode)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  }
});

test("the menu opens, navigates and closes from the keyboard alone", async ({ page }) => {
  // The trigger has no text, so a keyboard operator reaches it by tab order and reads
  // it by name; if either the roving order or the name breaks, the control is
  // unusable in a way axe cannot detect (the issue #144 defect class).
  await signInWithTotp(page, EMAIL, totpSecret);
  const trigger = appearanceTrigger(page);
  await trigger.focus();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  // Escape returns focus to the trigger rather than dropping it to the body, which is
  // what keeps a keyboard operator's place in the bar.
  await expect(trigger).toBeFocused();

  // Enter opens too, and a row chosen with Enter applies the mode.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await row(page, "hc").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeHidden();
  expect(await rootModes(page)).toEqual(["hc"]);
});

test("an explicit Light choice outranks a dark-preferring machine", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, "light");
  await page.reload();
  expect(await rootModes(page)).toEqual(["light"]);
  await expectPalette(page, "light", "explicit Light on a dark machine");
});

test("choosing the mode already shown still persists it", async ({ page }) => {
  // The opt-out that is easy to lose. With no cookie, the control displays what the
  // machine prefers, so an operator on a light machine who wants to STAY light when
  // the machine flips to dark at sunset has to be able to choose Light - the mode the
  // menu already shows as checked. A selection callback would report no change and do
  // nothing; `onAction` is what makes this write the cookie.
  await page.emulateMedia({ colorScheme: "light" });
  await signInWithTotp(page, EMAIL, totpSecret);
  expect(await rootModes(page), "no cookie yet, so no class").toEqual([]);

  await choose(page, "light");
  const stored = (await page.context().cookies()).find((c) => c.name === "qcms-app-mode");
  expect(stored?.value, "choosing the displayed mode has to persist it").toBe("light");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect(await rootModes(page), "the choice outranks the machine").toEqual(["light"]);
  await expectPalette(page, "light", "pinned Light after the machine went dark");
});

test("a persisted choice is on screen in the first painted frame", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, "dark");

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
    expect(frame.cls.split(/\s+/u), `frame ${index} classes`).toContain("dark");
  }
  const firstPainted = frames.find((frame) => frame.bg !== null);
  expect(firstPainted, "no sampled frame had a <body>").toBeDefined();
  expect(
    firstPainted?.bg,
    `the first painted frame was ${String(firstPainted?.bg)} but the page settled at ${settled} - that difference IS the flash`,
  ).toBe(settled);
});

test("the checked menu row is distinguishable without colour, including in High-contrast", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, "hc");
  expect(await rootModes(page)).toEqual(["hc"]);

  await openMenu(appearanceTrigger(page));
  const checked = row(page, "hc");
  const unchecked = row(page, "light");

  // Three non-colour differences, each of which survives a two-colour palette. The
  // check glyph is the one a screen magnifier user reads at a glance; the inset edge
  // is the one that survives a monochrome rendering; the weight carries at distance.
  await expect(checked.locator(".qcms-menu__check")).toHaveText("✓");
  await expect(unchecked.locator(".qcms-menu__check")).toHaveText("");
  expect(Number(await computed(checked, "font-weight"))).toBeGreaterThan(
    Number(await computed(unchecked, "font-weight")),
  );
  // `box-shadow` rather than a border, so the row's box never moves between states.
  expect(await computed(checked, "box-shadow"), "the checked row's inset accent edge").toMatch(
    /inset/u,
  );
  expect(await computed(unchecked, "box-shadow")).toBe("none");
  // And the semantics behind all three, which is what a screen reader actually uses.
  await expect(checked).toHaveAttribute("aria-checked", "true");
  await expect(unchecked).toHaveAttribute("aria-checked", "false");
});

test("the appearance trigger is borderless at rest and bordered in High-contrast", async ({
  page,
}) => {
  // The card's one deliberate high-contrast exception, and the kind of detail a theme
  // change silently drops: at rest the glyph alone is the button, but in HC a
  // borderless icon is precisely what an operator cannot find, so the border returns.
  await signInWithTotp(page, EMAIL, totpSecret);
  const trigger = appearanceTrigger(page);

  await choose(page, "light");
  expect(await computed(trigger, "border-top-width")).toBe("0px");
  expect(await computed(trigger, "background-color")).toBe("rgba(0, 0, 0, 0)");

  await choose(page, "hc");
  expect(await computed(trigger, "border-top-width")).toBe("1px");
});

test("both topbar triggers are 32px squares, not stretched by the control floor", async ({
  page,
}) => {
  // A regression the screenshot gate caught by eye: the bare `button` rule sets
  // `min-block-size: var(--admin-control-h)` (40px), and a min-block-size beats a
  // block-size, so both triggers rendered 32 wide by 40 tall. On the avatar, whose
  // `border-radius: 50%` turns any non-square box into an oval, it was obvious; on the
  // appearance trigger it was a quieter rectangle. Measuring the rendered box is the
  // only assertion that catches this - every property the CSS declares was already
  // correct on its own.
  await signInWithTotp(page, EMAIL, totpSecret);

  for (const trigger of [
    appearanceTrigger(page),
    page.getByRole("button", { name: /Account menu/ }),
  ]) {
    const box = await trigger.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(32);
    expect(Math.round(box!.height)).toBe(32);
  }
});

/**
 * COMPONENT_GUIDELINES step 9, the popover side (task 032 review batch, item 3).
 *
 * The trigger-side assertions are the two tests above. This is the other half of the new
 * menu surface: the popover's own box and its rows, which no test touched.
 *
 * Every number below is read from a TOKEN rather than written down, exactly as the rest
 * of this file works. Step 9's contract is "styles consume the four token groups only",
 * so an assertion that hardcoded `8px` would keep passing after the radius stopped coming
 * from `--radius-card`, which is the failure it exists to catch.
 *
 * A note on where these rules live, because it is not where step 9 says to look. The
 * menu box that actually paints in this app is `.qcms-menu` in `app/globals.css`: this
 * app does NOT import `@roonga/qcms-ui/theme-components.css` (only the portal does), so the menu
 * rules added to that sheet reach no host yet. They are correct and they are the right
 * place for a menu rendered inside `[data-qcms-field]`, but the chrome menus here are
 * styled by the app, and asserting the sheet the app does not load would prove nothing
 * about the pixels. The DOM-shape assertion at the end is what keeps the shared sheet
 * honest for the host that does load it.
 */
test("the menu popover and its rows take their metrics from the tokens", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await openMenu(appearanceTrigger(page));

  const popover = page.locator(".qcms-menu");
  const item = page.getByRole("menuitemradio", { name: LABEL.light, exact: true });

  // The popover is a panel, so it takes the card radius; a row is a small inset shape,
  // so it takes the small one. Reading both tokens off the popover itself means the
  // comparison survives a corner-preset change that moves every number at once.
  expect(await computed(popover, "border-radius")).toBe(
    await tokenLength(popover, "--radius-card"),
  );
  expect(await computed(item, "border-radius")).toBe(await tokenLength(popover, "--radius-sm"));

  // Row metrics: a 38px row with 10px of inline padding, per the card. These are the
  // numbers that make the check glyph and the label sit where they were drawn, and a
  // silent change to either is exactly what a screenshot gate cannot be relied on to
  // catch at a glance.
  expect(await computed(item, "block-size")).toBe("38px");
  expect(await computed(item, "padding-inline-start")).toBe("10px");
  expect(await computed(item, "padding-inline-end")).toBe("10px");

  // The checked row is never colour alone (WCAG 1.4.1): the inset accent edge is drawn
  // with a box-shadow, so its presence is the assertion.
  const checked = page.getByRole("menuitemradio", { checked: true });
  expect(await computed(checked, "box-shadow")).toContain("inset");
  expect(await computed(checked, "font-weight")).toBe("600");
});

test("the menu popover carries the high-contrast border treatment", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, "hc");
  await openMenu(appearanceTrigger(page));
  // Never sample a colour straight after a mode-class swap: the vendored kit carries
  // `transition-colors`, so an immediate read returns a mid-transition value and two
  // runs disagree on the number.
  await settleTransitions(page);

  const popover = page.locator(".qcms-menu");
  // HC's border treatment is a hard edge at full contrast plus a flat surface. The
  // colour comes from `--color-border-strong`, which the HC layer takes to pure black,
  // and the shadow that gives the menu depth in the other two modes is removed - depth
  // cues are exactly what an operator in this mode cannot resolve.
  expect(await computed(popover, "border-top-color")).toBe(
    await token(page, "--color-border-strong"),
  );
  expect(Number.parseFloat(await computed(popover, "border-top-width"))).toBeGreaterThan(0);
  expect(await computed(popover, "box-shadow")).toBe("none");

  // And the shared sheet's selector still has something to match. `theme-components.css`
  // reaches the menu through `[data-rac]:has(> [role="menu"])` because `MenuTrigger`
  // portals the popover out of the field it belongs to; if react-aria ever nests the
  // menu one level deeper, that rule silently stops applying in every host that DOES
  // import the sheet, and nothing else in the repo would notice.
  await expect(page.locator('[data-rac]:has(> [role="menu"])')).toHaveCount(1);
});
