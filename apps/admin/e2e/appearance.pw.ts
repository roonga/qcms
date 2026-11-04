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

test.describe.configure({ mode: "serial" });

const EMAIL = uniqueAdminEmail("appearance");

const CLASSES = ["light", "dark", "hc"] as const;

const STATES = [
  { name: "light", classes: ["light"] as readonly string[], dark: false, high: false },
  { name: "dark", classes: ["dark"], dark: true, high: false },
  { name: "light high contrast", classes: ["light", "hc"], dark: false, high: true },
  { name: "dark high contrast", classes: ["dark", "hc"], dark: true, high: true },
] as const;
type State = (typeof STATES)[number];

let totpSecret = "";

test.beforeAll(async () => {
  await createTestAdmin(EMAIL);
});

async function rootClasses(page: Page): Promise<string[]> {
  const className = await page.evaluate(() => document.documentElement.className);
  return CLASSES.filter((candidate) => className.split(/\s+/u).includes(candidate));
}

// Read colour through a probe: custom properties retain authored text while computed colours use rgb notation.
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

async function expectPalette(page: Page, state: State, label: string): Promise<void> {
  const backgroundToken = await token(page, "--color-background");
  const background = luminance(backgroundToken);
  const textToken = await token(page, "--color-text");
  const text = luminance(textToken);

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

// Length properties retain authored text; trim whitespace before comparing with computed geometry.
async function tokenLength(locator: Locator, property: string): Promise<string> {
  return (await computed(locator, property)).trim();
}

function polarity(page: Page, name: "Auto" | "Light" | "Dark"): Locator {
  return page.getByRole("radio", { name, exact: true });
}

// React Aria radios and switches hide their inputs inside labels; click the painted label.
const painted = (control: Locator): Locator => control.locator("xpath=ancestor::label[1]");

function contrastSwitch(page: Page): Locator {
  return page.getByRole("switch", { name: /High contrast/u });
}

const panel = (page: Page): Locator => page.getByRole("dialog", { name: "Appearance" });

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

  expect(await rootClasses(page)).toEqual([]);
  await expectPalette(page, STATES[0], "OS prefers light");

  await page.emulateMedia({ colorScheme: "dark" });
  expect(await rootClasses(page)).toEqual([]);
  await expectPalette(page, STATES[1], "OS prefers dark");

  const cookies = await page.context().cookies();
  expect(cookies.map((c) => c.name)).not.toContain("qcms-app-mode");
});

test("high contrast is never inferred, whatever the machine asks for", async ({ page }) => {
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

  await expect(page.getByLabel("Email")).toHaveCSS("font-family", /Inter/u);

  const statuses = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].filter((face) => face.family === "Inter").map((f) => f.status);
  });
  expect(statuses, "the Inter face should be declared once and loaded").toEqual(["loaded"]);
});

// The sign-in screen never requests the data font, so explicitly load it to test that its file is usable.
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

    const expected = state.high ? `Appearance: ${chosen}, high contrast` : `Appearance: ${chosen}`;
    await expect(appearanceTrigger(page)).toHaveAccessibleName(expected);

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

  await choose(page, { polarity: "Auto", high: false });
  expect(await rootClasses(page)).toEqual([]);
  await expectPalette(page, STATES[0], "Auto on a light machine");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectPalette(page, STATES[1], "Auto after the machine went dark");

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
  // Seed the legacy cookie directly because the appearance control cannot produce that value.
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
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, { polarity: "Light", high: false });
  const trigger = appearanceTrigger(page);

  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();

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

  await page.keyboard.press("Tab");
  await expect(contrastSwitch(page)).toBeFocused();
  await page.keyboard.press(" ");
  expect(await rootClasses(page)).toEqual(["dark", "hc"]);

  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(trigger).toBeFocused();

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

  const tiles = page.locator(".qcms-appearance__tile");
  await expect(tiles).toHaveCount(4);
  await expect(page.locator('[aria-hidden="true"] .qcms-appearance__tile')).toHaveCount(4);
  expect(
    await tiles.evaluateAll((nodes) =>
      nodes.every((node) => (node as HTMLElement).tabIndex === -1),
    ),
  ).toBe(true);

  const field = async (index: number): Promise<number> =>
    luminance(
      await tiles
        .nth(index)
        .locator(".qcms-themepreview")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    );
  expect(await field(0), "the Light tile").toBeGreaterThan(0.8);
  expect(await field(1), "the Dark tile").toBeLessThan(0.1);

  await tiles.nth(3).click();
  expect(await rootClasses(page)).toEqual(["dark", "hc"]);
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("a persisted choice is on screen in the first painted frame", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, { polarity: "Dark", high: true });

  // requestAnimationFrame runs before paint; the first frame containing body is the earliest visible background.
  // Record frames from document creation so a settled-state assertion cannot hide a theme flash.
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

    await expect(page.getByText("On", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("the appearance trigger is borderless at rest and bordered in high contrast", async ({
  page,
}) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  const trigger = appearanceTrigger(page);

  await choose(page, { polarity: "Light", high: false });
  expect(await computed(trigger, "border-top-width")).toBe("0px");
  expect(await computed(trigger, "background-color")).toBe("rgba(0, 0, 0, 0)");

  await choose(page, { high: true });
  expect(await computed(trigger, "border-top-width")).toBe("2px");

  await choose(page, { polarity: "Dark" });
  expect(await computed(trigger, "border-top-width")).toBe("2px");
});

test("both topbar triggers are 32px squares, not stretched by the control floor", async ({
  page,
}) => {
  // Measure the box: min-block-size can override block-size even when the declared dimensions look correct.
  await signInWithTotp(page, EMAIL, totpSecret);

  for (const trigger of [appearanceTrigger(page), accountTrigger(page)]) {
    const box = await trigger.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(32);
    expect(Math.round(box!.height)).toBe(32);
  }
});

test("the appearance panel takes its metrics from the tokens", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await choose(page, { polarity: "Light", high: false });
  await openAppearance(page);

  const popover = page.locator(".qcms-appearance__pop");

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
    // Poll after class swaps: transition-colors makes an immediate colour read depend on sampling time.
    await settleTransitions(page);

    const popover = page.locator(".qcms-appearance__pop");
    const label = dark ? "dark HC" : "light HC";

    expect(await computed(popover, "border-top-color"), label).toBe(
      await token(page, "--color-border-strong"),
    );
    expect(Number.parseFloat(await computed(popover, "border-top-width")), label).toBe(2);
    expect(await computed(popover, "box-shadow"), label).toBe("none");
    await page.keyboard.press("Escape");
  }
});

test("there is no sideways scroll at 390px", async ({ page }) => {
  await signInWithTotp(page, EMAIL, totpSecret);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAppearance(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the open panel must not widen the document").toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
});
