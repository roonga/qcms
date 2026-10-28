#!/usr/bin/env node
// @ts-check
/**
 * A Tailwind class in a module outside every `@source` root of the app's `globals.css`
 * compiles to nothing, with no error from the build, the typecheck or the lint: the
 * element simply renders unstyled. Nothing else makes that visible.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

const STYLESHEET = "app/globals.css";

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/** An entry is only admissible when no class string can occur in that directory. */
const OUTSIDE_THE_BUNDLE = {
  e2e: "Playwright specs and their support. They drive the app from the outside and are never bundled into it, so no class string here reaches a rendered page.",
};

/**
 * Refuses rather than skips an unmodelled directive: silently ignoring `@source not`
 * would let a narrowing pass unseen.
 */
export function sourceRootsIn(css, cssPath) {
  const roots = [];
  const base = path.posix.dirname(cssPath);
  for (const line of css.split("\n")) {
    const directive = line.trim();
    if (!directive.startsWith("@source")) continue;
    const simple = /^@source\s+"([^"]+)"\s*;?$/.exec(directive);
    if (simple === null) {
      throw new Error(
        `${cssPath}: cannot read this @source directive, so it is refused rather than ` +
          `ignored:\n  ${directive}\n` +
          'Only `@source "path";` is modelled here. Teach this gate the new form ' +
          "(scripts/check-tailwind-sources.mjs) before landing it.",
      );
    }
    roots.push(path.posix.normalize(path.posix.join(base, simple[1] ?? "")));
  }
  return roots;
}

function isInside(file, root) {
  return file === root || file.startsWith(`${root}/`);
}

export function appsWithStylesheets() {
  const appsRoot = path.join(REPO_ROOT, "apps");
  const found = new Set();
  for (const file of trackedFilesUnder(appsRoot)) {
    const parts = file.split("/");
    const app = parts[0];
    if (app === undefined) continue;
    if (parts.slice(1).join("/") === STYLESHEET) found.add(`apps/${app}`);
  }
  return [...found].sort();
}

export function auditApp(app) {
  const cssPath = `${app}/${STYLESHEET}`;
  const css = readFileSync(path.join(REPO_ROOT, cssPath), "utf8");
  const roots = sourceRootsIn(css, cssPath);

  // A root that names nothing makes the scan look broader than it is.
  const missingRoots = roots.filter((root) => {
    const absolute = path.join(REPO_ROOT, root);
    return !existsSync(absolute) || !statSync(absolute).isDirectory();
  });

  const unscanned = [];
  for (const relative of trackedFilesUnder(path.join(REPO_ROOT, app), { match: SOURCE_FILE })) {
    const parts = relative.split("/");
    // Files at the app root are build and boot entry points, never markup.
    if (parts.length < 2) continue;
    if (Object.hasOwn(OUTSIDE_THE_BUNDLE, parts[0] ?? "")) continue;
    const file = `${app}/${relative}`;
    if (!roots.some((root) => isInside(file, root))) unscanned.push(file);
  }

  return { roots, missingRoots, unscanned };
}

function main() {
  const apps = appsWithStylesheets();
  if (apps.length === 0) {
    console.error(`check-tailwind-sources: no app declares ${STYLESHEET}; nothing was checked.`);
    return 1;
  }

  let scanned = 0;
  let failed = false;
  for (const app of apps) {
    const { roots, missingRoots, unscanned } = auditApp(app);
    scanned += roots.length;

    if (missingRoots.length > 0) {
      failed = true;
      console.error(
        `check-tailwind-sources: ${app}/${STYLESHEET} scans a path that does not exist:`,
      );
      for (const root of missingRoots) console.error(`  @source "${root}"`);
      console.error("");
    }

    if (unscanned.length > 0) {
      failed = true;
      console.error(`check-tailwind-sources: ${app} source file(s) outside every @source root:\n`);
      for (const file of unscanned.slice(0, 50)) console.error(`  ${file}`);
      if (unscanned.length > 50) console.error(`  ... and ${String(unscanned.length - 50)} more`);
      console.error(
        [
          "",
          "A Tailwind class named only in one of these compiles to nothing: no error, no",
          "warning, and an element that renders unstyled. Either add the directory to",
          `${app}/${STYLESHEET}:`,
          "",
          ...[...new Set(unscanned.map((file) => file.split("/")[2]))].map(
            (dir) => `      @source "../${String(dir)}";`,
          ),
          "",
          "or, if no class string can ever live there, add it to OUTSIDE_THE_BUNDLE in",
          "scripts/check-tailwind-sources.mjs with the reason.",
          "",
        ].join("\n"),
      );
    }
  }

  if (failed) return 1;
  console.log(
    `check-tailwind-sources: OK - ${String(apps.length)} app stylesheet(s), ` +
      `${String(scanned)} @source root(s), every bundled source file inside one.`,
  );
  return 0;
}

// Guarded so an importing test triggers neither the scan nor the `process.exit`.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
