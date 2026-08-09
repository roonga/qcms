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

  it("mounts the two form-level renders inside the preview styling seam", () => {
    // Code Owner ruling, 2026-08-02: the preview renders inside a SINGLE container that
    // owns its styling boundary, and nothing in the path assumes it shares the admin's
    // theme context. Task 058 mounts a theme island on that container, so this asserts
    // the boundary exists and is where the renderer hangs off - not that anything themes
    // it, which 034 deliberately does not do.
    for (const path of [
      "components/forms/draft-preview.tsx",
      "components/forms/version-view.tsx",
    ]) {
      const module = files.find((file) => file.path === path);
      expect(module, `${path} should be scanned`).toBeDefined();
      const text = stripComments(module!.text);
      expect(text, `${path} should render inside the seam`).toContain("qcms-preview-surface");
      // One container, not two: a second would make "the styling boundary" ambiguous.
      expect(text.split("qcms-preview-surface").length - 1).toBe(2);
    }
  });

  it("selects no theme or mode for the preview (058 owns that, not 034)", () => {
    // The amendment is explicit that 034 builds the boundary and NOT the switcher. A
    // theme knob reaching the preview would be the overshoot it names, so it is asserted
    // against rather than left to review.
    const forbidden = ["qcms-app-mode", "QCMS_PORTAL_THEME", "portalTheme", "setTheme"];
    for (const path of [
      "components/forms/draft-preview.tsx",
      "components/forms/version-view.tsx",
    ]) {
      const text = stripComments(files.find((file) => file.path === path)?.text ?? "");
      for (const needle of forbidden) {
        expect(text, `${path} must not read ${needle}`).not.toContain(needle);
      }
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
