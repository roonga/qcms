/**
 * Security hygiene gate (SEC-8, SEC-12, ADR-24). **The boundary.** These are regex scans, so a
 * statement or message assembled elsewhere and passed as a plain variable, or past the one hop
 * {@link envNameConstants} follows, is invisible: a clean run means no violation in a recognised shape.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Absolute git path: a bare `git` would trip `sonarjs/no-os-command-from-path`. */
const GIT_CANDIDATES = ["/usr/bin/git", "/usr/local/bin/git", "/bin/git"];

export const ALLOW_MARKER = "check-security-hygiene: allow";

/**
 * `value`/`values` are listed because the kernel's vocabulary for an answer is
 * `{ questionId, value }`, so logging `value` is the likeliest way to break SEC-8.
 */
export const CONTENT_KEYS = [
  "answer",
  "answers",
  "answerValue",
  "answerValues",
  "value",
  "values",
  "payload",
  "body",
  "content",
  "contents",
  "definition",
  "responseBody",
];

/** Logging methods, with or without a receiver (schedulers destructure them). */
const LOG_CALL = /(?:^|[^\w$.])((?:[\w$]+\.)*)(info|warn|error|debug|trace|fatal)\s*\(/g;

/**
 * A non-empty chain must end in a logger-shaped name, so `table.info(...)` and
 * `span.error(...)` are not mistaken for logging.
 */
function isLoggerReceiver(chain) {
  if (chain === "") return true;
  const segments = chain.split(".").filter((segment) => segment !== "");
  const last = segments[segments.length - 1] ?? "";
  return /logg?er$/i.test(last);
}

/**
 * Roots plus an extension test, never globs: git pathspecs are fnmatch without
 * `FNM_PATHNAME`, so `scripts/**\/*.mjs` silently matched nothing while the gate
 * reported a file count that read like full coverage.
 */
export const SOURCE_ROOTS = ["apps", "packages", "scripts", "tooling"];

export const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;

export const TEST_FILE = /\.(test|spec|e2e|pw)\.[cm]?tsx?$/;

function git(args) {
  const bin = GIT_CANDIDATES.find((candidate) => {
    try {
      readFileSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (bin === undefined) throw new Error("git binary not found in a known location");
  return execFileSync(bin, args, { cwd: REPO_ROOT, encoding: "utf8" });
}

/**
 * Skipped, because a gate that encodes the constructs it hunts for always matches
 * itself. Nothing here talks to a database or a logger, so no coverage is lost.
 */
const SELF = "scripts/check-security-hygiene.mjs";

export function sourceFiles() {
  return git(["ls-files", "--", ...SOURCE_ROOTS])
    .split("\n")
    .filter(
      (path) =>
        path !== "" &&
        path !== SELF &&
        existsSync(`${REPO_ROOT}${path}`) &&
        SOURCE_EXTENSIONS.test(path) &&
        !TEST_FILE.test(path),
    );
}

/**
 * Quotes are NOT tracked, which is not a safe direction: an unbalanced `)` inside a
 * string literal closes the count early and makes the slice shorter, so a later
 * argument goes unexamined. Body sinks go through {@link callArgumentsQuoteAware}
 * instead; only the logging scan uses this one.
 */
export function callArguments(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

export function endOfStringLiteral(code, start) {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === "\\") {
      i += 2;
      continue;
    }
    if (code[i] === quote) return i + 1;
    i += 1;
  }
  return code.length;
}

/**
 * Skips string and template literals while counting, so a `)` inside an author's
 * prose cannot end the slice early and hide a later argument.
 */
export function callArgumentsQuoteAware(code, open) {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = endOfStringLiteral(code, i);
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
    i += 1;
  }
  return code.slice(open + 1);
}

function waived(text, index) {
  const lineStart = text.lastIndexOf("\n", index);
  const previousStart = text.lastIndexOf("\n", lineStart - 1);
  return text.slice(previousStart + 1, lineStart).includes(ALLOW_MARKER);
}

const CONTENT_KEY_PATTERN = new RegExp(`(^|[{,(\\s])(${CONTENT_KEYS.join("|")})\\s*(:|,|\\})`, "i");

export function scanSource(label, text) {
  const hits = [];
  LOG_CALL.lastIndex = 0;
  let match = LOG_CALL.exec(text);
  while (match !== null) {
    const open = match.index + match[0].length - 1;
    const args = callArguments(text, open);
    const offending = CONTENT_KEY_PATTERN.exec(args);
    if (offending !== null && isLoggerReceiver(match[1]) && !waived(text, open)) {
      const line = text.slice(0, open).split("\n").length;
      hits.push({ file: label, line, key: offending[2], call: `${match[1]}${match[2]}` });
    }
    match = LOG_CALL.exec(text);
  }
  return hits;
}

/** A `sql` tagged template is deliberately not matched: that is the safe form. */
const RAW_SQL = [
  {
    pattern: /\bsql\s*\.\s*raw\s*\(/g,
    why: "sql.raw() splices its argument into the statement unparameterized",
  },
  {
    pattern: /\.\s*(?:execute|query)\s*\(\s*`[^`]*\$\{/g,
    why: "a template literal with an interpolation passed straight to execute/query is unparameterized",
  },
  {
    // The backtick branch is required: a template literal with no interpolation is a
    // string in different quotes, and multi-line SQL is where an author reaches for one.
    pattern:
      /\.\s*(?:execute|query)\s*\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.)*`)\s*\+/g,
    why: "a SQL string concatenated with `+` and passed to execute/query is unparameterized",
  },
  {
    pattern: /\.\s*(?:execute|query)\s*\(\s*[A-Za-z_$][\w$.]*\s*\+\s*(?:"|'|`)/g,
    why: "a SQL string concatenated with `+` and passed to execute/query is unparameterized",
  },
];

export function scanSql(label, text) {
  const hits = [];
  for (const { pattern, why } of RAW_SQL) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      if (!waived(text, match.index)) {
        hits.push({ file: label, line: text.slice(0, match.index).split("\n").length, why });
      }
      match = pattern.exec(text);
    }
  }
  return hits;
}

/**
 * Blanked rather than deleted so every offset stays identical, which is what lets
 * {@link waived} read an allow marker out of the comment above a finding. A lexer
 * rather than a regex because of `//` inside a string and an apostrophe inside
 * prose. Known gap: a regex literal containing a quote or a slash-star.
 */
export function blankComments(source) {
  const out = source.split("");
  let index = 0;
  let mode = "code";
  let quote = "";
  while (index < source.length) {
    const ch = source[index];
    const next = source[index + 1];
    if (mode === "code") {
      if (ch === "/" && (next === "/" || next === "*")) {
        mode = next === "/" ? "line" : "block";
        out[index] = " ";
        out[index + 1] = " ";
        index += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        mode = "string";
        quote = ch;
      }
      index += 1;
      continue;
    }
    if (mode === "line") {
      if (ch === "\n") mode = "code";
      else out[index] = " ";
      index += 1;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        out[index] = " ";
        out[index + 1] = " ";
        mode = "code";
        index += 2;
        continue;
      }
      if (ch !== "\n") out[index] = " ";
      index += 1;
      continue;
    }
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === quote) mode = "code";
    index += 1;
  }
  return out.join("");
}

/** Only the API builds a response body; the BFFs redirect and libraries answer nothing. */
export const BODY_SOURCE_ROOT = "apps/api/src/";

const ENV_NAME = /QCMS_[A-Z0-9_]+/;

/**
 * Deliberately NOT sinks: `logger.*`, `process.stderr.write`, config boot refusals and
 * `describeRefusal`, which are operator channels where naming the variable is the point.
 */
const BODY_PROPERTY = /\b(?:message|details?|reason|hint|title)\s*:/g;

/**
 * Quote-aware rather than a regex: a comma inside an English sentence would cut the
 * slice before the variable name. Ends at the first `,`, `}` or `;` at bracket depth
 * zero and outside a string.
 */
export function propertyValue(code, from) {
  let depth = 0;
  let i = from;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = endOfStringLiteral(code, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      // Returning rather than going negative stops a parameter annotation, whose `)`
      // arrives before any comma, from swallowing the rest of the file.
      if (depth === 0) return code.slice(from, i);
      depth -= 1;
    } else if ((ch === "," || ch === ";") && depth === 0) return code.slice(from, i);
    i += 1;
  }
  return code.slice(from);
}

const BODY_CONSTRUCTORS =
  /(?:^|[^\w$.])(?:new\s+(?:Api|API)Error|(?:Api|API)Error|new\s+Response|Response\s*\.\s*json|errors\s*\.\s*[\w$]+|[\w$]+\s*\.\s*(?:json|text|body)\s*\()/g;

/**
 * The one hop of indirection this gate follows. The residual is cross-file: only the
 * scanned file's own `const` declarations are read, so a constant exported from one
 * file and put into a body in another yields no hit in either.
 */
export function envNameConstants(text) {
  const found = new Map();
  const pattern = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*);/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const [, name, initializer] = match;
    if (ENV_NAME.test(initializer)) found.set(name, initializer);
    match = pattern.exec(text);
  }
  return found;
}

export function scanEnvNamesInBodies(label, text) {
  if (!label.startsWith(BODY_SOURCE_ROOT)) return [];
  // Scan the blanked code, waive against the source: the marker lives in a comment
  // the scan cannot see, and blanking preserves every offset.
  const code = blankComments(text);
  const constants = envNameConstants(code);
  const hits = [];
  const seen = new Set();

  const record = (index, name, what) => {
    if (waived(text, index)) return;
    const line = text.slice(0, index).split("\n").length;
    const key = `${line}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ file: label, line, name, what });
  };

  const namesIn = (slice) => {
    const names = new Set();
    for (const found of slice.matchAll(/QCMS_[A-Z0-9_]+/g)) names.add(found[0]);
    for (const identifier of slice.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const initializer = constants.get(identifier[0]);
      if (initializer === undefined) continue;
      for (const found of initializer.matchAll(/QCMS_[A-Z0-9_]+/g)) names.add(found[0]);
    }
    return names;
  };

  BODY_PROPERTY.lastIndex = 0;
  let property = BODY_PROPERTY.exec(code);
  while (property !== null) {
    const value = propertyValue(code, property.index + property[0].length);
    for (const name of namesIn(value)) record(property.index, name, "a wire-shaped property");
    property = BODY_PROPERTY.exec(code);
  }

  BODY_CONSTRUCTORS.lastIndex = 0;
  let match = BODY_CONSTRUCTORS.exec(code);
  while (match !== null) {
    const open = code.indexOf("(", match.index);
    if (open !== -1) {
      for (const name of namesIn(callArgumentsQuoteAware(code, open))) {
        record(match.index, name, "a response constructor's arguments");
      }
    }
    match = BODY_CONSTRUCTORS.exec(code);
  }
  return hits;
}

/**
 * Must stay in agreement with `PLACEHOLDER_PREFIXES` in `apps/api/src/config.ts`: a
 * spelling this gate accepts but the boot guard does not would sail through both and
 * land a published key in a deployment.
 */
export const PLACEHOLDER_SHAPES = [
  /^replace[-_]/i,
  /^change[-_]?me/i,
  /^your[-_]/i,
  /^example[-_]/i,
  /^placeholder/i,
  /^</,
  /^$/,
];

const SECRET_VARS =
  /(KEYS?|SECRETS?|TOKEN|PASSWORD|PASSPHRASE|_KEY|CREDENTIAL|API_KEY|AUTH_SECRET)$/;

export function scanEnvExample(label, text) {
  const hits = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!SECRET_VARS.test(name)) continue;
    if (PLACEHOLDER_SHAPES.some((shape) => shape.test(value))) continue;
    hits.push({ file: label, line: index + 1, name });
  }
  return hits;
}

export function envExampleFiles() {
  return git(["ls-files", "--", "*.example", "**/*.example"])
    .split("\n")
    .filter((path) => path !== "" && path.includes("env") && existsSync(`${REPO_ROOT}${path}`));
}

function main() {
  const logHits = [];
  const sqlHits = [];
  const bodyHits = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(`${REPO_ROOT}${file}`, "utf8");
    logHits.push(...scanSource(file, text));
    sqlHits.push(...scanSql(file, text));
    bodyHits.push(...scanEnvNamesInBodies(file, text));
  }
  const envHits = [];
  for (const file of envExampleFiles()) {
    envHits.push(...scanEnvExample(file, readFileSync(`${REPO_ROOT}${file}`, "utf8")));
  }

  if (
    logHits.length === 0 &&
    sqlHits.length === 0 &&
    envHits.length === 0 &&
    bodyHits.length === 0
  ) {
    console.log(
      `check-security-hygiene: OK (${sourceFiles().length} source files, ${envExampleFiles().length} example env files)`,
    );
    return;
  }

  for (const hit of logHits) {
    console.error(
      `${hit.file}:${hit.line}  ${hit.call}(...) logs "${hit.key}" - SEC-8 forbids logging answer content; log questionIds and counts instead`,
    );
  }
  for (const hit of sqlHits) {
    console.error(`${hit.file}:${hit.line}  ${hit.why}`);
  }
  for (const hit of envHits) {
    console.error(
      `${hit.file}:${hit.line}  ${hit.name} has a value that is not a recognisable placeholder`,
    );
  }
  for (const hit of bodyHits) {
    console.error(
      `${hit.file}:${hit.line}  ${hit.name} reaches a response body through ${hit.what} - ADR-24 (widened 2026-09-12) allows no environment identifier in a response body; state the behaviour and put the variable in a log line or docs/operations.md`,
    );
  }
  console.error(
    `\ncheck-security-hygiene: ${logHits.length + sqlHits.length + envHits.length + bodyHits.length} problem(s). Waive one line with a "${ALLOW_MARKER} <reason>" comment above it.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main();
}
