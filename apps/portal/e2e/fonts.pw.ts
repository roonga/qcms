/**
 * The font registry, measured in a real browser (task 052, exit criteria 1+2).
 *
 * `packages/ui/src/font-registry.test.ts` proves the manifest: real `woff2` bytes
 * on disk, a generated stylesheet that cannot drift from the manifest, complete
 * licensing, and one `--font-portal` declaration per entry. None of that proves
 * anything a respondent experiences, because a declared `@font-face` that 404s
 * fails SILENTLY: the browser falls back and the page still looks fine. So every
 * claim here is measured off a live page.
 *
 * 1. **Zero external requests.** Every request the page makes, for the whole
 *    sweep across all 23 entries, is same-origin. This is the assertion that the
 *    self-hosting decision is real: no CDN, nothing for the CSP to allow (SEC-9),
 *    and nothing that can make a deployment or CI depend on a third-party host.
 * 2. **The fonts actually render.** Each family is loaded through the CSS Font
 *    Loading API and then proven to be the face in use two ways: `check()` reports
 *    a matching loaded face, AND a probe string measures a DIFFERENT advance width
 *    than the same string in a deliberately nonexistent family (which resolves to
 *    the UA default). A font that silently fell back would match the nonexistent
 *    family's width exactly.
 * 3. **The WCAG 1.4.12 floors hold under every shipped font**, re-measured from
 *    computed style at default density on body text, the vendored label slot and
 *    the vendored hint slot. Families have different metrics, so a floor holding
 *    for one is not evidence for another - hence the sweep rather than a sample.
 * 4. **Per-deployment config reaches the page.** The harness runs the portal on a
 *    curated subset with a non-default default font (`QCMS_PORTAL_FONT` /
 *    `QCMS_PORTAL_FONTS`), so config -> `<html class>` -> computed `font-family`
 *    -> a real same-origin `woff2` request is proven end to end.
 * 5. **Tabular figures** reach the numeric controls from `--type-numeric`.
 *
 * The mode / theme / font switching here is done by setting the root class, as in
 * `theming.pw.ts`: selection is config-only in this slice and the respondent
 * control is task 053.
 */

import { FONT_REGISTRY, fontClass, SYSTEM_FONT_KEY } from "@qcms/ui/fonts";
import type { Locator, Page } from "@playwright/test";

import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { expect, test } from "./support/gates.js";
import { HARNESS_FONT, HARNESS_FONTS } from "./support/harness-config.js";
import { KS, startKitchenSink } from "./support/kitchen-sink.js";

/** The families that carry a self-hosted webfont (System has none by design). */
const WEBFONTS = FONT_REGISTRY.filter((entry) => entry.family !== null);

/** Every self-hosted face, as `<weight> <family>` for the Font Loading API. */
const FACE_SPECS = WEBFONTS.flatMap((entry) =>
  entry.faces.map((face) => `${face.weight} 16px "${entry.family ?? ""}"`),
);

/** A family name no system can have, so it always resolves to the UA default. */
const NONEXISTENT_FAMILY = "QcmsDefinitelyNotAnInstalledFace";

/** Probe text with ascenders, descenders, round and straight forms, and digits. */
const PROBE = "Handgloves 0123456789 quick brown fox";

/**
 * Collect every request the page makes and return the ones that are NOT
 * same-origin. Attached before the first navigation so the initial document,
 * every chunk and every font is included.
 */
function watchForOffOriginRequests(page: Page, origin: string): () => readonly string[] {
  const offOrigin: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    // `data:` and `blob:` never leave the browser, so they are not external.
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (!url.startsWith(origin)) offOrigin.push(url);
  });
  return () => offOrigin;
}

/** Read one computed property off a locator. */
function computed(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/** Numeric pixel value of a computed property. */
async function px(target: Locator, property: string): Promise<number> {
  return Number.parseFloat(await computed(target, property));
}

/** Select a registry entry by swapping the single root font class. */
async function applyFont(page: Page, key: string, keys: readonly string[]): Promise<void> {
  await page.evaluate(
    ({ next, all }) => {
      const root = document.documentElement;
      for (const className of all) root.classList.remove(className);
      root.classList.add(next);
    },
    { next: fontClass(key), all: keys.map((k) => fontClass(k)) },
  );
}

/**
 * The floors, measured off computed style for whatever font is currently applied.
 * `--type-*` values are the carrier and are font-independent, but the RENDERED
 * result is not obviously so: a family with unusual metrics, or a stylesheet whose
 * font class accidentally carried a size, would show up here and nowhere else.
 */
interface Floors {
  readonly bodySize: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly wordSpacing: number;
  readonly labelSize: number;
  readonly hintSize: number;
}

async function measureFloors(page: Page): Promise<Floors> {
  const body = page.locator("body");
  const bodySize = await px(body, "font-size");
  return {
    bodySize,
    lineHeight: await px(body, "line-height"),
    letterSpacing: await px(body, "letter-spacing"),
    wordSpacing: await px(body, "word-spacing"),
    labelSize: await px(page.locator('label[for]:has-text("Full name")').first(), "font-size"),
    hintSize: await px(page.locator('[slot="description"]').first(), "font-size"),
  };
}

function expectFloors(floors: Floors, label: string): void {
  expect(floors.bodySize, `${label}: body font-size`).toBeGreaterThanOrEqual(16);
  expect(floors.lineHeight, `${label}: line-height`).toBeGreaterThanOrEqual(1.5 * floors.bodySize);
  expect(floors.letterSpacing, `${label}: letter-spacing`).toBeGreaterThanOrEqual(
    0.12 * floors.bodySize,
  );
  expect(floors.wordSpacing, `${label}: word-spacing`).toBeGreaterThanOrEqual(
    0.16 * floors.bodySize,
  );
  expect(floors.labelSize, `${label}: label font-size`).toBeGreaterThanOrEqual(16);
  expect(floors.hintSize, `${label}: hint font-size`).toBeGreaterThanOrEqual(14);
}

test("per-deployment font config reaches the page and the offered subset", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  // Config -> DOM. The harness deliberately configures a NON-default font, so a
  // regression that ignored the config could not pass by accident.
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${fontClass(HARNESS_FONT)}\\b`));

  // DOM -> computed style: the configured entry is the family actually in force.
  const entry = FONT_REGISTRY.find((candidate) => candidate.key === HARNESS_FONT);
  expect(entry, `unknown harness font ${HARNESS_FONT}`).toBeDefined();
  const family = await computed(page.locator("body"), "font-family");
  expect(family.startsWith(`"${entry?.family ?? ""}"`), `computed font-family: ${family}`).toBe(
    true,
  );

  // The curated subset the operator configured is exactly what 053 will offer,
  // with System added back even though the harness config omits it.
  const curated = HARNESS_FONTS.split(/[\s,]+/u).filter((key) => key !== "");
  expect(curated).not.toContain(SYSTEM_FONT_KEY);
  expect([SYSTEM_FONT_KEY, ...curated].every((key) => FONT_REGISTRY.some((e) => e.key === key))).toBe(
    true,
  );
});

test("every shipped font renders, from this origin only, with the 1.4.12 floors intact", async ({
  page,
}, testInfo) => {
  const { kitchenSinkSlug } = readFixtures();
  const baseUrl = testInfo.project.use.baseURL ?? "";
  const offOrigin = watchForOffOriginRequests(page, new URL(baseUrl).origin);

  await startKitchenSink(page, kitchenSinkSlug);

  // Force every declared face to download, then confirm the browser has it. This
  // is the assertion a 404 or a wrong file name fails: `load()` resolves with the
  // faces it managed to load, and `check()` is false when there is none.
  const loaded = await page.evaluate(async (specs) => {
    const results: Array<{ spec: string; ok: boolean }> = [];
    for (const spec of specs) {
      await document.fonts.load(spec, "Handgloves 0123456789");
      results.push({ spec, ok: document.fonts.check(spec) });
    }
    return results;
  }, FACE_SPECS);
  const missing = loaded.filter((result) => !result.ok).map((result) => result.spec);
  expect(missing, `faces the browser could not load: ${missing.join(", ")}`).toEqual([]);
  expect(loaded).toHaveLength(FACE_SPECS.length);

  // Every family really renders as itself: a probe string measured in the family
  // must NOT match the same string in a family that cannot exist (which resolves
  // to the UA default). A silent fallback would produce identical widths.
  const widths = await page.evaluate(
    ({ families, absent, text }) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d context");
      const measure = (family: string): number => {
        context.font = `16px ${family}`;
        return context.measureText(text).width;
      };
      const fallback = measure(`"${absent}"`);
      return {
        fallback,
        byFamily: families.map((family) => ({ family, width: measure(`"${family}"`) })),
      };
    },
    {
      families: WEBFONTS.map((entry) => entry.family ?? ""),
      absent: NONEXISTENT_FAMILY,
      text: PROBE,
    },
  );
  const notRendering = widths.byFamily.filter((row) => row.width === widths.fallback);
  expect(
    notRendering.map((row) => row.family),
    `these families measured identically to the UA fallback (${widths.fallback}px), so they are ` +
      `not actually rendering`,
  ).toEqual([]);

  // The floors, re-measured under EVERY entry including System, at default
  // density. Reported so the numbers in docs/theming.md are observed, not claimed.
  const keys = FONT_REGISTRY.map((entry) => entry.key);
  const table: string[] = [];
  for (const entry of FONT_REGISTRY) {
    await applyFont(page, entry.key, keys);
    const floors = await measureFloors(page);
    expectFloors(floors, entry.key);
    table.push(
      `${entry.key.padEnd(18)} body ${floors.bodySize}px  line-height ${floors.lineHeight}px  ` +
        `letter ${floors.letterSpacing}px  word ${floors.wordSpacing}px  ` +
        `label ${floors.labelSize}px  hint ${floors.hintSize}px`,
    );
    // The applied class is the family in force, for every entry in the sweep.
    const family = await computed(page.locator("body"), "font-family");
    const expected = entry.family === null ? "ui-sans-serif" : `"${entry.family}"`;
    expect(family.startsWith(expected), `${entry.key} computed font-family: ${family}`).toBe(true);
  }
  await testInfo.attach("wcag-1.4.12-floors-per-font.txt", {
    body: table.join("\n"),
    contentType: "text/plain",
  });

  // The whole point of self-hosting: after loading every face of every family and
  // rendering under each one, the page has made no external request at all.
  const external = offOrigin();
  expect(external, `external requests: ${external.join(", ")}`).toEqual([]);

  // ...and it really did fetch the fonts from here, so the assertion above is not
  // vacuously true because nothing was ever requested.
  const fontRequests = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.endsWith(".woff2"))
      .map((entry) => entry.name),
  );
  expect(fontRequests.length, "no woff2 was requested at all").toBeGreaterThanOrEqual(
    FACE_SPECS.length,
  );
  for (const url of fontRequests) {
    expect(url.startsWith(new URL(baseUrl).origin), `off-origin font: ${url}`).toBe(true);
  }
});

test("the accessibility fonts ship a real bold, not a synthesised one", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  // The Accessibility group is the one that ships 400 AND 700, because weight
  // carries legibility there. Prove the 700 file is a distinct face rather than
  // the browser smearing the 400: the bold advance width must differ from the
  // regular's, and both must report as loaded.
  const bolds = FONT_REGISTRY.filter((entry) => entry.faces.length > 1).map(
    (entry) => entry.family ?? "",
  );
  expect(bolds.length, "no family ships a second weight").toBeGreaterThan(0);
  const rows = await page.evaluate(
    async ({ families, text }) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d context");
      const out: Array<{ family: string; regular: number; bold: number; loaded: boolean }> = [];
      for (const family of families) {
        await document.fonts.load(`400 16px "${family}"`, text);
        await document.fonts.load(`700 16px "${family}"`, text);
        context.font = `400 16px "${family}"`;
        const regular = context.measureText(text).width;
        context.font = `700 16px "${family}"`;
        const bold = context.measureText(text).width;
        out.push({ family, regular, bold, loaded: document.fonts.check(`700 16px "${family}"`) });
      }
      return out;
    },
    { families: bolds, text: PROBE },
  );
  for (const row of rows) {
    expect(row.loaded, `${row.family} 700 did not load`).toBe(true);
    expect(row.bold, `${row.family}: bold measured the same as regular`).not.toBe(row.regular);
  }
});

test("numeric controls get tabular figures from --type-numeric", async ({ page }) => {
  const { kitchenSinkSlug, slug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

  // The date field's segments are the numeric control on step 1.
  const segment = page.locator('[data-qcms-field] [role="spinbutton"]').first();
  expect(await computed(segment, "font-feature-settings")).toBe('"tnum"');

  // Prove the TOKEN drives it rather than a hardcoded rule: move the token and
  // the computed value follows (the same discipline theming.pw.ts uses for
  // spacing, and what task 053 relies on if it ever needs to vary the feature).
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--type-numeric", '"tnum" 0'),
  );
  expect(await computed(segment, "font-feature-settings")).toBe('"tnum" 0');

  // And on a real number field, which lives behind a branch on the insurance form.
  await startAnonymousFlow(page, slug);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
  await chooseAccident(page, "Yes");
  const count = page.getByRole("textbox", { name: KS.count });
  await expect(count).toBeVisible();
  expect(await computed(count, "font-feature-settings")).toBe('"tnum"');
});
