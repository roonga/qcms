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
 * 1. `A2UIStepRenderer` is imported in exactly one module, and it comes from `@qcms/ui`.
 * 2. Nothing reaches `@a2ra/core` (the renderer engine) directly. Only `@qcms/ui` may.
 * 3. Nothing imports `react-aria-components` directly. The vendored components are
 *    reachable only through `@qcms/ui/kit`, which is ADR-22's single-stack rule stated
 *    as a test.
 * 4. Nothing imports `@qcms/a2ui-compiler`. Compilation happens in the API, which is
 *    what makes preview fidelity structural rather than a version coincidence (see
 *    `components/questions/question-preview.tsx` for the full argument).
 */

const ADMIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCAN_DIRS = ["app", "components", "lib"];

/** The one module allowed to render an A2UI document. */
const PREVIEW_MODULE = "components/questions/question-preview.tsx";

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

  it("renders A2UI in exactly one module", () => {
    expect(modulesMentioning("A2UIStepRenderer")).toEqual([PREVIEW_MODULE]);
  });

  it("takes the renderer from @qcms/ui and nowhere else", () => {
    const preview = files.find((file) => file.path === PREVIEW_MODULE);
    expect(preview, "the preview module should be scanned").toBeDefined();
    expect(preview!.text).toContain('from "@qcms/ui"');
  });

  it("reaches no renderer engine directly", () => {
    expect(modulesMentioning("@a2ra/core")).toEqual([]);
  });

  it("reaches no vendored component except through the kit barrel", () => {
    expect(modulesMentioning("react-aria-components")).toEqual([]);
  });

  it("runs no compiler: the API compiles the preview (R2)", () => {
    expect(modulesMentioning("@qcms/a2ui-compiler")).toEqual([]);
  });
});
