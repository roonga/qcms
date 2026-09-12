#!/usr/bin/env node
// @ts-check
/**
 * One font fallback stack, written down once (issue #27).
 *
 * A fallback stack is the whole answer to a question nobody sees until it goes
 * wrong: what does a respondent read when the primary face is missing, refused, or
 * still downloading? It is invisible on every machine that HAS the face, which is
 * every machine the author is testing on, so a second copy of the list never looks
 * wrong and never gets corrected. Ten declarations spelled a list out here before this
 * gate, and between them they said SEVEN different things.
 *
 * Every file and line below is cited in the tree this gate landed on, the merge base
 * `a2602be8`, because that is where those ten copies were; at the head the three
 * `font-registry.ts` constants hold token references and sit 20 lines lower.
 *
 * Two sans lists across five sites:
 *
 *   - `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` in
 *     `packages/ui/src/theme.css:69`, again as `SANS_TAIL` in
 *     `packages/ui/src/font-registry.ts:96`, and again as the tail of `--font-admin`
 *     in `apps/admin/app/theme.css:57`;
 *   - `ui-sans-serif, system-ui, sans-serif`, shorter, in
 *     `apps/portal/app/globals.css:89` and `apps/admin/app/globals.css:2531`. Both were
 *     inline `var(--font-portal, ...)` fallbacks, so neither could ever fire: the token
 *     they guard is always declared. The second sat under a comment claiming it matched
 *     the portal's `body` rule "byte for byte" - true of each other, and both differed
 *     from the token they were guarding.
 *
 * Four mono lists, one per site, no two alike:
 *
 *   - `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`
 *     (`MONO_TAIL`, `packages/ui/src/font-registry.ts:98`);
 *   - `ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Consolas, monospace`
 *     (`apps/admin/app/theme.css:58`);
 *   - `ui-monospace, monospace` (`apps/admin/app/globals.css:1678`);
 *   - `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
 *     (`apps/admin/components/forms/condition-json-pane.tsx:222`), in a CodeMirror theme
 *     object, where no sweep of the stylesheets could have seen it.
 *
 * And one serif list, the only one that never had a second copy (`SERIF_TAIL`,
 * `packages/ui/src/font-registry.ts:97`).
 *
 * Seven of the ten are shapes this gate judges - the six stylesheet declarations plus
 * the CodeMirror style object - and `scripts/check-font-tokens.test.ts` holds all seven
 * verbatim as its fixtures. The remaining three are the `font-registry.ts` tails, TS
 * string constants rather than declarations, so the manifest's own suite polices them.
 *
 * So the gate is deliberately not "the CSS looks tidy". It is the property that
 * makes the tail improvable at all: change `--font-fallback-sans` and every surface
 * moves, because there is nowhere else for a stack to hide.
 *
 * THREE RULES.
 *
 * 1. **A `font-family` declaration names a token and nothing else.** `inherit` or a
 *    bare `var(--font-...)`. Not `var(--font-x, a, b)`: an inline fallback on a token
 *    the sheet always declares is unreachable code that reads as a stack. The one
 *    exception is inside `@font-face`, where `font-family` BINDS a name to a file
 *    rather than selecting one.
 * 2. **Only the token sheet writes a family list.** Any other `--font-*` declaration
 *    must END in one of the three tail tokens, so it contributes a family and
 *    inherits the tail: `--font-admin: "Lexend", var(--font-fallback-sans)`. Inside
 *    the token sheet, the three `--font-fallback-*` values are the lists, and every
 *    other `--font-*` there ends in one of them too.
 * 3. **No Tailwind font-family utility that resolves outside the contract.**
 *    `font-sans`, `font-serif`, `font-[...]` and `font-(family-name:...)` reach
 *    Tailwind's own defaults, which is a stack this repository does not own.
 *    `font-mono` is FINE and is used: the token sheet repoints `--font-mono`, which
 *    is the variable that utility reads, so the utility and the token agree by
 *    construction. Inline `fontFamily` in a style object is held to rule 1.
 *
 * WHAT IS SCANNED. Every `.css`, `.ts` and `.tsx` file git knows about under the seven
 * roots in `SCAN_DIRS`, enumerated through `trackedFilesUnder` rather than by walking
 * the directory tree (CONTRIBUTING, issues #635 and #641): a walk enumerates the
 * working directory, where a prior `verify:browser` or `pnpm dev:*` has left `.next`,
 * `.next-dev` and a generated `next-env.d.ts`, and a gate that reads those is asserting
 * a property of the machine. `MINIMUM_SCANNED` below is the companion floor the same
 * rule asks for, so a narrowed scan is a red rather than a vacuous green.
 *
 * WHAT IS NOT SCANNED, AND WHY.
 *   - `packages/ui/src/components/a2ui/` is the byte-for-byte upstream vendor drop
 *     (ADR-22). A gate cannot ask it to change.
 *   - Test files. A string in a test is an assertion about the shipped value, not a
 *     style a browser paints; `theme-tokens.test.ts` and `font-registry.test.ts` are
 *     where the token VALUES are checked.
 *   - `apps/portal/app/adopter-theme.css`, the single documented adopter override
 *     surface (it ships empty). Overriding a tail there is the supported way for a
 *     deployment to add a face for its own audience, so this is the one place a
 *     `--font-fallback-*` declaration is not a second copy but the intended edit.
 *   - `packages/create-qcms-app/templates/`, a byte-for-byte copy of the two apps
 *     that `check:templates` keeps in sync with the originals scanned here.
 *
 * Usage:  node scripts/check-font-tokens.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { stripComments } from "./check-admin-theme.mjs";
import { trackedFilesUnder } from "./tracked-files.mjs";
import { isVendoredSource } from "./vendored-source.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The one sheet allowed to write a font-family list down. */
export const TOKEN_SHEET = "packages/ui/src/theme.css";

/** The tails it declares. Everything else ends in one of these. */
export const TAIL_TOKENS = [
  "--font-fallback-sans",
  "--font-fallback-serif",
  "--font-fallback-mono",
];

/** The documented adopter override surface; see the header. */
const OVERRIDE_SHEET = "apps/portal/app/adopter-theme.css";

/** Everything a browser paints on either surface. */
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

/** A `font-family` value that selects rather than declares: a token, or inherit. */
const TOKEN_VALUE = /^var\(--font-[a-z0-9-]+\)$/iu;

/**
 * Tailwind's font-family utilities that do NOT resolve to a QCMS token.
 * `font-mono` is absent on purpose: `--font-mono` is a token, so that utility is
 * inside the contract. Weight utilities (`font-medium`) are a different namespace
 * and are never matched.
 */
const LOOSE_UTILITY = /\bfont-(?:sans|serif)\b|\bfont-\[|\bfont-\(family-name:/gu;

/** `fontFamily: "..."` in a style object, with its value. */
const INLINE_FAMILY = /\bfontFamily\s*:\s*(?<quote>["'`])(?<value>[^"'`]*)\k<quote>/gu;

/** The 1-based line number of an offset in a source string. */
function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

/**
 * The ranges of every `@font-face` block, as `[open, close]` offsets into the
 * already-comment-stripped CSS. A `font-family` inside one binds a name to a file
 * and is the only literal family name a stylesheet may carry.
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
 * Every declaration of `property` in a stylesheet, as
 * `{ line, value, inFontFace }`. Values are whitespace-normalized, because
 * Prettier reflows a long one onto continuation lines and the content is what is
 * being judged.
 *
 * @param {string} css already comment-stripped
 * @param {(name: string) => boolean} matches which property names to collect
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

/** Whether a custom-property value delegates its tail to one of the tail tokens. */
export function endsInTail(value) {
  return TAIL_TOKENS.some(
    (token) => value === `var(${token})` || value.endsWith(`, var(${token})`),
  );
}

/** Rules 1 and 2, against one stylesheet's source. */
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

/** Rules 3 and 1, against one TypeScript source. */
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
 * The lowest number of files this scan may legitimately reach (CONTRIBUTING, "A test
 * that asserts a property of 'every X in the codebase'"): the clause that says each
 * caller "also asserts that its scan reaches something".
 *
 * Without it, the three rules are only as broad as `SCAN_DIRS` and `SCAN_EXTENSIONS`
 * happen to be, and narrowing either - a directory renamed out from under this list,
 * an extension dropped - leaves all three vacuously true with the gate still green.
 * That is the fail-open shape the rule exists to close, and it is the one a gate
 * cannot notice about itself.
 *
 * Set well under the live count (299 files today, across the seven roots) so ordinary
 * churn never touches it. Be clear about what a single number can and cannot catch:
 * no one root and no one extension crosses it. The largest root, `apps/admin/lib`, is
 * 78 files, so dropping it leaves 221; dropping `.tsx` leaves 156; dropping `.ts`
 * leaves exactly 150, which this floor still admits. What the floor catches is the
 * collapse, a scan narrowed to one or two roots (the four smallest together are 84
 * files) or to nothing at all, and `trackedFilesUnder` is the other half of that: it
 * throws on an empty enumeration, and on a root that is not a directory, so a root
 * renamed away without this list being edited is a red of its own. What has no red of
 * its own is a deliberate narrowing of either list, and the loss of a root or an
 * extension that held a real declaration is caught instead by the companion assertion
 * in `check-font-tokens.test.ts`, which pins each of the seven cited files as in scope.
 * Raise this if it ever gets close; do not lower it to make a red go away.
 */
export const MINIMUM_SCANNED = 150;

/**
 * Every file this gate judges, repo-relative and sorted.
 *
 * Enumerated from git rather than walked (CONTRIBUTING, issues #635 and #641): a walk
 * enumerates the WORKING DIRECTORY, so `apps/*\/.next`, `.next-dev` and a generated
 * `next-env.d.ts` read as source, and the gate then asserts a property of the machine
 * rather than of the repository. `trackedFilesUnder` asks
 * `git ls-files --cached --others --exclude-standard`, which is tracked files plus
 * files that are new and not ignored, so a stylesheet added and not yet staged is
 * still in scope and the gate is not defeatable by not staging. It throws on an empty
 * enumeration, which is the other half of the same fail-open story.
 */
export function scannedFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    for (const relative of trackedFilesUnder(`${ROOT}${dir}`)) {
      const path = `${dir}/${relative}`;
      if (!SCAN_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
      // A string in a test is an assertion about the shipped value, not a style a
      // browser paints.
      if (/\.(?:test|spec|pw)\.tsx?$/u.test(path)) continue;
      // ADR-22 keeps the vendor drop byte-for-byte upstream; a gate cannot ask it to change.
      if (isVendoredSource(path)) continue;
      files.push(path);
    }
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Run the three rules across the repository, returning a list of problems. */
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

  // The sheet has to actually declare what everything else points at, or every
  // rule above passes while the pages render with no family at all.
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
