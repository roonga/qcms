#!/usr/bin/env node
// @ts-check
/**
 * Is every message key in a catalog referenced by something that renders? (issues #538, #756)
 *
 * ## Why a gate rather than a sweep
 *
 * Issue #538 was filed because two dead keys were found by accident inside one small
 * change, which is an argument that there are more and that nothing would ever find them.
 * PR #755 did the sweep; a sweep does not stay swept. ADR-27 makes the catalog binding
 * rather than incidental, so a key nothing renders is not merely dead weight: it is a
 * sentence a reviewer weighs, a translator would pay for, and a future edit may revive
 * with no idea it was abandoned.
 *
 * ## One direction only, because the other one is already a build error
 *
 * "Key referenced, never defined" - the more serious fault - is caught by the compiler.
 * Both catalogs declare `export const messages = { ... } as const` with
 * `export type MessageKey = keyof typeof messages`, and `t(key: MessageKey, ...)` takes
 * that union, so a key that does not exist is a type error at the call site. #538 asked
 * for that to be checked before building it. It holds, and this gate covers the half the
 * types cannot see.
 *
 * ## AST, because a regex cannot do this one
 *
 * #755 measured the regex version and rejected it: a `t(` + backtick pattern matches
 * `POST(` in a portal test, and reading a key out of source text cannot tell a reference
 * from a mention in a comment or from an absence assertion in a test. This parses with
 * the TypeScript compiler already in the toolchain - no new dependency - and reads only
 * string literals and the static spans of template literals from the syntax tree.
 *
 * ## What counts as a reference
 *
 * Any string literal equal to a key, ANYWHERE in the catalog's own app, outside a test.
 * Deliberately not "an argument to `t()`": keys legitimately travel as values in lookup
 * tables (`apps/admin/lib/forms/errors.ts`), as props typed `MessageKey`, and through
 * `tPlural`, and a gate that modelled each of those routes would be a second, worse copy
 * of the type checker. A literal in scope is the honest lower bound.
 *
 * A literal that is a PREFIX of a key counts too, because a dynamically assembled key is
 * real and common here (`t(`${base}.${variant}`)`). That is a genuine widening: a broad
 * prefix means the gate can no longer see the keys under it. The widening belongs to the
 * code that wrote the broad prefix, not to this check, and narrowing it there is what
 * makes those keys visible again.
 *
 * ## Tests are not references
 *
 * A key rendered by nothing and asserted by a test is dead: the test is measuring the
 * catalog rather than the product. #756 records the case that proves it - a key deleted
 * in #755 that a portal test still named, in an assertion that it is ABSENT.
 *
 * ## The failure direction
 *
 * A shape this gate cannot read fails closed: it reports a key as dead rather than
 * assuming a reference it did not find. A red gate gets looked at; a silent pass does
 * not. If a key really is referenced through a shape not covered here, the fix is to name
 * it in `ALLOWED` below with the reason, never to widen the matcher until nothing fails.
 *
 * Usage: `pnpm check:dead-i18n-keys` (or `node scripts/check-dead-i18n-keys.mjs`)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Keys kept despite having no reference this gate can see.
 *
 * Empty, and meant to stay that way. An entry is a claim that a key is rendered through a
 * shape the scan cannot read; it carries the reason so the claim can be checked, and it is
 * pinned to one catalog so it cannot quietly cover a second one.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const ALLOWED = {};

/**
 * Source trees the scan may enter, relative to the repo root.
 *
 * `packages/create-qcms-app/templates` is excluded by construction: it is a generated
 * byte-for-byte copy of `apps/**` (`pnpm qcms:sync-templates`), so scanning it would
 * double every catalog and report each key twice.
 */
const ROOTS = ["apps", "packages"];

/**
 * A file whose string literals are not references: a test, a fixture, a spec.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isTestFile(path) {
  return (
    /\.test\.tsx?$/.test(path) ||
    /\.pw\.ts$/.test(path) ||
    /\.e2e\.ts$/.test(path) ||
    /(^|\/)e2e\//.test(path) ||
    /(^|\/)vitest\.setup\.ts$/.test(path)
  );
}

/**
 * A TypeScript source file, parsed for syntax only.
 *
 * No `ts.Program` and no type checker: this gate reads string literals out of the syntax
 * tree and nothing more, so it costs a parse per file rather than a whole-program
 * typecheck. Nothing else in `scripts/` imports `typescript`; it is already the
 * toolchain's compiler, so this adds no dependency and no licence surface.
 *
 * @param {string} path
 * @param {string} text
 * @returns {ts.SourceFile}
 */
function parse(path, text) {
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
}

/**
 * The keys a catalog module defines, or `undefined` when the file is not a catalog.
 *
 * A catalog is recognised structurally, by the shape both apps use -
 * `export const messages = { ... } as const` - rather than by its path. A third app's
 * catalog is then in scope on the day it lands, wherever it is put, which is the
 * "scope the check once rather than per-app" half of #538.
 *
 * ADR-11 is the reason the catalogs are flat maps of dotted keys to templates, which is
 * what makes a key a string this scan can look for. It does not prescribe the export
 * name or the `as const`, so the recogniser keys on the convention the two apps share
 * rather than claiming ADR-11 requires it.
 *
 * @param {ts.SourceFile} source
 * @returns {{ keys: string[]; node: ts.ObjectLiteralExpression } | undefined}
 */
export function catalogIn(source) {
  let found;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported !== true) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "messages") continue;
      const initializer = declaration.initializer;
      if (initializer === undefined) continue;
      // `{...} as const` is an AsExpression wrapping the object literal.
      const literal = ts.isAsExpression(initializer) ? initializer.expression : initializer;
      if (!ts.isObjectLiteralExpression(literal)) continue;
      const keys = [];
      for (const property of literal.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = property.name;
        if (ts.isStringLiteral(name)) keys.push(name.text);
      }
      if (keys.length > 0) found = { keys, node: literal };
    }
  }
  return found;
}

/**
 * Every string value a file states literally: plain literals and the static spans of
 * template literals.
 *
 * The static spans matter as much as the literals. `` `ops.status.${s}` `` has no string
 * literal in it at all; its head is a TemplateHead, and that head is the only evidence the
 * keys under `ops.status.` are reachable.
 *
 * Nodes inside `skip` (a catalog's own definition object) are not read, so a catalog does
 * not keep its own keys alive by defining them.
 *
 * @param {ts.SourceFile} source
 * @param {ts.Node | undefined} skip
 * @returns {Set<string>}
 */
export function literalsIn(source, skip) {
  const found = new Set();
  const visit = (node) => {
    if (node === skip) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.add(node.text);
    } else if (ts.isTemplateExpression(node)) {
      found.add(node.head.text);
      for (const span of node.templateSpans) found.add(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/**
 * Does any literal in `literals` reference `key`?
 *
 * Exact first, then prefix. A prefix must contain a `.` and be at least three characters,
 * which is what separates an assembled key from an unrelated short string that happens to
 * open the same way.
 *
 * @param {string} key
 * @param {ReadonlySet<string>} literals
 * @returns {boolean}
 */
export function isReferenced(key, literals) {
  if (literals.has(key)) return true;
  for (const literal of literals) {
    if (literal.length < 3 || !literal.includes(".")) continue;
    if (literal.length < key.length && key.startsWith(literal)) return true;
  }
  return false;
}

/**
 * The app or package a path belongs to (`apps/admin`), or `undefined` for neither.
 *
 * A catalog's references are looked for in its own app only. `apps/*` never import each
 * other and no package imports an app, so a key named in a sibling tree is a coincidence,
 * not a reference.
 *
 * @param {string} path
 * @returns {string | undefined}
 */
export function ownerOf(path) {
  const parts = path.split("/");
  if (parts.length < 3 || !ROOTS.includes(parts[0])) return undefined;
  return `${parts[0]}/${parts[1]}`;
}

/**
 * Every tracked TypeScript source file under the scanned roots, repo-relative.
 *
 * @returns {string[]}
 */
export function scanned() {
  const files = [];
  for (const root of ROOTS) {
    for (const path of trackedFilesUnder(join(REPO_ROOT, root), { match: /\.tsx?$/ })) {
      const full = `${root}/${path}`;
      if (full.startsWith("packages/create-qcms-app/templates/")) continue;
      files.push(full);
    }
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Read the tree once: find the catalogs, and collect each app's non-test literals.
 *
 * @param {readonly string[]} files
 * @returns {{ catalogs: Map<string, { path: string; keys: string[] }>; literals: Map<string, Set<string>> }}
 */
export function survey(files) {
  const catalogs = new Map();
  const literals = new Map();

  for (const file of files) {
    const owner = ownerOf(file);
    if (owner === undefined) continue;
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch {
      continue;
    }
    const source = parse(file, text);
    const catalog = catalogIn(source);
    if (catalog !== undefined) catalogs.set(owner, { path: file, keys: catalog.keys });
    if (isTestFile(file)) continue;
    const bucket = literals.get(owner) ?? new Set();
    for (const value of literalsIn(source, catalog?.node)) bucket.add(value);
    literals.set(owner, bucket);
  }

  return { catalogs, literals };
}

/**
 * Every catalog key with no reference, as `{ owner, catalog, key }` records.
 *
 * The survey is a parameter with a default rather than something this function always
 * performs, so a caller that already holds one (`main`, which needs the catalog totals
 * for its success line) passes it instead of parsing every file in the repository a
 * second time. The default keeps the no-argument call the tests use.
 *
 * @param {ReturnType<typeof survey>} [surveyed]
 * @returns {{ owner: string; catalog: string; key: string }[]}
 */
export function deadKeys(surveyed = survey(scanned())) {
  const { catalogs, literals } = surveyed;
  const dead = [];
  for (const [owner, catalog] of catalogs) {
    const seen = literals.get(owner) ?? new Set();
    for (const key of catalog.keys) {
      if (isReferenced(key, seen)) continue;
      if (Object.hasOwn(ALLOWED[owner] ?? {}, key)) continue;
      dead.push({ owner, catalog: catalog.path, key });
    }
  }
  return dead;
}

/**
 * Run the gate.
 *
 * @returns {number} 0 when every key is referenced, 1 otherwise.
 */
export function main() {
  // One survey, read twice. It parses every tracked `.ts`/`.tsx` under `apps/` and
  // `packages/`, so doing it once for the totals and again for the verdict would double
  // the gate's whole cost for a number printed on the success line.
  const surveyed = survey(scanned());
  const { catalogs } = surveyed;
  const dead = deadKeys(surveyed);
  const total = [...catalogs.values()].reduce((sum, entry) => sum + entry.keys.length, 0);

  if (catalogs.size === 0) {
    console.error(
      "check-dead-i18n-keys: found no message catalog at all. That is a broken scan, not a clean tree.",
    );
    return 1;
  }

  if (dead.length === 0) {
    console.log(
      `check-dead-i18n-keys: OK - every one of ${String(total)} keys across ${String(catalogs.size)} catalogs is referenced.`,
    );
    return 0;
  }

  console.error("check-dead-i18n-keys: catalog key(s) nothing renders:\n");
  for (const entry of dead) console.error(`  ${entry.catalog}  ${entry.key}`);
  console.error(
    [
      "",
      "A key with no consumer is dead weight in a catalog ADR-27 makes binding: it is",
      "copy a reviewer weighs, a translator pays for, and a later edit may revive without",
      "knowing it was abandoned. Delete it, or make the thing that should render it do so.",
      "",
      "References are read from the syntax tree, so a mention in a comment is not one, and",
      "neither is a test: a key asserted by a test and rendered by nothing is dead, and an",
      "absence assertion naming a deleted key is exactly the shape #756 recorded.",
      "",
      "If a key IS rendered through a shape this scan cannot read, add it to ALLOWED in",
      "this script with the reason. Do not widen the matcher until nothing fails.",
    ].join("\n"),
  );
  return 1;
}

// Only when run as a command, so the test file can import the helpers above without the
// scan firing (and without `process.exit` killing the test run).
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
