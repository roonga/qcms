/**
 * Security hygiene gate (task 040; SEC-8 secrets and logs, plus the SEC-12
 * injection note).
 *
 * Three static properties that the runtime controls cannot establish on their
 * own, checked here so a regression fails CI rather than shipping quietly.
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
 * **3. No SQL is built by string concatenation.**
 * `docs/features/040-security-review-hardening.md` asks for Drizzle
 * parameterization to be asserted rather than assumed. Drizzle's `sql` tagged
 * template parameterizes every `${...}` it interpolates; `sql.raw()` is the one
 * documented door that does not, and `db.execute()` over a plain string is the
 * other. Neither appears in the repository today, and this rule is what keeps
 * that true: JSONB answer values in particular are only ever bound, never
 * spliced.
 *
 * Escape hatch: put `check-security-hygiene: allow <reason>` in a comment on the
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
export const ALLOW_MARKER = "check-security-hygiene: allow";

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

const CONTENT_KEY_PATTERN = new RegExp(`(^|[{,(\\s])(${CONTENT_KEYS.join("|")})\\s*(:|,|\\})`, "i");

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

/**
 * Unparameterized SQL doors. `sql.raw` splices its argument verbatim; a template
 * literal handed to `execute`/`query` is the same hole wearing different
 * clothes. A `sql` tagged template is not matched: that is the safe form.
 */
const RAW_SQL = [
  {
    pattern: /\bsql\s*\.\s*raw\s*\(/g,
    why: "sql.raw() splices its argument into the statement unparameterized",
  },
  {
    pattern: /\.\s*(?:execute|query)\s*\(\s*`[^`]*\$\{/g,
    why: "a template literal with an interpolation passed straight to execute/query is unparameterized",
  },
];

/** Every unparameterized-SQL construction in `text`. */
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
 * Value shapes an example env file may carry. Must stay in agreement with
 * `PLACEHOLDER_PREFIXES` in `apps/api/src/config.ts`: a spelling this gate
 * accepts as a placeholder but the boot guard does not recognise would sail
 * through both and land a published key in a running deployment. Pinned from
 * the other side by `apps/api/src/config-placeholders.test.ts`.
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
  const sqlHits = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(`${REPO_ROOT}${file}`, "utf8");
    logHits.push(...scanSource(file, text));
    sqlHits.push(...scanSql(file, text));
  }
  const envHits = [];
  for (const file of envExampleFiles()) {
    envHits.push(...scanEnvExample(file, readFileSync(`${REPO_ROOT}${file}`, "utf8")));
  }

  if (logHits.length === 0 && sqlHits.length === 0 && envHits.length === 0) {
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
  console.error(
    `\ncheck-security-hygiene: ${logHits.length + sqlHits.length + envHits.length} problem(s). Waive one line with a "${ALLOW_MARKER} <reason>" comment above it.`,
  );
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  main();
}
