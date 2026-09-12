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
 * **3. No environment-variable name reaches an API response body.**
 * ADR-24 says "clients receive behavior, not flag values", and the Code Owner
 * widened that on 2026-09-12 to reach **any environment identifier in a response
 * body**, not only the `QCMS_FLAG_` registry: a variable a client cannot set is
 * not made actionable for the client by sitting outside the registry. It had
 * been a review catch twice in two weeks - the webhook refusal prose ending
 * "set QCMS_WEBHOOK_ALLOW_PRIVATE for on-prem targets" (issue #756) and the
 * breach-check outage body ending "set QCMS_ADMIN_PASSWORD_BREACH_CHECK=false"
 * (issue #910) - so it is a gate here instead. See {@link scanEnvNamesInBodies}
 * for exactly what "reaches a response body" is taken to mean, and for the one
 * hop of indirection it follows.
 *
 * **4. No SQL is built by string concatenation or spliced verbatim.**
 * `docs/features/040-security-review-hardening.md` asks for Drizzle
 * parameterization to be asserted rather than assumed. Drizzle's `sql` tagged
 * template parameterizes every `${...}` it interpolates; `sql.raw()` is the one
 * documented door that does not. Neither an unparameterized door nor a
 * concatenated statement appears in the repository today, and this rule is what
 * keeps that true: JSONB answer values in particular are only ever bound.
 *
 * **What this rule catches, stated exactly, because a check is only worth its
 * scope.** It flags `sql.raw(...)` anywhere; a template literal carrying an
 * interpolation passed *directly* to `execute`/`query` (a bare backtick, not a
 * `sql` tagged template, which is the safe form and is deliberately not
 * flagged); and `+` concatenation adjacent to a quoted literal in the first
 * argument of `execute`/`query`, in either order, where **quoted covers all
 * three quote characters** - `"`, `'` and a backtick template carrying no
 * interpolation. That last case is called out because "string literal" reads
 * narrower than it is: ECMA-262 makes template literals their own grammar
 * category, so a reader can fairly take the phrase to exclude them, and an
 * earlier version of this rule genuinely did.
 *
 * **What it cannot catch**, and this is a limitation of regex rather than an
 * oversight: a statement assembled somewhere else and handed over as a plain
 * variable (`const q = base + id; db.execute(q)`). Catching that needs AST
 * analysis with data-flow, which is a larger tool than this gate should be. The
 * residual is bounded by `sql.raw` being fully covered, since it is the only
 * documented way to reach the driver with unparameterized text once the query
 * builder is the house idiom. If a future change makes hand-assembled SQL
 * plausible, this rule should be replaced by an AST check rather than grown
 * another regex.
 *
 * Escape hatch: put `check-security-hygiene: allow <reason>` in a comment on the
 * line immediately above an offending line. It has to be a reason, in the diff,
 * where a reviewer sees it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

/**
 * The roots the gate scans, plus the extensions it treats as executable source.
 *
 * **Deliberately not globs.** The first version used `git ls-files` pathspecs
 * like `scripts/**\/*.mjs`, and two of them were quietly wrong: `packages/**` was
 * missing `.tsx` entirely (29 files), and worse, `scripts/**\/*.mjs` matched
 * **nothing at all**, because git pathspecs are fnmatch without `FNM_PATHNAME`,
 * so `**\/` still demands an intervening directory and every `scripts/*.mjs`
 * sits at the top level. The gate had therefore never opened a single file in
 * `scripts/`, including itself, while reporting a file count that read like
 * full coverage.
 *
 * Roots plus an extension test have no such failure mode: `git ls-files -- apps`
 * either lists the tree or it does not, and the filtering happens in code that
 * can be read. `check-security-hygiene.test.ts` pins the result against the
 * whole tracked tree, so a new file type or a new root fails rather than
 * silently falling outside.
 */
export const SOURCE_ROOTS = ["apps", "packages", "scripts", "tooling"];

/** Extensions the gate treats as executable source. */
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
 * This file, which the scan skips.
 *
 * A checker that documents and encodes the constructs it hunts for will always
 * match itself: the module comment above names `sql.raw(`, and {@link RAW_SQL}
 * contains the concatenation forms as regex literals. Skipping one file by name
 * is the narrowest available exemption and is visible here rather than buried in
 * a waiver comment on five separate lines. Nothing in this file talks to a
 * database or a logger, so the exemption gives up no real coverage.
 */
const SELF = "scripts/check-security-hygiene.mjs";

/** Tracked executable source under {@link SOURCE_ROOTS}, test files removed. */
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
  {
    // `db.execute("select ... " + id)` - a literal first, then concatenation.
    // The backtick branch matters: a template literal *without* an
    // interpolation is just a string with different quotes, and multi-line SQL
    // is exactly where an author reaches for one. Leaving it out let
    // ``db.execute(`select ` + id)`` scan clean while the comment said "string
    // literal", which is true of ECMA-262's grammar and misleading to a reader.
    pattern:
      /\.\s*(?:execute|query)\s*\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.)*`)\s*\+/g,
    why: "a SQL string concatenated with `+` and passed to execute/query is unparameterized",
  },
  {
    // `db.execute(prefix + "where id = '" + id + "'")` - identifier first.
    // Backtick included for the same reason as above.
    pattern: /\.\s*(?:execute|query)\s*\(\s*[A-Za-z_$][\w$.]*\s*\+\s*(?:"|'|`)/g,
    why: "a SQL string concatenated with `+` and passed to execute/query is unparameterized",
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
 * The source with every comment replaced by spaces, character for character.
 *
 * A rule about what a **string literal** says cannot read comments, and this file is
 * in a repository whose prose explains the very constructs its gates hunt for: the
 * constant below is documented in a JSDoc block that names the variable it must not
 * ship, and a naive scan would flag the explanation instead of the code. Blanking
 * rather than deleting keeps every offset and line number identical, so a hit found
 * here points at the same character of the original - which is what lets
 * {@link waived} keep reading an allow marker out of the comment above a finding.
 *
 * A small hand-written lexer rather than a regex, because the three states a regex
 * gets wrong here are exactly the ones that matter: a `//` inside a string ("http://"
 * appears throughout), a quote character inside a comment (an apostrophe in English
 * prose, which a regex pairing quotes reads as opening a string that never closes),
 * and an escaped quote inside a string. Template-literal `${...}` interpolations are
 * treated as string content, which can only make a slice longer and the check
 * stricter. It is not a full ECMAScript lexer: a regex literal containing a quote or
 * a slash-star is the known gap, and no file under the scanned root has one.
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
    // Inside a string: only an unescaped matching quote ends it.
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === quote) mode = "code";
    index += 1;
  }
  return out.join("");
}

/**
 * The roots whose response bodies this rule reads. Only the API builds one: the
 * two Next apps are BFFs whose own bodies are redirects and catalog-keyed
 * messages (ADR-27), and a `packages/*` library answers no request.
 */
export const BODY_SOURCE_ROOT = "apps/api/src/";

/** An environment identifier, which for this repository means the `QCMS_` prefix. */
const ENV_NAME = /QCMS_[A-Z0-9_]+/;

/**
 * Expressions this gate treats as reaching a response body.
 *
 * Two shapes, both of which the API actually uses:
 *
 * - **A wire-shaped property.** `message`, `details`/`detail`, `reason`, `hint`
 *   and `title` are the fields `ErrorEnvelope` and the assist `AssistEvent`
 *   stream put in front of a client. The `AssistEvent` case is why a property
 *   scan is needed at all rather than only a constructor scan: those events are
 *   plain object literals returned from a generator and serialized by
 *   `features/forms/assist/handler.ts`, so nothing at the literal names a
 *   response.
 * - **A response constructor's arguments.** `ApiError` (`errors.ts`), better-auth's
 *   `APIError`, and the Fetch/Hono body builders. This catches a positional
 *   message - `new ApiError("code", 422, "...")` - which no property scan can see.
 *
 * Deliberately **not** sinks: `logger.*`, `process.stderr.write`, `issues.push`
 * (config.ts's boot refusals, raised before the process serves anything) and
 * `describeRefusal`'s plain `return`. Every one of those is an operator channel,
 * and naming the variable there is the point rather than the defect.
 */
const BODY_PROPERTY = /\b(?:message|details?|reason|hint|title)\s*:/g;

/**
 * The value expression that starts at `from`, up to the end of its property.
 *
 * Quote-aware, and that is the whole reason it is not a regex: the first version
 * sliced with `[^,}]*` and missed the assist stream's step-limit message, whose text
 * is "Try a smaller request, or raise ..." - the comma inside the English sentence cut
 * the slice before the variable name. A property value ends at the first `,`, `}` or
 * `;` that is at bracket depth zero and outside a string; anything nested is part of
 * the value. Running off the end of the file returns the rest, which can only make the
 * slice longer and the check stricter.
 */
export function propertyValue(code, from) {
  let depth = 0;
  let quote = "";
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (quote !== "") {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      // At depth zero this bracket closes something that *contains* the property, so
      // the value ended before it. Returning here rather than going negative is what
      // stops a TypeScript parameter annotation - `warn: (message: string) => void,`,
      // whose `)` arrives before any comma - from swallowing the rest of the file and
      // reporting every variable named anywhere in it.
      if (depth === 0) return code.slice(from, i);
      depth -= 1;
    } else if ((ch === "," || ch === ";") && depth === 0) return code.slice(from, i);
  }
  return code.slice(from);
}

/** Call expressions whose arguments become a response body. */
const BODY_CONSTRUCTORS =
  /(?:^|[^\w$.])(?:new\s+(?:Api|API)Error|(?:Api|API)Error|new\s+Response|Response\s*\.\s*json|errors\s*\.\s*[\w$]+|[\w$]+\s*\.\s*(?:json|text|body)\s*\()/g;

/**
 * Module-scope `const NAME = <string expression>` whose text carries an env name.
 *
 * The one hop of indirection this gate follows, and the hop the two known defects
 * both used: issue #910's message was a named constant referenced from the
 * `APIError`, so a scan of argument literals alone read clean while the body
 * shipped the variable. Anything further - a constant built from another constant,
 * a value assembled in a helper and returned - is out of reach of a regex and is
 * stated here as the residual rather than implied to be covered. A second hop
 * would want an AST with data-flow, which is a bigger tool than this gate.
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

/**
 * Every environment identifier that reaches a response body in `text`.
 *
 * `label` decides whether the file is in scope at all, so a caller passes the
 * repo-relative path. Waivable one line at a time with {@link ALLOW_MARKER}, like
 * the rules above: a literal that genuinely is not a body - a fixture, a
 * generated OpenAPI description - says so in the diff where a reviewer reads it.
 */
export function scanEnvNamesInBodies(label, text) {
  if (!label.startsWith(BODY_SOURCE_ROOT)) return [];
  // Scan the code, waive against the source. {@link blankComments} preserves every
  // offset, so a hit found in `code` indexes the same character of `text` - which is
  // what lets the allow marker keep working, since the marker itself lives in a comment
  // the scan cannot see.
  const code = blankComments(text);
  const constants = envNameConstants(code);
  const hits = [];
  const seen = new Set();

  /** Record one hit, at most once per offending source line. */
  const record = (index, name, what) => {
    if (waived(text, index)) return;
    const line = text.slice(0, index).split("\n").length;
    const key = `${line}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ file: label, line, name, what });
  };

  /** The env names `slice` carries, directly or through one named constant. */
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
      for (const name of namesIn(callArguments(code, open))) {
        record(match.index, name, "a response constructor's arguments");
      }
    }
    match = BODY_CONSTRUCTORS.exec(code);
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
