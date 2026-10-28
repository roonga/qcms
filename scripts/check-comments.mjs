#!/usr/bin/env node
// @ts-check
/**
 * Mechanical half of the code comments rule in `PROJECT_INSTRUCTIONS.md`: comment length
 * and history markers. Whether a comment restates the code is left to review.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { VENDORED_SOURCE_PREFIX } from "./vendored-source.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const GIT = process.platform === "win32" ? "git.exe" : "git";

export const MAX_COMMENT_LINES = 3;
export const MAX_EXPORT_JSDOC_LINES = 4;

export const SOURCE_ROOTS = ["apps", "packages", "scripts", "tooling"];
export const SOURCE_EXTENSION = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/;

/** Each entry needs its reason; remove the admin one when its sweep lands. */
export const EXCLUDED_PATHS = [
  { prefix: "apps/admin/", why: "deferred until the admin sweep lands" },
  { prefix: VENDORED_SOURCE_PREFIX, why: "vendored byte-for-byte (ADR-22)" },
  { prefix: "packages/create-qcms-app/templates/", why: "generated mirrors of app files" },
  { prefix: "plan/", why: "scratch tree" },
];

const GENERATED = /\.generated\.|(^|\/)__snapshots__\/|\.snap$/;

export function isExcluded(path) {
  return EXCLUDED_PATHS.some(({ prefix }) => path.startsWith(prefix)) || GENERATED.test(path);
}

export function isInScope(path) {
  if (!SOURCE_EXTENSION.test(path) || isExcluded(path)) return false;
  return !path.includes("/") || SOURCE_ROOTS.some((root) => path.startsWith(`${root}/`));
}

/** A line carrying one of these is a directive, not prose, and is never counted or flagged. */
export const ALLOWED_LINE = [
  /eslint-(disable|enable)/,
  /@ts-expect-error\b/,
  /@ts-check\b/,
  /\bc8 ignore\b/,
  /prettier-ignore/,
  /^\/\/\/\s*<reference\b/,
  /check-security-hygiene: allow\s+\S/,
  /<!-- expect:/,
  /check-comments: allow\s+\S/,
];

const LICENSE = /SPDX-License-Identifier|@license\b|\bCopyright \(c\)/i;

export const HISTORY_MARKERS = [
  { pattern: /\bissues? #\d+/i, what: "an issue number", todoExempt: true },
  { pattern: /\bPRs? #\d+/i, what: "a PR number", todoExempt: false },
  { pattern: /\bCode Owner\b/, what: "a ruling attribution", todoExempt: false },
  {
    pattern: /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/,
    what: "a date",
    todoExempt: false,
  },
  { pattern: /\btask \d{3}\b/i, what: "a task number", todoExempt: false },
  { pattern: /\bwas\b.*\bnow\b/i, what: '"was ... now" history', todoExempt: false },
];

/**
 * Tags whose lines describe parameters and types rather than adding prose. Every line
 * after one belongs to it until the next tag.
 */
const TYPE_TAG = /^@(param|arg|argument|returns?|throws|template|typeParam|type|typedef|callback|property|prop|satisfies|yields|deprecated|see)\b/;
const ANY_TAG = /^@[A-Za-z]+/;

function isAllowedLine(line) {
  return ALLOWED_LINE.some((pattern) => pattern.test(line.trim()));
}

/** Strips the comment syntax, keeping one entry per source line. */
export function contentLines(text) {
  if (text.startsWith("//")) return [text.replace(/^\/\/\/?/, "").trim()];
  return text
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*?/, "").trim());
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function ownLine(text, pos) {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  return text.slice(start, pos).trim() === "";
}

function scriptKind(path) {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const CONTAINER_KINDS = new Set([
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.TypeLiteral,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.VariableDeclarationList,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.IntersectionType,
  ts.SyntaxKind.UnionType,
  ts.SyntaxKind.ParenthesizedType,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.ModuleBlock,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.SyntaxList,
]);

function hasExportModifier(node) {
  if (node.kind === ts.SyntaxKind.ExportAssignment) return true;
  if (node.kind === ts.SyntaxKind.ExportDeclaration) return true;
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

/** A member counts as exported when the declaration it belongs to is. */
export function isExportedApi(node) {
  let current = node;
  while (current !== undefined) {
    if (hasExportModifier(current)) return true;
    const parent = current.parent;
    if (parent === undefined || !CONTAINER_KINDS.has(parent.kind)) return false;
    current = parent;
  }
  return false;
}

/** Comment ranges from the parsed tree, so strings, regex literals and JSX text never read as comments. */
function scriptComments(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  const ranges = new Map();
  const jsxText = [];
  const startsAt = new Map();

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxText.push([node.pos, node.end]);
      return;
    }
    const start = node.getStart(source);
    if (
      node.kind !== ts.SyntaxKind.SourceFile &&
      node.kind !== ts.SyntaxKind.SyntaxList &&
      !startsAt.has(start)
    ) {
      startsAt.set(start, node);
    }
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) {
      ranges.set(range.pos, range);
    }
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) {
      ranges.set(range.pos, range);
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);

  const insideJsxText = (range) =>
    jsxText.some(([from, to]) => range.pos < to && range.end > from);

  return [...ranges.values()]
    .filter((range) => !insideJsxText(range))
    .sort((a, b) => a.pos - b.pos)
    .map((range) => {
      const comment = {
        pos: range.pos,
        end: range.end,
        text: text.slice(range.pos, range.end),
        line: false,
        exported: false,
      };
      comment.line = range.kind === ts.SyntaxKind.SingleLineCommentTrivia;
      if (comment.text.startsWith("/**")) {
        const next = nextCodePosition(text, range.end);
        const node = startsAt.get(next);
        comment.exported = node !== undefined && isExportedApi(node);
      }
      return comment;
    });
}

function nextCodePosition(text, from) {
  let position = from;
  for (;;) {
    const following = ts.getLeadingCommentRanges(text, position);
    if (following === undefined || following.length === 0) break;
    position = following[following.length - 1].end;
  }
  while (position < text.length && /\s/.test(text[position])) position += 1;
  return position;
}

function cssComments(text) {
  const comments = [];
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"' || ch === "'") {
      index += 1;
      while (index < text.length && text[index] !== ch) index += text[index] === "\\" ? 2 : 1;
      index += 1;
      continue;
    }
    if (ch === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? text.length : close + 2;
      comments.push({ pos: index, end, text: text.slice(index, end), line: false, exported: false });
      index = end;
      continue;
    }
    index += 1;
  }
  return comments;
}

/** Adjacent own-line `//` comments read as one block. */
function groupBlocks(text, comments) {
  const blocks = [];
  for (const comment of comments) {
    const previous = blocks[blocks.length - 1];
    const last = previous?.parts[previous.parts.length - 1];
    if (
      comment.line &&
      last?.line === true &&
      ownLine(text, comment.pos) &&
      ownLine(text, previous.parts[0].pos) &&
      lineOf(text, comment.pos) === lineOf(text, last.pos) + 1
    ) {
      previous.parts.push(comment);
    } else {
      blocks.push({ parts: [comment] });
    }
  }
  return blocks;
}

function describedLines(lines) {
  let inTypeTag = false;
  let counted = 0;
  for (const line of lines) {
    if (ANY_TAG.test(line)) inTypeTag = TYPE_TAG.test(line);
    if (!inTypeTag && line !== "") counted += 1;
  }
  return counted;
}

export function scanText(path, text) {
  const comments = path.endsWith(".css") ? cssComments(text) : scriptComments(path, text);
  const hits = [];
  for (const block of groupBlocks(text, comments)) {
    const first = block.parts[0];
    const startLine = lineOf(text, first.pos);
    const raw = block.parts.map((part) => part.text).join("\n");
    if (LICENSE.test(raw)) continue;

    const lines = block.parts.flatMap((part) => contentLines(part.text));
    const rawLines = raw.split("\n");
    const prose = lines.filter((_, index) => !isAllowedLine(rawLines[index] ?? ""));

    lines.forEach((line, index) => {
      const rawLine = rawLines[index] ?? "";
      if (isAllowedLine(rawLine)) return;
      for (const marker of HISTORY_MARKERS) {
        if (marker.todoExempt && /\bTODO\b/.test(line)) continue;
        if (marker.pattern.test(line)) {
          hits.push({ file: path, line: startLine + index, rule: "history", detail: marker.what });
        }
      }
    });

    const jsdoc = !first.line && first.text.startsWith("/**") && first.exported;
    const counted = jsdoc ? describedLines(prose) : prose.filter((line) => line !== "").length;
    const limit = jsdoc ? MAX_EXPORT_JSDOC_LINES : MAX_COMMENT_LINES;
    if (counted > limit) {
      hits.push({
        file: path,
        line: startLine,
        rule: "length",
        detail: `${jsdoc ? "export JSDoc" : "comment"} of ${counted} lines (limit ${limit})`,
      });
    }
  }
  return hits;
}

export function filesInScope() {
  const listed = execFileSync(
    GIT,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const files = listed
    .split("\0")
    .filter((path) => path !== "" && isInScope(path) && existsSync(`${REPO_ROOT}${path}`));
  if (files.length === 0) throw new Error("check-comments: git listed no files in scope");
  return files.sort();
}

function main() {
  const files = filesInScope();
  const hits = files.flatMap((file) => scanText(file, readFileSync(`${REPO_ROOT}${file}`, "utf8")));
  if (hits.length === 0) {
    console.log(`check-comments: OK (${files.length} files)`);
    return;
  }
  for (const hit of hits) console.error(`${hit.file}:${hit.line}  ${hit.rule}: ${hit.detail}`);
  console.error(
    `\ncheck-comments: ${hits.length} problem(s). See "Code comments" in PROJECT_INSTRUCTIONS.md; ` +
      'a directive line may carry "check-comments: allow <reason>".',
  );
  process.exitCode = 1;
}

if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  main();
}
