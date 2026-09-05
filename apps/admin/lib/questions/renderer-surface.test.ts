import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Exit criterion 3: the preview renders through the shared renderer, and there is no
 * second renderer.
 *
 * "No second renderer" is not a thing a screenshot can show and not a thing review
 * reliably catches, because a second renderer never arrives announced. It arrives as a
 * helpful little `switch (node.type)` in a preview component, or as a direct
 * `react-aria-components` import "just for this one control", and by the time anyone
 * notices, admin preview and respondent serving have quietly diverged - which is exactly
 * the property preview exists to guarantee (ARCHITECTURE §6).
 *
 * So the four things that would have to be true for a second one to exist are asserted
 * instead:
 *
 * 1. `A2UIStepRenderer` is imported in exactly one module, and it comes from `@roonga/qcms-ui`.
 * 2. Nothing reaches `@a2ra/core` (the renderer engine) directly. Only `@roonga/qcms-ui` may.
 * 3. Nothing imports `react-aria-components` directly. The vendored components are
 *    reachable only through `@roonga/qcms-ui/kit`, which is ADR-22's single-stack rule stated
 *    as a test.
 * 4. Nothing imports `@roonga/qcms-a2ui-compiler`. Compilation happens in the API, which is
 *    what makes preview fidelity structural rather than a version coincidence (see
 *    `components/questions/question-preview.tsx` for the full argument).
 */

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib"];

/**
 * The modules allowed to render an A2UI document.
 *
 * Three, and each is a different *thing being rendered*, not a different renderer: one
 * question version (032), a compiled draft (034's preview), and a stored published
 * snapshot (034's history view). All three mount the same `A2UIStepRenderer` from
 * `@roonga/qcms-ui`, which is what the assertions below check. Adding a fourth entry here is
 * where review gets to ask why a screen is drawing A2UI.
 */
const RENDERING_MODULES = [
  "components/forms/draft-preview.tsx",
  "components/forms/version-view.tsx",
  "components/questions/question-preview.tsx",
];

/**
 * The one module that owns the preview's styling boundary and the ADR-38 scope carrier
 * (task 058). It renders no A2UI itself - it is the container the three modules above
 * render their step inside - which is why it is not in the list above.
 */
const PREVIEW_ISLAND = "components/preview-theme-island.tsx";

/** The module that writes the carrier's name down once, for the island to stamp. */
const SCOPE_VOCABULARY = "lib/preview-theme.ts";

/** ADR-38's carrier attribute, spelled here so the assertion cannot drift from it. */
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

/** Modules that name a symbol, ignoring the comments that explain why they do not. */
function modulesMentioning(needle: string): string[] {
  return files
    .filter(({ text }) => stripComments(text).includes(needle))
    .map(({ path }) => path)
    .sort((left, right) => left.localeCompare(right));
}

/** Blank out comments, keeping newlines, so a doc comment naming a ban is not a use. */
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
    // The preview drops the questions the flow says are not visible with exactly the
    // function the portal uses. A local reimplementation here would be the one part of
    // the preview free to disagree with what a respondent gets (ARCHITECTURE §6).
    const modules = modulesMentioning("documentForVisible");
    expect(modules).toEqual(["components/forms/draft-preview.tsx"]);
    const preview = files.find((file) => file.path === "components/forms/draft-preview.tsx");
    expect(preview!.text).toContain("documentForVisible");
    expect(preview!.text).toContain('from "@roonga/qcms-ui"');
  });

  it("mounts every render inside the one preview styling seam", () => {
    // Code Owner ruling, 2026-08-02: the preview renders inside a SINGLE container that
    // owns its styling boundary. Task 034 built that container on the two form-level
    // surfaces; task 058 moved its markup into `PreviewThemeIsland` and gave the
    // question preview the same seam, so the boundary is now declared once and mounted
    // three times rather than spelled out per surface.
    //
    // So the assertion moved with it: each rendering module must hang its renderer off
    // the island, and the island must declare exactly one container. It is deliberately
    // NOT relaxed to "somebody somewhere renders a seam" - a second container would make
    // "the styling boundary" ambiguous again, which is the property 034 bought.
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
    // The class and the test id, and nothing else: one container, not two.
    expect(text.split("qcms-preview-surface").length - 1).toBe(2);
  });

  it("themes the preview island and nothing else in the app (058)", () => {
    // THE INVERSE of the guard task 034 carried here.
    //
    // Until 058 this asserted that the preview modules named none of `qcms-app-mode`,
    // `QCMS_PORTAL_THEME`, `portalTheme` or `setTheme`, because 034 built the boundary
    // and explicitly not the switcher. 058 is the task that fills it, so the ban had to
    // be relaxed - and a deleted guard is a check that looks at nothing and passes
    // exactly as loudly as a real one. It is replaced by the property that now matters
    // and is just as easy to break by accident: the scope carrier is on the island and
    // on NOTHING else.
    //
    // That direction is the one worth guarding. ADR-38's attribute makes any element
    // wearing it resolve the whole respondent token set, so a stray copy on a layout, a
    // card or a page wrapper would silently repaint a slice of the authoring app in a
    // respondent theme - a change that looks like a styling accident rather than like
    // the two-surface breach (ADR-26) it would be.
    // Two modules may name it and no others: the island, which stamps it, and the
    // vocabulary module, which is where the string is written down once so the island,
    // the styles and these assertions cannot drift apart. Anything else in `app/`,
    // `components/` or `lib/` naming it is the accident described above.
    expect(modulesMentioning(THEME_SCOPE_ATTRIBUTE)).toEqual([PREVIEW_ISLAND, SCOPE_VOCABULARY]);

    const island = stripComments(files.find((file) => file.path === PREVIEW_ISLAND)!.text);
    expect(island, "the island should stamp the scope carrier").toContain(THEME_SCOPE_ATTRIBUTE);
    // And the theme and mode it selects have to land on that same element, or the
    // attribute is present and inert.
    expect(island).toContain("data-theme={theme}");

    // The app's own mode control stays untouched: the island's selection is ephemeral
    // and per-render, so nothing in it may reach the operator's mode cookie.
    expect(island, "the island must not touch the operator's mode").not.toContain("qcms-app-mode");
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
