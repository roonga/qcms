#!/usr/bin/env node
// @ts-check
/**
 * One direction only: "referenced, never defined" is already a type error. A reference is any string
 * literal equal to, or a prefix of, a key in the catalog's app outside tests; a key asserted only by
 * a test is dead. An unreadable shape fails closed: name the key in `ALLOWED` with the reason.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { trackedFilesUnder } from "./tracked-files.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * An entry claims a key is rendered through a shape the scan cannot read, carries its
 * reason, and is pinned to one catalog.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
export const ALLOWED = {
  "apps/admin": {
    // The card renders `t(step.card.titleKey)` and each consequence key the step carries,
    // and those keys are named by the API's action-kind descriptors rather than by any
    // literal here. `actions/registry.test.ts` pins each descriptor's keys to its kind.
    "agent.card.form.publish.title": "named by the form.publish action-kind descriptor",
    "agent.card.form.publish.consequence": "named by the form.publish action-kind descriptor",
    "agent.card.form.release.title": "named by the form.release action-kind descriptor",
    "agent.card.form.release.consequence": "named by the form.release action-kind descriptor",
    "agent.card.link.mint.title": "named by the link.mint action-kind descriptor",
    "agent.card.link.mint.consequence": "named by the link.mint action-kind descriptor",
    "agent.card.link.revoke.title": "named by the link.revoke action-kind descriptor",
    "agent.card.link.revoke.consequence": "named by the link.revoke action-kind descriptor",
  },
};

/**
 * The generated template tree is excluded by construction: it is a byte-for-byte copy of
 * `apps/**`, so scanning it would double every catalog.
 */
const ROOTS = ["apps", "packages"];

/**
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
 * Syntax only: no `ts.Program` and no type checker, so this costs a parse per file rather
 * than a whole-program typecheck.
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
 * Recognised structurally, by the shape both apps share, rather than by path, so a third
 * app's catalog is in scope on the day it lands wherever it is put.
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
 * The static spans matter as much as the literals: an assembled key has no string literal
 * in it at all, and its template head is the only evidence the keys under it are reachable.
 *
 * Nodes inside `skip` are not read, so a catalog does not keep its own keys alive.
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
 * A prefix must contain a `.` and be at least three characters, which separates an
 * assembled key from an unrelated short string that happens to open the same way.
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
 * A catalog's references are looked for in its own app only: the apps never import each
 * other, so a key named in a sibling tree is a coincidence rather than a reference.
 *
 * @param {string} path
 * @returns {string | undefined}
 */
export function ownerOf(path) {
  const parts = path.split("/");
  if (parts.length < 3 || !ROOTS.includes(parts[0])) return undefined;
  return `${parts[0]}/${parts[1]}`;
}

/** @returns {string[]} */
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

/** @returns {number} */
export function main() {
  // One survey, read twice: it parses every tracked source file, so surveying again for
  // the totals printed on the success line would double the gate's whole cost.
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

// Only when run as a command, so the test can import the helpers without the scan firing
// and without `process.exit` killing the run.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  process.exit(main());
}
