import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { settleTransitions } from "@roonga/qcms-e2e-support/animations";

import { DENSITY_COOKIE, FONT_COOKIE, MODE_COOKIE } from "../lib/appearance.js";
import { readFixtures } from "./support/fixtures.js";
import {
  admin,
  appearanceOf,
  createThemeWithLogo,
  publishAppearance,
} from "./support/form-appearance.js";
import { expect, test } from "./support/gates.js";
import { HARNESS_CORNERS, HARNESS_FONT, PORTAL_PORT } from "./support/harness-config.js";

const ORIGIN = `http://localhost:${PORTAL_PORT}`;
const CARRIER = "data-qcms-form-appearance";

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

  // The respondent's own choices still apply over the form's.
  await pin(page, {
    [MODE_COOKIE]: "light",
    [FONT_COOKIE]: "atkinson",
    [DENSITY_COOKIE]: "compact",
  });
  await page.reload();
  await expect(root).toHaveClass(/\bfont-atkinson\b/u);
  await expect(root).toHaveClass(/\bdensity-compact\b/u);
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
});
