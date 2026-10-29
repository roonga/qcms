/**
 * `common/` is always stamped with `<shape>/` layered on top. A leading `_` becomes `.` (npm
 * strips `.gitignore` and `.npmrc` from tarballs); a trailing `.tmpl` marks placeholders.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import type { DeploymentShape } from "./options.js";

/** Both `dist/` and `src/` sit one directory below the package root. */
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
