/**
 * Reading the generated template tree (task 037).
 *
 * The tree has two levels: `common/` is always stamped and `<shape>/` is layered on
 * top of it, so a deployment shape adds files and may replace one, and the difference
 * between the shapes is readable as a directory listing rather than as branches in
 * code.
 *
 * Two path conventions, both applied here so nothing downstream has to know them:
 *
 *   - a leading `_` on a basename becomes a leading `.` (npm strips `.gitignore` and
 *     `.npmrc` from a published tarball whatever `files` says, which would silently
 *     delete the files a scaffolder exists to write)
 *   - a trailing `.tmpl` marks a file that carries placeholders, and is removed
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import type { DeploymentShape } from "./options.js";

/**
 * The template root, resolved from this module.
 *
 * `dist/templates.js` and `src/templates.ts` are both exactly one directory below the
 * package root, so one expression serves the built CLI and the tests.
 */
export const TEMPLATE_ROOT = fileURLToPath(new URL("../templates/", import.meta.url));

/** One file to stamp. */
export interface TemplateFile {
  /** Path relative to the scaffold root, with `_` and `.tmpl` already resolved. */
  readonly output: string;
  /** Absolute path of the template it comes from. */
  readonly source: string;
  /** Whether the contents carry `{{placeholders}}`. */
  readonly rendered: boolean;
}

/** Template path to scaffold path: `_gitignore` to `.gitignore`, `x.tmpl` to `x`. */
export function outputPath(templateRelative: string): { path: string; rendered: boolean } {
  const segments = templateRelative.split("/");
  const last = segments.length - 1;
  let basename = segments[last] ?? "";
  const rendered = basename.endsWith(".tmpl");
  if (rendered) basename = basename.slice(0, -".tmpl".length);
  if (basename.startsWith("_")) basename = `.${basename.slice(1)}`;
  segments[last] = basename;
  return { path: segments.join("/"), rendered };
}

function walk(root: string, prefix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : posix.join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...walk(root, relative));
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

/**
 * Every file this shape stamps, `common` first and the shape overlay on top.
 *
 * Returned as a Map keyed by output path, so an overlay file replacing a common one
 * is a plain overwrite rather than a rule anyone has to remember.
 */
export function templateFiles(
  shape: DeploymentShape,
  root: string = TEMPLATE_ROOT,
): ReadonlyMap<string, TemplateFile> {
  const files = new Map<string, TemplateFile>();
  for (const layer of ["common", shape]) {
    for (const relative of walk(root, layer).sort()) {
      const withoutLayer = relative.slice(`${layer}/`.length);
      const { path, rendered } = outputPath(withoutLayer);
      files.set(path, { output: path, source: join(root, ...relative.split("/")), rendered });
    }
  }
  return files;
}

/** Read one template's contents. */
export function readTemplate(file: TemplateFile): string {
  return readFileSync(file.source, "utf8");
}
