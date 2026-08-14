/**
 * Secret and log hygiene gate (task 040, SEC-8).
 *
 * Two static properties that the runtime controls cannot establish on their own,
 * checked here so a regression fails CI rather than shipping quietly.
 *
 * **1. No logger call site passes respondent answer content.**
 * `packages/observability`'s stdout logger redacts by *field name* and the OTLP
 * path is an allowlist, so a value logged under a key nobody thought of, or
 * inside a string a redactor never sees, still reaches an operator's log
 * aggregator. SEC-8 states the rule as "answer values are never logged - log
 * questionIds and counts, not content", and that rule is about the call site.
 * So every logging call in the workspace is parsed and refused if its argument
 * object mentions a content-bearing key at any depth. As of 2026-08-14 no call
 * site in the repository trips this, so the allowlist below is empty by
 * observation rather than by aspiration.
 *
 * **2. Committed example environment files hold no live-looking secret.**
 * Every `.env*.example` must fill its secret-shaped variables with a recognisable
 * placeholder. That is now enforced at boot too (`apps/api/src/config.ts`
 * refuses a placeholder), and the two halves are complementary: the config guard
 * stops a placeholder reaching production, this gate stops a real secret
 * reaching the repository.
 *
 * Escape hatch: put `check-secret-hygiene: allow <reason>` in a comment on the
 * line immediately above an offending line. It has to be a reason, in the diff,
 * where a reviewer sees it.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Absolute git path: a bare `git` would trip `sonarjs/no-os-command-from-path`. */
const GIT_CANDIDATES = ["/usr/bin/git", "/usr/local/bin/git", "/bin/git"];

/** The marker that waives one line. */
export const ALLOW_MARKER = "check-secret-hygiene: allow";

/**
 * Keys that may carry respondent content. `value`/`values` are here because the
 * kernel's own vocabulary for an answer is `{ questionId, value }`, so logging
 * `value` is the single most likely way this rule gets broken.
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
 * A receiver chain this gate treats as a logger. Empty means a bare `info(...)`,
 * which is how the schedulers call it after destructuring. Anything else has to
 * end in a logger-shaped name, so `table.info(...)` or `span.error(...)` are not
 * mistaken for logging.
 */
function isLoggerReceiver(chain) {
  if (chain === "") return true;
  const segments = chain.split(".").filter((segment) => segment !== "");
  const last = segments[segments.length - 1] ?? "";
  return /logg?er$/i.test(last);
}

/** Source globs the gate reads. Tests are excluded: a test may log a fixture. */
const SOURCE_GLOBS = ["apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts", "scripts/**/*.mjs"];

const TEST_FILE = /\.(test|spec|e2e|pw)\.[cm]?tsx?$/;

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

/** Tracked files matching the source globs, test files removed. */
export function sourceFiles() {
  return git(["ls-files", "--", ...SOURCE_GLOBS])
    .split("\n")
    .filter((path) => path !== "" && !TEST_FILE.test(path));
}

/**
 * Slice the argument text of a call whose `(` sits at `open`, by counting
 * parentheses. Bounded by the end of the file; quotes are not tracked, which can
 * only ever make the slice longer and so the check stricter.
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

/** True when the line above `index` waives this finding. */
function waived(text, index) {
  const lineStart = text.lastIndexOf("\n", index);
  const previousStart = text.lastIndexOf("\n", lineStart - 1);
  return text.slice(previousStart + 1, lineStart).includes(ALLOW_MARKER);
}

const CONTENT_KEY_PATTERN = new RegExp(
  `(^|[{,(\\s])(${CONTENT_KEYS.join("|")})\\s*(:|,|\\})`,
  "i",
);

/** Every content-bearing logging call in `text`. */
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

/** Values in an example env file that look like real secret material. */
const PLACEHOLDER_SHAPES = [
  /^replace[-_]/i,
  /^change[-_]?me/i,
  /^your[-_]/i,
  /^example[-_]/i,
  /^placeholder/i,
  /^</,
  /^$/,
];

/** Variables whose value is secret material and must therefore be a placeholder. */
const SECRET_VARS =
  /(KEYS?|SECRETS?|TOKEN|PASSWORD|PASSPHRASE|_KEY|CREDENTIAL|API_KEY|AUTH_SECRET)$/;

/** Example env files must never carry a value that could be a live secret. */
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
    .filter((path) => path !== "" && path.includes("env"));
}

function main() {
  const logHits = [];
  for (const file of sourceFiles()) {
    logHits.push(...scanSource(file, readFileSync(`${REPO_ROOT}${file}`, "utf8")));
  }
  const envHits = [];
  for (const file of envExampleFiles()) {
    envHits.push(...scanEnvExample(file, readFileSync(`${REPO_ROOT}${file}`, "utf8")));
  }

  if (logHits.length === 0 && envHits.length === 0) {
    console.log(
      `check-secret-hygiene: OK (${sourceFiles().length} source files, ${envExampleFiles().length} example env files)`,
    );
    return;
  }

  for (const hit of logHits) {
    console.error(
      `${hit.file}:${hit.line}  ${hit.call}(...) logs "${hit.key}" - SEC-8 forbids logging answer content; log questionIds and counts instead`,
    );
  }
  for (const hit of envHits) {
    console.error(
      `${hit.file}:${hit.line}  ${hit.name} has a value that is not a recognisable placeholder`,
    );
  }
  console.error(
    `\ncheck-secret-hygiene: ${logHits.length + envHits.length} problem(s). Waive one line with a "${ALLOW_MARKER} <reason>" comment above it.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main();
}
