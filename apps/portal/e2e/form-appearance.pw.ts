import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

import { FONT_COOKIE, MODE_COOKIE, TEXT_SIZE_COOKIE } from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import { chooseAccident } from "./support/flow.js";
import {
  admin,
  appearanceOf,
  createThemeWithLogo,
  publishAppearance,
  solidPng,
  takeDownLogo,
} from "./support/form-appearance.js";
import { expect, test } from "./support/gates.js";
import { waitForHydration } from "./support/hydration.js";
import {
  HARNESS_BRAND_NAME,
  HARNESS_CORNERS,
  HARNESS_FONT,
  HARNESS_FONTS,
  PORTAL_PORT,
} from "./support/harness-config.js";

const ORIGIN = `http://localhost:${PORTAL_PORT}`;
const CARRIER = "data-qcms-form-appearance";

/** A registry face the harness deployment does not offer and that is not a legibility face. */
const UNOFFERED_FACE = "roboto";
const UNOFFERED_CLASS = /\bfont-roboto\b/u;

/** The harness theme's own light primary, which a page without a form appearance keeps. */
const HARNESS_LIGHT_PRIMARY = "#1f5eb8";

async function pin(page: Page, cookies: Readonly<Record<string, string>>): Promise<void> {
  await page
    .context()
    .addCookies(Object.entries(cookies).map(([name, value]) => ({ name, value, url: ORIGIN })));
}

async function startSession(page: Page, slug: string): Promise<string> {
  await page.goto(`/f/${slug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/u);
  await expect(page.getByTestId("step-card")).toBeVisible();
  return new URL(page.url()).pathname;
}

function rootToken(page: Page, name: string): Promise<string> {
  return page
    .locator("html")
    .evaluate((element, token) => getComputedStyle(element).getPropertyValue(token).trim(), name);
}

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

async function expectPalette(
  page: Page,
  palette: Readonly<Record<string, string>>,
  label: string,
): Promise<void> {
  expect(await rootToken(page, "--color-primary"), `${label}: primary`).toBe(palette["primary"]);
  expect(await rootToken(page, "--color-text"), `${label}: text`).toBe(palette["text"]);
  await expect(page.locator("body"), `${label}: page background`).toHaveCSS(
    "background-color",
    rgb(palette["background"] ?? ""),
  );
}

async function expectNoAxeViolations(page: Page, label: string): Promise<void> {
  await settleTransitions(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ");
  expect(results.violations, `axe violations at "${label}": ${summary}`).toEqual([]);
  expect(results.passes.length, `axe ran no rules at "${label}"`).toBeGreaterThan(0);
}

async function expectLogoLoaded(page: Page, key: string): Promise<void> {
  const logo = page.getByTestId("brand-mark").locator("img");
  await expect(logo).toHaveAttribute("src", `/logo/${key}`);
  await expect
    .poll(() => logo.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

test("a form with its own appearance renders it on the whole page, in every mode", async ({
  page,
}) => {
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.own;
  const look = fixtures.looks.teal;
  await publishAppearance(fixtures, formId, appearanceOf(look));

  await pin(page, { [MODE_COOKIE]: "light" });
  await startSession(page, slug);
  const root = page.locator("html");
  await expect(root).toHaveAttribute(CARRIER, "");
  await expectPalette(page, look.palettes["light"] ?? {}, "light");
  await expect(root).toHaveClass(/\bradius-sharp\b/u);
  await expect(root).toHaveClass(/\bfont-merriweather\b/u);
  await expect(root).toHaveClass(/\bdensity-spacious\b/u);
  await expect(page.getByTestId("step-card")).toHaveCSS("border-radius", "0px");

  // The palette rides a nonced style element, never an inline style attribute.
  await expect(root).not.toHaveAttribute("style");
  const nonces = await page.evaluate((carrier) => {
    const of = (selector: string, marker: string): string | null =>
      [...document.querySelectorAll<HTMLElement>(selector)].find((element) =>
        (element.textContent ?? "").includes(marker),
      )?.nonce ?? null;
    return { style: of("head style", carrier), script: of("head script", "qcms-theme") };
  }, CARRIER);
  expect(nonces.style, "the form's style element carries no nonce").toBeTruthy();
  expect(nonces.style).toBe(nonces.script);

  await pin(page, { [MODE_COOKIE]: "dark" });
  await page.reload();
  await expectPalette(page, look.palettes["dark"] ?? {}, "dark");

  await pin(page, { [MODE_COOKIE]: "hc" });
  await page.reload();
  await expectPalette(page, look.palettes["lightHighContrast"] ?? {}, "high contrast");

  // The respondent's face and text size apply over the form's; a density cookie does not.
  await pin(page, {
    [MODE_COOKIE]: "light",
    [FONT_COOKIE]: "atkinson",
    [TEXT_SIZE_COOKIE]: "125",
    "qcms-density": "compact",
  });
  await page.reload();
  await expect(root).toHaveClass(/\bfont-atkinson\b/u);
  await expect(root).toHaveClass(/\btext-scale-125\b/u);
  await expect(root).toHaveClass(/\bdensity-spacious\b/u);
  await expect(root).not.toHaveClass(/\bdensity-compact\b/u);
  await expect(root).not.toHaveClass(/\bfont-merriweather\b/u);
  await expect(root).toHaveClass(/\bradius-sharp\b/u);
  await expectPalette(page, look.palettes["light"] ?? {}, "light after a respondent choice");
});

test("a form with no appearance renders the environment default", async ({ page }) => {
  const { slug } = readFixtures();
  await pin(page, { [MODE_COOKIE]: "light" });
  await startSession(page, slug);
  const root = page.locator("html");
  await expect(root).not.toHaveAttribute(CARRIER);
  expect(await rootToken(page, "--color-primary")).toBe(HARNESS_LIGHT_PRIMARY);
  await expect(root).toHaveClass(new RegExp(`\\bradius-${HARNESS_CORNERS}\\b`, "u"));
  await expect(root).toHaveClass(new RegExp(`\\bfont-${HARNESS_FONT}\\b`, "u"));
  await expect(page.locator("head style", { hasText: CARRIER })).toHaveCount(0);
});

test("a session keeps its version's appearance after a later publish; a new session takes the new one", async ({
  page,
}) => {
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.frozen;
  const { teal, crimson } = fixtures.looks;
  await publishAppearance(fixtures, formId, appearanceOf(teal));

  await pin(page, { [MODE_COOKIE]: "light" });
  const started = await startSession(page, slug);
  await expectPalette(page, teal.palettes["light"] ?? {}, "started");

  await publishAppearance(fixtures, formId, appearanceOf(crimson, { corners: "pill" }));
  await page.goto(started);
  await expect(page.getByTestId("step-card")).toBeVisible();
  await expectPalette(page, teal.palettes["light"] ?? {}, "continued after the publish");
  await expect(page.locator("html")).toHaveClass(/\bradius-sharp\b/u);

  const next = await startSession(page, slug);
  expect(next).not.toBe(started);
  await expectPalette(page, crimson.palettes["light"] ?? {}, "a new session");
  await expect(page.locator("html")).toHaveClass(/\bradius-pill\b/u);
});

test("a theme changed or deleted after publish leaves the appearance and the logo unchanged", async ({
  page,
}) => {
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.theme;
  const { teal, crimson } = fixtures.looks;
  const theme = await createThemeWithLogo(fixtures, `Portal ${String(Date.now())}`, teal);
  await publishAppearance(
    fixtures,
    formId,
    appearanceOf(teal, {
      palettes: theme.palettes,
      logo: theme.logoKey,
      face: theme.face,
      corners: theme.corners,
      pageTint: theme.pageTint,
    }),
  );

  await pin(page, { [MODE_COOKIE]: "light" });
  const started = await startSession(page, slug);
  await expectPalette(page, theme.palettes["light"] ?? {}, "applied theme");
  await expectLogoLoaded(page, theme.logoKey);

  const path = `/workspaces/${fixtures.workspaceId}/themes/${theme.themeId}`;
  const changed = await admin(fixtures, "PUT", path, {
    name: "Changed",
    palettes: crimson.palettes,
    face: "system",
    corners: "sharp",
    pageTint: false,
    logoKey: null,
  });
  expect(changed.status, await changed.clone().text()).toBe(200);
  const deleted = await admin(fixtures, "DELETE", path);
  expect(deleted.status).toBe(204);

  await page.goto(started);
  await expectPalette(page, theme.palettes["light"] ?? {}, "after the theme changed and went");
  await expect(page.locator("html")).toHaveClass(/\bradius-pill\b/u);
  await expectLogoLoaded(page, theme.logoKey);

  await startSession(page, slug);
  await expectPalette(page, theme.palettes["light"] ?? {}, "a new session on the same version");
  await expectLogoLoaded(page, theme.logoKey);
});

test("a themed page passes axe in light, dark and high contrast, and yields to forced colours", async ({
  page,
}) => {
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.axe;
  await publishAppearance(fixtures, formId, appearanceOf(fixtures.looks.crimson));

  await pin(page, { [MODE_COOKIE]: "light" });
  await startSession(page, slug);
  await expect(page.locator("html")).toHaveAttribute(CARRIER, "");
  await expectNoAxeViolations(page, "light");

  for (const mode of ["dark", "hc"] as const) {
    await pin(page, { [MODE_COOKIE]: mode });
    await page.reload();
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${mode}\\b`, "u"));
    await expectNoAxeViolations(page, mode);
  }

  await page.emulateMedia({ forcedColors: "active" });
  await page.reload();
  const [canvas, canvasText] = await page.evaluate(() => {
    const probe = document.createElement("div");
    document.documentElement.append(probe);
    probe.style.backgroundColor = "Canvas";
    probe.style.color = "CanvasText";
    const style = getComputedStyle(probe);
    const read = [style.backgroundColor, style.color];
    probe.remove();
    return read;
  });
  await expect(page.locator("body")).toHaveCSS("background-color", canvas ?? "");
  await expect(page.locator("body")).toHaveCSS("color", canvasText ?? "");
});

test("a form with an appearance but no logo shows none, keeping the brand name", async ({
  page,
}) => {
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.noLogo;
  await publishAppearance(fixtures, formId, appearanceOf(fixtures.looks.teal, { logo: null }));

  await startSession(page, slug);
  await expect(page.locator("html")).toHaveAttribute(CARRIER, "");
  const mark = page.getByTestId("brand-mark");
  await expect(mark).toBeVisible();
  await expect(mark.locator("img")).toHaveCount(0);
  await expect(mark).toHaveText(HARNESS_BRAND_NAME);
});

test("a form face the deployment does not offer applies, and the font menu shows it", async ({
  page,
}) => {
  expect(HARNESS_FONTS).not.toContain(UNOFFERED_FACE);
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.face;
  await publishAppearance(
    fixtures,
    formId,
    appearanceOf(fixtures.looks.teal, { face: UNOFFERED_FACE }),
  );

  await startSession(page, slug);
  await expect(page.locator("html")).toHaveClass(UNOFFERED_CLASS);
  await expect(page.getByTestId("appearance-font")).toHaveValue(UNOFFERED_FACE);

  await page.goto(`/f/${readFixtures().slug}`);
  await expect(
    page.getByTestId("appearance-font").locator(`option[value="${UNOFFERED_FACE}"]`),
  ).toHaveCount(0);
});

test("the completion page keeps the form's appearance", async ({ page }) => {
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.done;
  const look = fixtures.looks.crimson;
  await publishAppearance(fixtures, formId, appearanceOf(look, { corners: "pill" }));

  await pin(page, { [MODE_COOKIE]: "light" });
  await startSession(page, slug);
  await waitForHydration(page);
  await chooseAccident(page, "No");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done$/u);
  await expect(page.getByTestId("content-hash")).toHaveText(/^[0-9a-f]{64}$/u);

  const root = page.locator("html");
  await expect(root).toHaveAttribute(CARRIER, "");
  await expect(root).toHaveClass(/\bradius-pill\b/u);
  await expectPalette(page, look.palettes["light"] ?? {}, "completion page");
});

test("a logo taken down after publish is hidden rather than drawn broken", async ({ page }) => {
  const { formAppearance: fixtures } = readFixtures();
  const { formId, slug } = fixtures.forms.takedown;
  const { teal } = fixtures.looks;
  const theme = await createThemeWithLogo(
    fixtures,
    `Takedown ${String(Date.now())}`,
    teal,
    solidPng([Date.now() % 251, Math.floor(Date.now() / 251) % 251, 7]),
  );
  await publishAppearance(fixtures, formId, appearanceOf(teal, { logo: theme.logoKey }));

  const started = await startSession(page, slug);
  await expectLogoLoaded(page, theme.logoKey);

  await takeDownLogo(fixtures, theme.logoKey);
  await page.goto(started);
  await expect(page.getByTestId("step-card")).toBeVisible();
  const mark = page.getByTestId("brand-mark");
  await expect(mark.locator("img")).toHaveCount(0);
  await expect(mark).toHaveText(HARNESS_BRAND_NAME);
  await expectPalette(page, teal.palettes["light"] ?? {}, "after the takedown");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the served page already carries the form's appearance", async ({ page }) => {
    const { formAppearance: fixtures } = readFixtures();
    const { formId, slug } = fixtures.forms.noJs;
    const look = fixtures.looks.teal;
    await publishAppearance(fixtures, formId, appearanceOf(look, { corners: "pill" }));

    await pin(page, { [MODE_COOKIE]: "dark" });
    await startSession(page, slug);
    const root = page.locator("html");
    await expect(root).toHaveAttribute(CARRIER, "");
    await expect(root).toHaveClass(/\bdark\b/u);
    await expect(root).toHaveClass(/\bradius-pill\b/u);
    await expectPalette(page, look.palettes["dark"] ?? {}, "no-JS dark");
  });

  test("a mode change keeps a form face the deployment does not offer", async ({ page }) => {
    const { formAppearance: fixtures } = readFixtures();
    const { formId, slug } = fixtures.forms.faceNoJs;
    await publishAppearance(
      fixtures,
      formId,
      appearanceOf(fixtures.looks.teal, { face: UNOFFERED_FACE }),
    );

    await pin(page, { [MODE_COOKIE]: "light" });
    await startSession(page, slug);
    const font = page.getByTestId("appearance-font");
    await expect(font).toHaveValue(UNOFFERED_FACE);

    await page.locator('[data-testid="appearance"] > summary').click();
    await page.locator('[data-testid="appearance-mode"] label[data-value="dark"]').click();
    const served = page.waitForResponse(
      (response) => response.request().isNavigationRequest() && response.status() === 200,
    );
    await page.locator("button.qcms-appearance__apply").click();
    await served;

    const root = page.locator("html");
    await expect(root).toHaveClass(/\bdark\b/u);
    await expect(root).toHaveClass(UNOFFERED_CLASS);
    await expect(font).toHaveValue(UNOFFERED_FACE);

    // Only the axis that changed is saved, so the form's face and density follow no
    // respondent to another form.
    const saved = (await page.context().cookies())
      .filter((cookie) => cookie.name.startsWith("qcms-"))
      .map((cookie) => cookie.name);
    expect(saved).toEqual([MODE_COOKIE]);
    await page.goto(`/f/${readFixtures().slug}`);
    await expect(root).not.toHaveClass(UNOFFERED_CLASS);
  });
});
