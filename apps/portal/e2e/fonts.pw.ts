import { writeFileSync } from "node:fs";

import { FONT_REGISTRY, fontClass, SYSTEM_FONT_KEY } from "@roonga/qcms-ui/fonts";
import type { Locator, Page } from "@playwright/test";

import { partitionRequests } from "./support/dev-server-assets.js";
import { families } from "./support/font-families.js";
import { readFixtures } from "./support/fixtures.js";
import { ACCIDENT_LABEL, chooseAccident, startAnonymousFlow } from "./support/flow.js";
import { expect, test } from "./support/gates.js";
import { FONT_FLOORS_PATH, HARNESS_FONT, HARNESS_FONTS } from "./support/harness-config.js";
import { KS, startKitchenSink } from "./support/kitchen-sink.js";
import { walkToCoverStep } from "./support/no-js.js";
import { starveScripts } from "./support/script-starve.js";

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

function firstFamily(computedValue: string): string {
  return (computedValue.split(",")[0] ?? "").trim().replace(/^["']|["']$/gu, "");
}

/** Every `--font-*` token the live page resolved, by name. */
async function fontTokens(page: Page): Promise<Readonly<Record<string, string>>> {
  return page.evaluate((names) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      names.map((name) => [name, style.getPropertyValue(name).replaceAll(/\s+/gu, " ").trim()]),
    );
  }, TOKEN_NAMES);
}

const TOKEN_NAMES = [
  "--font-fallback-sans",
  "--font-fallback-serif",
  "--font-fallback-mono",
  "--font-portal",
  "--font-mono",
];

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

test("the fallback tail is one token, and it is what the page actually resolves", async ({
  page,
}) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  const tokens = await fontTokens(page);
  for (const name of TOKEN_NAMES) {
    expect(tokens[name] ?? "", `${name} did not resolve on the page`).not.toBe("");
  }

  const sans = families(tokens["--font-fallback-sans"] ?? "");
  const mono = families(tokens["--font-fallback-mono"] ?? "");

  expect(sans[0]).toBe("ui-sans-serif");
  expect(sans).toContain("system-ui");
  expect(sans).toContain("sans-serif");
  expect(mono[0]).toBe("ui-monospace");
  expect(mono).toContain("monospace");

  const entry = FONT_REGISTRY.find((candidate) => candidate.key === HARNESS_FONT);
  expect(entry, `unknown harness font ${HARNESS_FONT}`).toBeDefined();
  const body = families(await computed(page.locator("body"), "font-family"));
  expect(body[0], `computed body font-family: ${body.join(", ")}`).toBe(entry?.family ?? "");
  expect(body.slice(1)).toEqual(sans);
  expect(families(tokens["--font-portal"] ?? "")).toEqual(body);

  expect(families(tokens["--font-mono"] ?? "")).toEqual(mono);
  const utility = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "font-mono";
    document.body.append(probe);
    const resolved = getComputedStyle(probe).fontFamily;
    probe.remove();
    return resolved;
  });
  expect(families(utility)).toEqual(mono);
});

test("the submission reference renders in the monospace token, tail and all", async ({ page }) => {
  const { slug } = readFixtures();
  await startAnonymousFlow(page, slug);
  await chooseAccident(page, "No");
  await expect(page.getByTestId("primary-action")).toHaveText("Submit");
  await page.getByTestId("primary-action").click();
  await page.waitForURL(/\/done/);

  const reference = page.getByTestId("content-hash");
  await expect(reference).toHaveText(/^[0-9a-f]{64}$/);
  const tokens = await fontTokens(page);
  expect(families(await computed(reference, "font-family"))).toEqual(
    families(tokens["--font-mono"] ?? ""),
  );
});

test("per-deployment font config reaches the page and the offered subset", async ({ page }) => {
  const { slug } = readFixtures();
  await page.goto(`/f/${slug}`);

  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${fontClass(HARNESS_FONT)}\\b`));

  const entry = FONT_REGISTRY.find((candidate) => candidate.key === HARNESS_FONT);
  expect(entry, `unknown harness font ${HARNESS_FONT}`).toBeDefined();
  const family = await computed(page.locator("body"), "font-family");
  expect(firstFamily(family), `computed font-family: ${family}`).toBe(entry?.family ?? "");

  const curated = HARNESS_FONTS.split(/[\s,]+/u).filter((key) => key !== "");
  expect(curated).not.toContain(SYSTEM_FONT_KEY);
  expect(
    [SYSTEM_FONT_KEY, ...curated].every((key) => FONT_REGISTRY.some((e) => e.key === key)),
  ).toBe(true);
});

test("every shipped font renders, from this origin only, with the 1.4.12 floors intact", async ({
  page,
}, testInfo) => {
  const { kitchenSinkSlug } = readFixtures();
  const baseUrl = testInfo.project.use.baseURL ?? "";
  const offOrigin = watchForOffOriginRequests(page, new URL(baseUrl).origin);

  await startKitchenSink(page, kitchenSinkSlug);

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
    const family = await computed(page.locator("body"), "font-family");
    const expected = entry.family ?? "ui-sans-serif";
    expect(firstFamily(family), `${entry.key} computed font-family: ${family}`).toBe(expected);
  }
  const measured = `${table.join("\n")}\n`;
  await testInfo.attach("wcag-1.4.12-floors-per-font.txt", {
    body: measured,
    contentType: "text/plain",
  });
  writeFileSync(FONT_FLOORS_PATH, measured, "utf8");

  const external = offOrigin();
  expect(external, `external requests: ${external.join(", ")}`).toEqual([]);

  const fontRequests = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.endsWith(".woff2"))
      .map((entry) => entry.name),
  );
  const declared = [...new Set(FONT_REGISTRY.flatMap((e) => e.faces.map((f) => f.file)))];
  const stems = declared.map((file) => file.replace(/\.woff2$/u, ""));
  const { ours, devServer, unexpected } = partitionRequests(fontRequests, (url) =>
    stems.some((stem) => url.includes(`/${stem}.`) || url.endsWith(`/${stem}.woff2`)),
  );
  expect(
    [...new Set(ours)].length,
    `expected all ${declared.length} registry files; requested:\n${[...new Set(fontRequests)].sort().join("\n")}`,
  ).toBe(declared.length);
  expect(
    [...new Set(unexpected)].sort(),
    "woff2 requests that are neither a registry file nor a known dev-server asset",
  ).toEqual([]);
  for (const url of fontRequests) {
    expect(url.startsWith(new URL(baseUrl).origin), `off-origin font: ${url}`).toBe(true);
  }

  writeFileSync(
    FONT_FLOORS_PATH,
    `${measured}\n` +
      `entries swept: ${FONT_REGISTRY.length}\n` +
      `faces declared: ${FACE_SPECS.length}\n` +
      `registry woff2 files requested: ${new Set(ours).size} (declared ${declared.length})\n` +
      `dev-server woff2 requests (Next overlay chrome, issue #193): ${devServer.length}\n` +
      `total woff2 resource entries: ${fontRequests.length}\n` +
      `off-origin requests for the whole sweep: ${external.length}\n`,
    "utf8",
  );
});

test("the accessibility fonts ship a real bold, not a synthesised one", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();
  await startKitchenSink(page, kitchenSinkSlug);

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

  const segment = page.locator('[data-qcms-field] [role="spinbutton"]').first();
  expect(await computed(segment, "font-feature-settings")).toBe('"tnum"');

  await page.evaluate(() =>
    document.documentElement.style.setProperty("--type-numeric", '"tnum" 0'),
  );
  expect(await computed(segment, "font-feature-settings")).toBe('"tnum" 0');

  await startAnonymousFlow(page, slug);
  await expect(page.getByText(ACCIDENT_LABEL)).toBeVisible();
  await chooseAccident(page, "Yes");
  const count = page.getByRole("textbox", { name: KS.count });
  await expect(count).toBeVisible();
  expect(await computed(count, "font-feature-settings")).toBe('"tnum"');
});

test("the no-JS date fallback gets the same tabular figures (issue #920)", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await page.goto(`/f/${kitchenSinkSlug}`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/s\/ses_/);

  const day = page.locator('[data-qcms-field] input[data-qcms-date-part="day"]');
  await expect(day).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this reads the hydrated render",
  ).toBeGreaterThan(0);
  await expect(page.locator('[data-qcms-field] [role="spinbutton"]')).toHaveCount(0);

  expect(await computed(day, "font-feature-settings")).toBe('"tnum"');

  await page.evaluate(() =>
    document.documentElement.style.setProperty("--type-numeric", '"tnum" 0'),
  );
  expect(await computed(day, "font-feature-settings")).toBe('"tnum" 0');
});

test("the no-JS number fallback gets the same tabular figures (issue #18)", async ({ page }) => {
  const { kitchenSinkSlug } = readFixtures();

  const starvation = await starveScripts(page);
  await walkToCoverStep(page, kitchenSinkSlug);

  const km = page.locator('[data-qcms-field] input[type="number"]');
  await expect(km).toBeVisible();
  expect(
    starvation.starvedCount(),
    "the bundle must have been requested and starved, or this reads the hydrated render",
  ).toBeGreaterThan(0);
  await expect(page.locator('[data-qcms-field] input[inputmode="numeric"]')).toHaveCount(0);

  expect(await computed(km, "font-feature-settings")).toBe('"tnum"');

  await page.evaluate(() =>
    document.documentElement.style.setProperty("--type-numeric", '"tnum" 0'),
  );
  expect(await computed(km, "font-feature-settings")).toBe('"tnum" 0');
});
