#!/usr/bin/env node
// @ts-check
/**
 * QCMS app theme gates (task 055, exit criteria 1-3).
 *
 * Three properties that are cheap to state, easy to break by accident in tasks
 * 032-035, and impossible to see in a diff once the app has more than a handful of
 * screens. All three are asserted here rather than by review:
 *
 * 1. **The token sheet is the only source of colour.** Every colour anywhere else in
 *    `apps/admin` must be a `var(--...)` reference. A raw hex, a literal `rgb()`, or
 *    a Tailwind palette utility (`bg-slate-100`) in a component is what silently
 *    ends light/dark/HC support: it looks right in whichever mode the author had
 *    open and is wrong in the other two.
 * 2. **The landed sheet has not drifted from the design.** `apps/admin/app/theme.css`
 *    is a copy of `plan/admin-theme/tokens.css`, which is generated with a WCAG
 *    contrast gate (`plan/admin-theme/build.mjs`). A hand-edit here would keep the
 *    published contrast table but lose the property it certifies, so the two files
 *    are compared byte for byte.
 * 3. **No user-facing string names this app "admin".** The product is QCMS and the
 *    respondent app is the Portal (Code Owner naming call, 2026-07-30). Code
 *    identifiers - the `apps/admin` directory, the `qcms-admin` package name, import
 *    paths - are deliberately untouched by this, so the check reads the message
 *    catalog's VALUES, which is exactly the set of strings an operator can see.
 *
 * Usage:  node scripts/check-admin-theme.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The landed token sheet: the one file in the app allowed to write a colour down. */
export const LANDED_SHEET = "apps/admin/app/theme.css";
/** The design copy it is generated into, with the contrast gate around it. */
export const PLAN_SHEET = "plan/admin-theme/tokens.css";
/** The single-locale message catalog: every string an operator can read. */
export const CATALOG = "apps/admin/lib/i18n/en.ts";

/** The app's own styles: everything an operator's browser paints. */
const SCAN_DIRS = ["apps/admin/app", "apps/admin/components"];
const SCAN_EXTENSIONS = [".css", ".ts", ".tsx"];

/**
 * A hex colour, bounded on **both** sides (issue #545).
 *
 * The trailing `\b` was always there, so an element id (`#main-content`) never matched.
 * The leading side was open, and with it the digits-only shorthand: a test named after
 * the issue it covers (`it("covers #513", ...)`) read as a three-digit colour and failed
 * a gate about styling. Every issue number in the 500s is a three-hex-digit lookalike,
 * and naming a test after its issue is a convention this repository uses, so the
 * collision was certain to recur.
 *
 * Two changes close it:
 *
 * 1. A left boundary. A `#` that follows a word character, another `#`, or an entity's
 *    `&` is an id, a fragment or `&#8212;`, never the start of a colour.
 * 2. A digits-only run of three or four characters is an issue reference, not a colour.
 *    Scoped to those two lengths deliberately: `#123456` stays a colour, because nothing
 *    here writes a six-digit issue number and someone does write that grey.
 */
const HEX = /(?<![\w#&])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8}|(?!\d{3,4}\b)[0-9a-fA-F]{3,4})\b/g;

/**
 * The colour functions. A call is allowed when its argument list reaches a token,
 * which is how the sheet's own composed values are written
 * (`hsl(var(--shadow-color) / 0.06)`,
 * `color-mix(in srgb, var(--color-background) 88%, transparent)`): those carry no
 * colour of their own, they shape one that came from the sheet.
 */
const COLOUR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"];

/** Tailwind's built-in palette, reachable through any of its colour utility prefixes. */
const TAILWIND_PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const TAILWIND_PREFIX =
  "bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|accent|caret|divide|shadow|placeholder";
const TAILWIND_COLOUR = new RegExp(
  `\\b(?:${TAILWIND_PREFIX})-(?:${TAILWIND_PALETTE})(?:-\\d{2,3})?\\b`,
  "g",
);

/**
 * Blank out comments, keeping every newline so reported line numbers still point at
 * the source. Comments are excluded from both scans on purpose: a comment explaining
 * a colour, or citing an issue number that happens to read as one (`issue #177`), is
 * not a style and not a string an operator sees.
 */
export function stripComments(text, includeLineComments) {
  const blank = (match) => "\n".repeat((match.match(/\n/g) ?? []).length);
  const withoutBlocks = text.replaceAll(/\/\*[\s\S]*?\*\//g, blank);
  return includeLineComments
    ? withoutBlocks.replaceAll(/(^|[^:])\/\/[^\n]*/g, "$1")
    : withoutBlocks;
}

/** The text between an already-opened `(` at `start` and its matching `)`. */
function balanced(line, start) {
  let depth = 1;
  for (let i = start; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")" && --depth === 0) return line.slice(start, i);
  }
  return line.slice(start);
}

/** Every colour-function call in one line that does NOT reach a `var(--...)` token. */
export function literalColourFunctions(line) {
  const found = [];
  for (const name of COLOUR_FUNCTIONS) {
    let from = 0;
    for (;;) {
      const at = line.indexOf(`${name}(`, from);
      if (at === -1) break;
      from = at + name.length + 1;
      // Only a whole word: `to-rgb(` is not `rgb(`, and neither is `--brand-hsl(`.
      const before = at === 0 ? "" : line[at - 1];
      if (before !== "" && /[\w-]/.test(before)) continue;
      const args = balanced(line, from);
      if (!args.includes("var(--")) found.push(`${name}(${args})`);
    }
  }
  return found;
}

/**
 * Every literal colour in one file's already-comment-stripped source, as
 * `{ line, hit }` records.
 */
export function findLiteralColours(text) {
  return text
    .split("\n")
    .flatMap((line, index) =>
      [
        ...(line.match(HEX) ?? []),
        ...(line.match(TAILWIND_COLOUR) ?? []),
        ...literalColourFunctions(line),
      ].map((hit) => ({ line: index + 1, hit })),
    );
}

/**
 * Every quoted VALUE in the catalog, with keys and comments excluded.
 *
 * Keys are excluded because they are identifiers, not text: `questions.empty.title` is
 * never read aloud. Comments are excluded because they are for the next author -
 * the catalog's own header describes the app by its directory name, which is correct
 * and must not fail a gate about what an operator sees. A string is a key when the
 * next non-space character after it is a colon; otherwise it is a value.
 */
export function catalogValues(source) {
  const stripped = stripComments(source, true);
  const values = [];
  for (const match of stripped.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    if (/^\s*:/.test(stripped.slice(match.index + match[0].length))) continue;
    values.push({ text: match[1] ?? "", line: stripped.slice(0, match.index).split("\n").length });
  }
  return values;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(`${ROOT}${dir}`)) {
    const relative = `${dir}/${entry}`;
    if (statSync(`${ROOT}${relative}`).isDirectory()) out.push(...walk(relative));
    else if (SCAN_EXTENSIONS.some((extension) => entry.endsWith(extension))) out.push(relative);
  }
  return out;
}

/** Run all three checks against the repository, returning a list of problems. */
export function checkAdminTheme() {
  const problems = [];

  for (const relative of SCAN_DIRS.flatMap(walk)) {
    if (relative === LANDED_SHEET) continue;
    const source = stripComments(
      readFileSync(`${ROOT}${relative}`, "utf8"),
      !relative.endsWith(".css"),
    );
    for (const { line, hit } of findLiteralColours(source)) {
      problems.push(
        `${relative}:${line}  literal colour "${hit}" - use a var(--...) token from ${LANDED_SHEET}`,
      );
    }
  }

  if (
    readFileSync(`${ROOT}${LANDED_SHEET}`, "utf8") !== readFileSync(`${ROOT}${PLAN_SHEET}`, "utf8")
  ) {
    problems.push(
      `${LANDED_SHEET} has drifted from ${PLAN_SHEET}. The sheet is generated with a ` +
        `WCAG contrast gate: change the design in plan/admin-theme/build.mjs, run ` +
        `\`node build.mjs\` there, and copy the result back.`,
    );
  }

  for (const { text, line } of catalogValues(readFileSync(`${ROOT}${CATALOG}`, "utf8"))) {
    if (/admin/i.test(text)) {
      problems.push(
        `${CATALOG}:${line}  user-facing string names this app "admin": ${JSON.stringify(text)}`,
      );
    }
  }

  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkAdminTheme();
  if (problems.length > 0) {
    console.error("QCMS app theme check failed:\n");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log('QCMS app theme: tokens-only, sheet in sync, no user-facing "admin".');
}
