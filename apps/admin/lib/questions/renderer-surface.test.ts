import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib"];

const RENDERING_MODULES = [
  "components/forms/draft-preview.tsx",
  "components/forms/version-view.tsx",
  "components/questions/question-preview.tsx",
];

const PREVIEW_ISLAND = "components/preview-theme-island.tsx";

const SCOPE_VOCABULARY = "lib/preview-theme.ts";

const LOCALE_VOCABULARY = "components/locale-context.tsx";

const PREVIEW_LOCALE_CONSTANT = "usePreviewLocale";

// Exercise JSX literal and expression spellings: a source guard that misses locale="..." would miss the common case.
const LOCALE_LITERAL = /locale=(?:["']|\{\s*["'])/u;

const LOCALE_LITERAL_SHAPES = {
  caught: [
    'locale="en"',
    "locale='en'",
    'locale={"en"}',
    "locale={'en'}",
    'locale={ "en" }',
    'locale=""',
  ],
  passed: ["locale={previewLocale}", "locale={locale}"],
} as const;

const THEME_SCOPE_ATTRIBUTE = "data-qcms-theme-scope";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(`${ADMIN_ROOT}${dir}`)) {
    const relative = `${dir}/${entry}`;
    if (statSync(`${ADMIN_ROOT}${relative}`).isDirectory()) out.push(...walk(relative));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(relative);
  }
  return out;
}

const files = SCAN_DIRS.flatMap(walk).map((relative) => ({
  path: relative,
  text: readFileSync(`${ADMIN_ROOT}${relative}`, "utf8"),
}));

function modulesMentioning(needle: string): string[] {
  return files
    .filter(({ text }) => stripComments(text).includes(needle))
    .map(({ path }) => path)
    .sort((left, right) => left.localeCompare(right));
}

function stripComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

describe("A2UI rendering surface (exit criterion 3)", () => {
  it("scans a non-trivial set of files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("renders A2UI only in the modules that are supposed to", () => {
    expect(modulesMentioning("A2UIStepRenderer")).toEqual(RENDERING_MODULES);
  });

  it("takes the renderer from @roonga/qcms-ui in every one of them", () => {
    for (const path of RENDERING_MODULES) {
      const module = files.find((file) => file.path === path);
      expect(module, `${path} should be scanned`).toBeDefined();
      expect(module!.text).toContain('from "@roonga/qcms-ui"');
    }
  });

  it("takes the visibility projection from @roonga/qcms-ui too, so the portal shares it", () => {
    const modules = modulesMentioning("documentForVisible");
    expect(modules).toEqual(["components/forms/draft-preview.tsx"]);
    const preview = files.find((file) => file.path === "components/forms/draft-preview.tsx");
    expect(preview!.text).toContain("documentForVisible");
    expect(preview!.text).toContain('from "@roonga/qcms-ui"');
  });

  it("mounts every render inside the one preview styling seam", () => {
    for (const path of RENDERING_MODULES) {
      const module = files.find((file) => file.path === path);
      expect(module, `${path} should be scanned`).toBeDefined();
      const text = stripComments(module!.text);
      expect(text, `${path} should render inside the island`).toContain("PreviewThemeIsland");
      expect(text, `${path} should not hand-roll the seam`).not.toContain("qcms-preview-surface");
    }
    const island = files.find((file) => file.path === PREVIEW_ISLAND);
    expect(island, `${PREVIEW_ISLAND} should be scanned`).toBeDefined();
    const text = stripComments(island!.text);

    expect(text.split("qcms-preview-surface").length - 1).toBe(2);
  });

  it("themes the preview island and nothing else in the app (058)", () => {
    expect(modulesMentioning(THEME_SCOPE_ATTRIBUTE)).toEqual([PREVIEW_ISLAND, SCOPE_VOCABULARY]);

    const island = stripComments(files.find((file) => file.path === PREVIEW_ISLAND)!.text);
    expect(island, "the island should stamp the scope carrier").toContain(THEME_SCOPE_ATTRIBUTE);

    expect(island).toContain("data-theme={theme}");

    expect(island, "the island must not touch the operator's mode").not.toContain("qcms-app-mode");
  });

  it("renders every preview on the one declared locale, from one declaration (906)", () => {
    // The renderer defaults locale silently; assert every source passes the server-resolved preview locale.
    // DOM segment order alone cannot distinguish an explicit locale from a coincidentally matching default.
    for (const path of RENDERING_MODULES) {
      const module = files.find((file) => file.path === path);
      expect(module, `${path} should be scanned`).toBeDefined();
      const text = stripComments(module!.text);
      expect(text, `${path} should read the declared preview locale`).toContain(
        `= ${PREVIEW_LOCALE_CONSTANT}();`,
      );
      expect(text, `${path} should pass it to the renderer`).toContain("locale={previewLocale}");
      expect(text, `${path} should take it from ${LOCALE_VOCABULARY}`).toContain(
        'from "@/components/locale-context"',
      );

      expect(text, `${path} should not spell a locale out`).not.toMatch(LOCALE_LITERAL);
    }

    expect([...modulesMentioning(PREVIEW_LOCALE_CONSTANT)].sort()).toEqual(
      [...RENDERING_MODULES, LOCALE_VOCABULARY].sort(),
    );
  });

  it("catches a locale literal in every shape someone would write one (906)", () => {
    for (const shape of LOCALE_LITERAL_SHAPES.caught) {
      expect(LOCALE_LITERAL.test(shape), `${shape} should be caught`).toBe(true);
    }

    for (const shape of LOCALE_LITERAL_SHAPES.passed) {
      expect(LOCALE_LITERAL.test(shape), `${shape} should be allowed`).toBe(false);
    }
  });

  it("reaches no renderer engine directly", () => {
    expect(modulesMentioning("@a2ra/core")).toEqual([]);
  });

  it("reaches no vendored component except through the kit barrel", () => {
    expect(modulesMentioning("react-aria-components")).toEqual([]);
  });

  it("runs no compiler: the API compiles the preview (R2)", () => {
    expect(modulesMentioning("@roonga/qcms-a2ui-compiler")).toEqual([]);
  });
});
