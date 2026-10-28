#!/usr/bin/env node
// @ts-check
/**
 * Three rules, so the fallback tail is improvable at all: change `--font-fallback-sans`
 * and every surface moves, because there is nowhere else for a stack to hide.
 *
 * 1. A `font-family` declaration names a token and nothing else. An inline fallback on a
 *    token the sheet always declares is unreachable code that reads as a stack. Inside
 *    `@font-face` the property binds a name to a file instead, so it is exempt.
 * 2. Only the token sheet writes a family list. Every other `--font-*` declaration ends
 *    in one of the three tail tokens, so it contributes a family and inherits the tail.
 * 3. No Tailwind font-family utility that resolves outside the contract. `font-mono` is
 *    fine: the token sheet repoints `--font-mono`, which is what that utility reads.
 *
 * The vendored upstream drop is out of scope because a gate cannot ask it to change
 * (ADR-22), and so are tests, the adopter override surface, and the generated templates.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { stripComments } from "./check-admin-theme.mjs";
import { trackedFilesUnder } from "./tracked-files.mjs";
import { isVendoredSource } from "./vendored-source.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export const TOKEN_SHEET = "packages/ui/src/theme.css";

export const TAIL_TOKENS = [
  "--font-fallback-sans",
  "--font-fallback-serif",
  "--font-fallback-mono",
];

const OVERRIDE_SHEET = "apps/portal/app/adopter-theme.css";

const SCAN_DIRS = [
  "apps/portal/app",
  "apps/portal/components",
  "apps/portal/lib",
  "apps/admin/app",
  "apps/admin/components",
  "apps/admin/lib",
  "packages/ui/src",
];

const SCAN_EXTENSIONS = [".css", ".ts", ".tsx"];

const TOKEN_VALUE = /^var\(--font-[a-z0-9-]+\)$/iu;

/** `font-mono` is absent on purpose: `--font-mono` is a token, so it is in the contract. */
const LOOSE_UTILITY = /\bfont-(?:sans|serif)\b|\bfont-\[|\bfont-\(family-name:/gu;

const INLINE_FAMILY = /\bfontFamily\s*:\s*(?<quote>["'`])(?<value>[^"'`]*)\k<quote>/gu;

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

/**
 * A `font-family` inside `@font-face` binds a name to a file, and is the only literal
 * family name a stylesheet may carry.
 */
export function fontFaceRanges(css) {
  const ranges = [];
  for (let from = 0; ;) {
    const at = css.indexOf("@font-face", from);
    if (at === -1) break;
    const open = css.indexOf("{", at);
    if (open === -1) break;
    const close = css.indexOf("}", open);
    ranges.push([open, close === -1 ? css.length : close]);
    from = close === -1 ? css.length : close + 1;
  }
  return ranges;
}

/**
 * Values are whitespace-normalized, because Prettier reflows a long one onto continuations.
 *
 * @param {string} css
 * @param {(name: string) => boolean} matches
 */
export function declarations(css, matches) {
  const faces = fontFaceRanges(css);
  const found = [];
  for (const match of css.matchAll(/(?<name>[\w-]+)\s*:(?<value>[^;{}]*);/gu)) {
    const name = match.groups?.name ?? "";
    if (!matches(name)) continue;
    const at = match.index;
    found.push({
      name,
      line: lineAt(css, at),
      value: (match.groups?.value ?? "").replaceAll(/\s+/gu, " ").trim(),
      inFontFace: faces.some(([open, close]) => at > open && at < close),
    });
  }
  return found;
}

export function endsInTail(value) {
  return TAIL_TOKENS.some(
    (token) => value === `var(${token})` || value.endsWith(`, var(${token})`),
  );
}

export function checkStylesheet(relative, source) {
  const css = stripComments(source, false);
  const problems = [];

  for (const { line, value, inFontFace } of declarations(css, (name) => name === "font-family")) {
    if (inFontFace || value === "inherit" || TOKEN_VALUE.test(value)) continue;
    problems.push(
      `${relative}:${line}  font-family: ${value}` +
        `  - name a token with no inline fallback, e.g. var(--font-portal) or var(--font-mono)`,
    );
  }

  if (relative === OVERRIDE_SHEET) return problems;

  for (const { name, line, value } of declarations(css, (n) => n.startsWith("--font-"))) {
    const isTail = TAIL_TOKENS.includes(name);
    if (relative === TOKEN_SHEET && isTail) continue;
    if (isTail) {
      problems.push(
        `${relative}:${line}  ${name} is declared outside ${TOKEN_SHEET}` +
          `  - the fallback lists live in that sheet and nowhere else`,
      );
      continue;
    }
    if (endsInTail(value)) continue;
    problems.push(
      `${relative}:${line}  ${name}: ${value}` +
        `  - end the value in var(--font-fallback-sans|serif|mono) instead of restating a stack`,
    );
  }

  return problems;
}

export function checkSource(relative, source) {
  const text = stripComments(source, true);
  const problems = [];

  for (const match of text.matchAll(LOOSE_UTILITY)) {
    problems.push(
      `${relative}:${lineAt(text, match.index)}  Tailwind font utility "${match[0]}"` +
        `  - it resolves to Tailwind's own stack; use font-mono or a var(--font-...) token`,
    );
  }

  for (const match of text.matchAll(INLINE_FAMILY)) {
    const value = (match.groups?.value ?? "").trim();
    if (value === "inherit" || TOKEN_VALUE.test(value)) continue;
    problems.push(
      `${relative}:${lineAt(text, match.index)}  fontFamily: "${value}"` +
        `  - name a token, e.g. "var(--font-mono)"`,
    );
  }

  return problems;
}

/**
 * The floor that keeps a narrowed scan red rather than vacuously green: without it the
 * three rules are only as broad as `SCAN_DIRS` and `SCAN_EXTENSIONS` happen to be. It
 * catches the collapse to one or two roots, not the loss of a single one. Raise it if it
 * ever gets close; never lower it to make a red go away.
 */
export const MINIMUM_SCANNED = 150;

/**
 * Enumerated from git rather than walked: a walk reads build output left in the working
 * directory as source, so the gate would assert a property of the machine. Untracked but
 * unignored files are included, so the gate is not defeatable by not staging.
 */
export function scannedFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    for (const relative of trackedFilesUnder(`${ROOT}${dir}`)) {
      const path = `${dir}/${relative}`;
      if (!SCAN_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
      // A string in a test asserts the shipped value, it is not a style a browser paints.
      if (/\.(?:test|spec|pw)\.tsx?$/u.test(path)) continue;
      // ADR-22 keeps the vendor drop byte-for-byte upstream; a gate cannot ask it to change.
      if (isVendoredSource(path)) continue;
      files.push(path);
    }
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function checkFontTokens() {
  const problems = [];
  const files = scannedFiles();
  for (const relative of files) {
    const source = readFileSync(`${ROOT}${relative}`, "utf8");
    problems.push(
      ...(relative.endsWith(".css")
        ? checkStylesheet(relative, source)
        : checkSource(relative, source)),
    );
  }

  // Fail closed on a scan that has quietly stopped covering the apps.
  if (files.length < MINIMUM_SCANNED) {
    problems.push(
      `the scan reached only ${files.length} files, below the floor of ${MINIMUM_SCANNED}` +
        `  - SCAN_DIRS or SCAN_EXTENSIONS has narrowed, so the rules above are vacuous`,
    );
  }

  // The sheet has to declare what everything else points at, or every rule above passes
  // while the pages render with no family at all.
  const sheet = stripComments(readFileSync(`${ROOT}${TOKEN_SHEET}`, "utf8"), false);
  const declared = declarations(sheet, (name) => name.startsWith("--font-")).map(
    (entry) => entry.name,
  );
  for (const token of [...TAIL_TOKENS, "--font-portal", "--font-mono"]) {
    if (!declared.includes(token)) problems.push(`${TOKEN_SHEET} declares no ${token}`);
  }

  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkFontTokens();
  if (problems.length > 0) {
    console.error("QCMS font token check failed:\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log(
    `QCMS font tokens: ${scannedFiles().length} files scanned, every stack ends in a tail ` +
      `declared once in ${TOKEN_SHEET}.`,
  );
}
