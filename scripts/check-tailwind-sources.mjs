#!/usr/bin/env node
// @ts-check
/**
 * Proves that no application module can hold a Tailwind class string Tailwind never
 * looks at (issue #591).
 *
 * ## The failure this exists for
 *
 * Each app's `globals.css` lists the directories Tailwind scans for class names, one
 * `@source` at a time. A class that appears only in a module outside that list compiles to
 * **nothing**: no error, no warning, no missing-file diagnostic. The build succeeds, the
 * typecheck passes, the lint passes, and the element renders unstyled.
 *
 * That is the property worth naming. Every other way of getting a class wrong is loud - a
 * typo shows in the frame, a bad token fails `check:admin-theme`, a bad import fails
 * `tsc` - and this one is silent, so the only thing standing between it and production is
 * somebody happening to look at the right element. It was found in #558 because that change
 * happened to assert a COMPUTED width; the same change applying a class and taking a
 * screenshot would have shipped, and the screenshot would have looked plausible.
 *
 * ## The rule
 *
 * Every tracked JavaScript or TypeScript file in a SUBDIRECTORY of an app is either inside
 * a directory that app's `globals.css` scans, or inside a subdirectory named in
 * {@link OUTSIDE_THE_BUNDLE} with the reason. Files at the app root are out of scope, and
 * that is a deliberate line rather than an oversight: `next.config.ts`, `postcss.config.mjs`,
 * `instrumentation.ts` and `proxy.ts` are build and server-boot entry points that render no
 * markup, and a `@source` entry naming one of them would be noise.
 *
 * ## Why a directory rule rather than a class-shaped-string scan
 *
 * #591 offered a stricter guard: fail when a string that LOOKS like a Tailwind utility
 * appears in an unscanned file. That reads every identifier, comment and message catalogue
 * in the tree through a heuristic, and its false-positive rate is its whole cost - #557
 * already found that Tailwind's own extractor compiles prose ("shrink" in a TSX comment
 * emitted `.shrink`), so a second heuristic over the same text would inherit that noise and
 * add its own. The rule above needs no heuristic at all: it is decidable, it is total over
 * the app's source, and it catches the shape the issue actually took, which is a whole new
 * directory (`lib/`) arriving unlisted.
 *
 * It does NOT decide whether widening a scan is right - #591 leaves that trade open. It
 * decides that the choice is made, by somebody, in the diff that adds the directory.
 *
 * Usage: node scripts/check-tailwind-sources.mjs
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The stylesheet that carries an app's `@source` list, relative to the app. */
const STYLESHEET = "app/globals.css";

/** What Tailwind is asked to scan for class strings: source, not data, not markup. */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * App subdirectories that legitimately sit outside every `@source` root, with the reason.
 *
 * One entry, and it should stay small: each one is a directory in which a class string
 * silently does nothing, so the reason has to be that no class string can be there.
 */
const OUTSIDE_THE_BUNDLE = {
  e2e: "Playwright specs and their support. They drive the app from the outside and are never bundled into it, so no class string here reaches a rendered page.",
};

/**
 * The `@source` roots one stylesheet declares, as paths relative to the repository root.
 *
 * Tailwind v4 also accepts `@source not "..."` and `@source inline(...)`, which mean
 * different things and which this gate does not model. Rather than skip a directive it does
 * not understand - which would let a narrowing `@source not` pass unseen - it refuses,
 * naming the line. A gate that quietly ignores what it cannot read is the failure mode this
 * whole file exists to remove.
 *
 * @param {string} css
 * @param {string} cssPath Repo-relative path of the stylesheet, for the resolution base.
 * @returns {string[]}
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

/**
 * Whether `file` lies inside `root`, both repo-relative and slash-separated.
 *
 * A prefix comparison on directory boundaries, so `lib` never matches `library`.
 *
 * @param {string} file
 * @param {string} root
 * @returns {boolean}
 */
function isInside(file, root) {
  return file === root || file.startsWith(`${root}/`);
}

/**
 * Every app that carries its own Tailwind entry stylesheet.
 *
 * Discovered rather than listed, so a third app is covered on the day it is created.
 *
 * @returns {string[]} repo-relative app directories, e.g. `apps/admin`.
 */
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

/**
 * The unscanned source files of one app.
 *
 * @param {string} app Repo-relative app directory.
 * @returns {{ roots: string[]; missingRoots: string[]; unscanned: string[] }}
 */
export function auditApp(app) {
  const cssPath = `${app}/${STYLESHEET}`;
  const css = readFileSync(path.join(REPO_ROOT, cssPath), "utf8");
  const roots = sourceRootsIn(css, cssPath);

  // A root that names nothing is a rule nobody has re-read since the directory moved, and
  // it makes the list below look broader than it is. Same check `check-lint-coverage`
  // makes over its lint targets, for the same reason.
  const missingRoots = roots.filter((root) => {
    const absolute = path.join(REPO_ROOT, root);
    return !existsSync(absolute) || !statSync(absolute).isDirectory();
  });

  const unscanned = [];
  for (const relative of trackedFilesUnder(path.join(REPO_ROOT, app), { match: SOURCE_FILE })) {
    const parts = relative.split("/");
    // Files at the app root are build and boot entry points, never markup. See the header.
    if (parts.length < 2) continue;
    if (Object.hasOwn(OUTSIDE_THE_BUNDLE, parts[0] ?? "")) continue;
    const file = `${app}/${relative}`;
    if (!roots.some((root) => isInside(file, root))) unscanned.push(file);
  }

  return { roots, missingRoots, unscanned };
}

/** @returns {number} process exit code */
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

// Only when run as a command, so the test can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
