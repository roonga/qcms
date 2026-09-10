#!/usr/bin/env node
// @ts-check
/**
 * Re-read every better-auth source citation against the package that actually ships
 * the file (issue #864, from #849 and #857).
 *
 * ## Why this exists
 *
 * QCMS justifies security properties by citing better-auth's compiled source at a
 * `file:line` - the secure-cookie prefix rule, the `rateLimit.enabled` resolution, the
 * `$ba$<version>$` key envelope. `check:vendor-pin` (issue #483) checks the *digit*
 * beside the package name and says so about itself: it cannot tell you that
 * `dist/<path>.mjs:<line>` still points at the branch the prose claims. Of the
 * twenty-one citations carried from 1.6.26 to 1.7.1, eight had moved.
 *
 * The 1.7.3 bump made the cost of that gap concrete. Twenty-nine citations had to be
 * re-read by hand; the lane wrote an ad hoc checker that resolved every `dist/...` path
 * under `better-auth`, which is wrong for the third of them that live in
 * `@better-auth/core`. The checker printed MISSING for a citation that was perfectly
 * real, the lane fell back to eyeballing a `sed` window, and one citation landed a line
 * out. `check:vendor-pin` passed it, because the digit beside the package name was
 * right.
 *
 * So this is the re-read, as a command. It finds the citations, resolves each one
 * against the package that owns the path, and prints the cited line with two lines of
 * context either side - which is the thing a human needs in front of them to decide
 * whether the sentence around the citation is still true.
 *
 * ## What a citation looks like
 *
 * Three shapes, all of them already in the repository:
 *
 *   - **Full.** `dist/context/create-context.mjs:76`, optionally scoped:
 *     `@better-auth/core/dist/utils/ip.mjs:206`. A bare `dist/` path belongs to
 *     `--package` (default `better-auth`); a scoped one belongs to its own scope, and
 *     that distinction is the whole point of this script.
 *   - **Abbreviated**, for a file the same document already cited in full:
 *     a leading `.../` then the tail of the path. Resolved against the earlier
 *     citations in the same file - see {@link resolveShorthand}.
 *   - **Line only**, for a second line in a file just cited: a backticked `:76`. It
 *     binds to the citation before it, on the same line or the line above.
 *
 * A line reference is one line (`:76`), a span (`:135-138`), or a comma list of either
 * (`:518,529`). Everything cited is checked; a citation with no line at all is checked
 * as a path.
 *
 * The abbreviated and line-only shapes are recognised **only** when they are the whole
 * of a backticked span, because outside backticks they are ordinary prose - `POST
 * .../draft/validate` is a URL and `node .../dist/migrate.js` is a shell command. For
 * the same reason the extension set is `.mjs` and `.mts` (`.d.mts` ends in one), which
 * is what better-auth publishes: a `.js` path in this repository is one of ours.
 *
 * ## `--expect`: turning a re-read into an assertion
 *
 * A citation says where; the sentence around it says what. Nothing connects the two, so
 * a line that moves under a citation whose file still opens is invisible to any gate -
 * that is exactly the #857 defect. An expectation closes that for one citation:
 *
 *     (`dist/api/rate-limiter/index.mjs:290`) <!-- expect: ctx.rateLimit.enabled -->
 *
 * The marker is an HTML comment because that is the one comment syntax that is
 * invisible in rendered Markdown *and* legal inside a JSDoc block, so one convention
 * covers prose and code. It binds to the citation immediately before it (same line, or
 * the line above), and `--expect` fails when the cited lines do not contain the phrase.
 * Whitespace is collapsed on both sides before the comparison, so a phrase still
 * matches across a wrapped line; the comparison is otherwise exact, punctuation and
 * case included.
 *
 * Expectations are **opt in and their coverage is reported**, so a citation without one
 * is not a failure and the run always says how many are carrying an assertion and how
 * many are not. A phrase should be short and distinctive: a symbol, a call, a literal.
 * A whole sentence of vendor source is a phrase that will churn for reasons that do not
 * matter.
 *
 * ## What it cannot see
 *
 *   - **Whether the sentence is true.** It checks that a path opens, a line exists, and
 *     (with `--expect`) that the line contains a phrase somebody wrote down. A citation
 *     pointing at the right line of the wrong function passes.
 *   - **A citation this repository writes in some other shape** - a path with no
 *     `dist/` prefix, a `.js` or `.d.ts` extension, an abbreviation outside backticks.
 *     Adjacency and the extension set are what keep the false-positive rate at zero on
 *     a tree that also talks about its own `dist/` directories.
 *   - **A dated record.** `docs/features/`, `.changeset/`, `docs/RETRO.md` and `plan/`
 *     are exempt, by the same list and the same reasoning as `check:vendor-pin`: a log
 *     is allowed to cite a version that is no longer installed, and this script would
 *     read those citations against a tree they were never about.
 *
 * ## Where it runs
 *
 * `pnpm check:vendor-pin` runs it after the digit check, quietly, so the two halves of
 * one claim are checked together: `check:vendor-pin` proves the version is current and
 * this proves the citation opens against it. That costs a few file reads and no
 * network, but it does need `node_modules`, so it fails with a clear line rather than
 * skipping when the tree is not installed - a citation gate that passes because it read
 * nothing is worse than no gate.
 *
 * Usage:
 *   pnpm vendor:cite                      # print every citation with context
 *   pnpm vendor:cite --expect             # also enforce the expectation markers
 *   pnpm vendor:cite --quiet              # failures and the summary only
 *   pnpm vendor:cite --package @better-auth/core
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { argv, exit } from "node:process";
import { pathToFileURL } from "node:url";

import { isExempt, resolvedVersions } from "./check-vendor-pin.mjs";
import { VENDORED_SOURCE_PATHSPEC } from "./vendored-source.mjs";

// Node on Windows won't resolve `git` -> `git.exe` via execFile without a shell.
const GIT = process.platform === "win32" ? "git.exe" : "git";

/** Lines of source printed either side of a cited line. */
export const CONTEXT = 2;

/** The default owner of a bare `dist/` path, overridable with `--package`. */
export const DEFAULT_PACKAGE = "better-auth";

/**
 * The same file set `check:vendor-pin` scans, and for the same reasons: the globs
 * cover text this repository writes, the vendored component copy is excluded because
 * its contents are not ours, and `git ls-files` is the enumerator rather than a
 * directory walk (issue #629 - a directory walk reads a previous gate's build output
 * as source).
 */
const GLOBS = ["*.md", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.yml", "*.yaml"];

/** A line reference: one line, a span, or a comma list of either. */
const LINES = String.raw`\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*`;

/** Characters a vendor path is written with. */
const PATH_CHARS = String.raw`[A-Za-z0-9_.\-/]`;

/** What better-auth publishes. `.d.mts` ends in `.mts`, so both are covered. */
const EXT = String.raw`(?:mjs|mts)`;

/**
 * A full citation: an optional `@better-auth/<pkg>/` scope, a `dist/` path, an optional
 * line reference. Recognised anywhere, backticks or not, because a `dist/*.mjs` path is
 * unambiguous on its own.
 */
const FULL = new RegExp(
  String.raw`(?:(@better-auth\/[a-z0-9-]+)\/)?(dist\/${PATH_CHARS}+\.${EXT})(?::(${LINES}))?`,
  "g",
);

/** An abbreviated citation, which must be the whole of a backticked span. */
const SHORTHAND = new RegExp(String.raw`\`\.\.\.\/(${PATH_CHARS}+\.${EXT})(?::(${LINES}))?\``, "g");

/** A line-only citation, which must likewise be the whole of a backticked span. */
const LINE_ONLY = new RegExp(String.raw`\`:(${LINES})\``, "g");

/** An expectation marker, in the one comment syntax Markdown and JSDoc share. */
const EXPECT = /<!--\s*expect:\s*(.+?)\s*-->/g;

/**
 * @typedef {object} Span
 * @property {number} from first cited line, 1-based
 * @property {number} to last cited line, inclusive
 */

/**
 * @typedef {object} Citation
 * @property {string | null} pkg owning package, or null for "whatever `--package` says"
 * @property {string} path package-relative path, always starting `dist/`
 * @property {Span[]} spans cited lines; empty when the citation names a path only
 * @property {number} line line of the *citing* file this was written on, 1-based
 * @property {string} raw the citation as written, for the failure message
 * @property {string | null} expect phrase the cited lines must contain, if any
 */

/**
 * Parse a line reference into spans. `518,529` is two spans; `135-138` is one.
 *
 * @param {string | undefined} text the `:`-suffix, without the colon
 * @returns {Span[]}
 */
export function parseSpans(text) {
  if (text === undefined || text === "") return [];
  return text.split(",").map((part) => {
    const [from, to] = part.split("-");
    return { from: Number(from), to: Number(to ?? from) };
  });
}

/**
 * Resolve an abbreviated citation against the citations already read in this file.
 *
 * Two rules, in order, and the order is what makes it deterministic rather than a
 * guess. **First**, the most recent earlier citation whose path ends with the
 * abbreviation: `.../backup-codes/index.mjs` after
 * `dist/plugins/two-factor/backup-codes/index.mjs:45` is that same file, and no
 * filesystem is consulted to say so. **Second**, and only when nothing matches by
 * suffix, the most recent earlier citation is treated as naming a directory the
 * abbreviation hangs off: each of its ancestor directories is tried, longest first,
 * and the first that yields a file that exists wins. That second rule is what reads
 * `.../backup-codes/index.mjs:19-22` correctly when the file it abbreviates was never
 * written out in that document, only its sibling `dist/plugins/two-factor/index.mjs`.
 *
 * @param {string} tail the path after `.../`
 * @param {Citation[]} earlier citations already read in this file, in order
 * @param {(pkg: string | null, path: string) => boolean} exists whether a path is in a package
 * @returns {{ pkg: string | null, path: string } | null}
 */
export function resolveShorthand(tail, earlier, exists) {
  for (let i = earlier.length - 1; i >= 0; i -= 1) {
    const previous = /** @type {Citation} */ (earlier[i]);
    if (previous.path.endsWith(`/${tail}`)) return { pkg: previous.pkg, path: previous.path };
  }
  for (let i = earlier.length - 1; i >= 0; i -= 1) {
    const previous = /** @type {Citation} */ (earlier[i]);
    let directory = posix.dirname(previous.path);
    while (directory !== "." && directory !== "/") {
      const candidate = posix.join(directory, tail);
      if (candidate.startsWith("dist/") && exists(previous.pkg, candidate)) {
        return { pkg: previous.pkg, path: candidate };
      }
      directory = posix.dirname(directory);
    }
  }
  return null;
}

/**
 * Every citation in one file's text, in the order they are written.
 *
 * @param {string} text file contents
 * @param {(pkg: string | null, path: string) => boolean} [exists] whether a path is in a package
 * @returns {{ citations: Citation[], problems: string[] }} problems are shapes that
 *   look like citations and cannot be read as any
 */
export function citationsIn(text, exists = () => false) {
  const lineOf = lineIndex(text);
  /** @type {{ index: number, kind: "full" | "shorthand" | "line", m: RegExpExecArray }[]} */
  const hits = [];
  for (const m of text.matchAll(FULL)) hits.push({ index: m.index, kind: "full", m });
  for (const m of text.matchAll(SHORTHAND)) hits.push({ index: m.index, kind: "shorthand", m });
  for (const m of text.matchAll(LINE_ONLY)) hits.push({ index: m.index, kind: "line", m });
  hits.sort((a, b) => a.index - b.index);

  /** @type {Citation[]} */
  const citations = [];
  /** @type {number[]} */
  const ends = [];
  /** @type {string[]} */
  const problems = [];

  for (const hit of hits) {
    const raw = hit.m[0];
    const line = lineOf(hit.index);
    if (hit.kind === "full") {
      citations.push({
        pkg: hit.m[1] ?? null,
        path: /** @type {string} */ (hit.m[2]),
        spans: parseSpans(hit.m[3]),
        line,
        raw,
        expect: null,
      });
      ends.push(hit.index + raw.length);
      continue;
    }
    if (hit.kind === "shorthand") {
      const base = resolveShorthand(/** @type {string} */ (hit.m[1]), citations, exists);
      if (base === null) {
        problems.push(
          `${String(line)}: ${raw} abbreviates a path no earlier citation in this file names. ` +
            `Write the path in full.`,
        );
        continue;
      }
      citations.push({ ...base, spans: parseSpans(hit.m[2]), line, raw, expect: null });
      ends.push(hit.index + raw.length);
      continue;
    }
    // A line-only reference. It is a citation when it follows one closely enough to be
    // read as continuing it, and ordinary prose otherwise - `:80` in a document about
    // ports is not a citation, and silently ignoring it is the only way to keep this
    // shape usable at all.
    const previous = citations[citations.length - 1];
    if (previous === undefined) continue;
    const previousEnd = /** @type {number} */ (ends[ends.length - 1]);
    if (line - lineOf(previousEnd) > 1) continue;
    citations.push({
      pkg: previous.pkg,
      path: previous.path,
      spans: parseSpans(hit.m[1]),
      line,
      raw,
      expect: null,
    });
    ends.push(hit.index + raw.length);
  }

  for (const m of text.matchAll(EXPECT)) {
    const line = lineOf(m.index);
    let bound = -1;
    for (let i = citations.length - 1; i >= 0; i -= 1) {
      const end = /** @type {number} */ (ends[i]);
      if (end > m.index) continue;
      bound = line - lineOf(end) <= 1 ? i : -1;
      break;
    }
    if (bound === -1) {
      problems.push(
        `${String(line)}: expectation "${String(m[1])}" follows no citation. An expectation ` +
          `binds to the citation on its own line or the line above.`,
      );
      continue;
    }
    /** @type {Citation} */ (citations[bound]).expect = /** @type {string} */ (m[1]);
  }

  return { citations, problems };
}

/**
 * A 1-based line number for any offset in `text`, by binary search over the newline
 * offsets rather than by re-splitting the file per citation.
 *
 * @param {string} text
 * @returns {(index: number) => number}
 */
function lineIndex(text) {
  /** @type {number[]} */
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return (index) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (/** @type {number} */ (starts[mid]) <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/**
 * Where an installed package at an exact version lives.
 *
 * pnpm's store encodes a scope as `+` and appends a peer-dependency hash, so
 * `@better-auth/core@1.7.3` is a directory named `@better-auth+core@1.7.3_<hash>` whose
 * `node_modules` holds the real package. **Matching the version exactly is the point**:
 * a tree carrying two copies of a package would otherwise hand back whichever one the
 * directory listing returned first, and the citation would be read against a version
 * nobody asserted. A non-pnpm layout is handled by the direct `node_modules/<name>`
 * fallback, which is checked against the manifest's own version for the same reason.
 *
 * @param {string} nodeModules path to a `node_modules` directory
 * @param {string} name package name
 * @param {string} version exact version
 * @returns {string | null} absolute path to the package root, or null
 */
export function findPackageRoot(nodeModules, name, version) {
  const prefix = `${name.replace("/", "+")}@${version}`;
  const store = join(nodeModules, ".pnpm");
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(store);
  } catch {
    entries = [];
  }
  for (const entry of entries.sort()) {
    if (entry !== prefix && !entry.startsWith(`${prefix}_`)) continue;
    const root = join(store, entry, "node_modules", ...name.split("/"));
    if (existsSync(join(root, "package.json"))) return root;
  }
  const direct = join(nodeModules, ...name.split("/"));
  try {
    const manifest = JSON.parse(readFileSync(join(direct, "package.json"), "utf8"));
    if (manifest.version === version) return direct;
  } catch {
    // Not installed here either; the caller reports it once, with the version.
  }
  return null;
}

/**
 * The one version the lockfile resolves for a package.
 *
 * @param {Map<string, Set<string>>} resolved from `check-vendor-pin.mjs`
 * @param {string} name
 * @returns {{ version: string } | { error: string }}
 */
export function pinnedVersion(resolved, name) {
  const versions = resolved.get(name);
  if (versions === undefined || versions.size === 0) {
    return { error: `pnpm-lock.yaml resolves no version of ${name}` };
  }
  if (versions.size > 1) {
    return {
      error:
        `pnpm-lock.yaml resolves ${name} at ${[...versions].sort().join(" and ")}. A citation ` +
        `cannot be read against an ambiguous tree: say which copy the prose means.`,
    };
  }
  return { version: /** @type {string} */ ([...versions][0]) };
}

/**
 * Collapse whitespace so a phrase still matches across a line the vendor's formatter
 * wrapped. Nothing else is normalised: case and punctuation are part of the phrase.
 *
 * @param {string} text
 * @returns {string}
 */
export function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Check one citation against a package's source.
 *
 * @param {Citation} citation
 * @param {string[] | null} source lines of the cited file, or null when it will not open
 * @param {boolean} enforceExpect
 * @returns {{ failure: string | null, shown: string[] }}
 */
export function checkCitation(citation, source, enforceExpect) {
  if (source === null) return { failure: "no such file", shown: [] };
  /** @type {string[]} */
  const shown = [];
  for (const span of citation.spans) {
    if (span.from < 1 || span.to < span.from) {
      return { failure: `${String(span.from)}-${String(span.to)} is not a line range`, shown };
    }
    if (span.to > source.length) {
      return {
        failure: `line ${String(span.to)} is past the end of the file (${String(source.length)} lines)`,
        shown,
      };
    }
    const first = Math.max(1, span.from - CONTEXT);
    const last = Math.min(source.length, span.to + CONTEXT);
    for (let n = first; n <= last; n += 1) {
      const cited = n >= span.from && n <= span.to;
      shown.push(`  ${cited ? ">" : " "} ${String(n).padStart(5)} | ${String(source[n - 1])}`);
    }
  }
  if (enforceExpect && citation.expect !== null) {
    const cited = citation.spans.flatMap((span) => source.slice(span.from - 1, span.to));
    const haystack = collapse(cited.length > 0 ? cited.join("\n") : source.join("\n"));
    if (!haystack.includes(collapse(citation.expect))) {
      return { failure: `does not contain "${citation.expect}"`, shown };
    }
  }
  return { failure: null, shown };
}

/**
 * @param {string[]} args
 * @returns {{ pkg: string, expect: boolean, quiet: boolean }}
 */
export function parseArgs(args) {
  let pkg = DEFAULT_PACKAGE;
  let expect = false;
  let quiet = false;
  const remaining = [...args];
  while (remaining.length > 0) {
    const arg = /** @type {string} */ (remaining.shift());
    if (arg === "--package") {
      const value = remaining.shift();
      if (value === undefined) throw new Error("--package requires a value");
      pkg = value;
    } else if (arg.startsWith("--package=")) {
      pkg = arg.slice("--package=".length);
    } else if (arg === "--expect") {
      expect = true;
    } else if (arg === "--quiet") {
      quiet = true;
    } else {
      throw new Error(
        `unknown argument: ${arg}\n` +
          "usage: pnpm vendor:cite [--package <name>] [--expect] [--quiet]",
      );
    }
  }
  if (pkg !== "better-auth" && !/^@better-auth\/[a-z0-9-]+$/.test(pkg)) {
    throw new Error(`--package must be better-auth or @better-auth/<name>, not ${pkg}`);
  }
  return { pkg, expect, quiet };
}

/**
 * @param {string} repoRoot
 * @returns {string[]} repo-relative paths, exempt ones already dropped
 */
function tracked(repoRoot) {
  const out = execFileSync(GIT, ["ls-files", "-z", ...GLOBS, VENDORED_SOURCE_PATHSPEC], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split("\0").filter((p) => p !== "" && !isExempt(p));
}

/**
 * @param {string[]} args
 * @returns {number} process exit code
 */
export function main(args) {
  /** @type {{ pkg: string, expect: boolean, quiet: boolean }} */
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`vendor-cite: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const repoRoot = execFileSync(GIT, ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  const resolved = resolvedVersions(readFileSync(join(repoRoot, "pnpm-lock.yaml"), "utf8"));

  /** @type {Map<string, string | null>} */
  const roots = new Map();
  /** @type {string[]} */
  const rootFailures = [];
  /** Packages actually opened, named in the summary so the run says what it read. */
  const read = /** @type {string[]} */ ([]);
  /** Absolute package root for a citation's owner, resolved and reported once. */
  const rootFor = (/** @type {string | null} */ pkg) => {
    const name = pkg ?? options.pkg;
    if (roots.has(name)) return roots.get(name) ?? null;
    const pin = pinnedVersion(resolved, name);
    if ("error" in pin) {
      rootFailures.push(`  ${pin.error}`);
      roots.set(name, null);
      return null;
    }
    const root = findPackageRoot(join(repoRoot, "node_modules"), name, pin.version);
    if (root === null) {
      rootFailures.push(
        `  ${name} ${pin.version} is in the lockfile and not in node_modules. Run \`pnpm install\`.`,
      );
    } else {
      read.push(`${name} ${pin.version}`);
    }
    roots.set(name, root);
    return root;
  };

  /** @type {Map<string, string[] | null>} */
  const sources = new Map();
  /** Lines of a cited vendor file, read once per path. */
  const sourceOf = (/** @type {string | null} */ pkg, /** @type {string} */ path) => {
    const root = rootFor(pkg);
    if (root === null) return null;
    const key = `${root}\0${path}`;
    if (sources.has(key)) return sources.get(key) ?? null;
    /** @type {string[] | null} */
    let lines;
    try {
      lines = readFileSync(join(root, path), "utf8").split("\n");
    } catch {
      lines = null;
    }
    sources.set(key, lines);
    return lines;
  };
  const exists = (/** @type {string | null} */ pkg, /** @type {string} */ path) =>
    sourceOf(pkg, path) !== null;

  /** @type {string[]} */
  const failures = [];
  let total = 0;
  let withExpectation = 0;

  for (const file of tracked(repoRoot)) {
    let text;
    try {
      text = readFileSync(join(repoRoot, file), "utf8");
    } catch {
      continue;
    }
    if (!text.includes("dist/")) continue;
    const { citations, problems } = citationsIn(text, exists);
    for (const problem of problems) failures.push(`  ${file}:${problem}`);
    if (citations.length === 0) continue;
    for (const citation of citations) {
      total += 1;
      if (citation.expect !== null) withExpectation += 1;
      const owner = citation.pkg ?? options.pkg;
      const source = sourceOf(citation.pkg, citation.path);
      const { failure, shown } = checkCitation(citation, source, options.expect);
      const heading = `  ${owner} ${citation.path}${citation.spans.length === 0 ? " (path only)" : ""}`;
      if (failure !== null) {
        const elsewhere = otherOwner(citation, owner, exists);
        failures.push(
          `  ${file}:${String(citation.line)}\n` +
            `    ${owner} ${citation.raw}: ${failure}` +
            (elsewhere === null ? "" : `\n    it does exist in ${elsewhere} - wrong package`),
        );
        continue;
      }
      if (options.quiet) continue;
      console.log(`${file}:${String(citation.line)}`);
      console.log(citation.expect === null ? heading : `${heading}  expect: ${citation.expect}`);
      for (const shownLine of shown) console.log(shownLine);
      console.log("");
    }
  }

  const coverage = options.expect
    ? `, ${String(withExpectation)} with an expectation and ${String(total - withExpectation)} without`
    : "";
  if (rootFailures.length > 0) {
    console.error("vendor-cite: cannot read the installed vendor:\n");
    for (const rootFailure of rootFailures) console.error(rootFailure);
    return 1;
  }
  const against = read.length === 0 ? "" : ` against ${read.sort().join(", ")}`;
  if (failures.length === 0) {
    console.log(`vendor-cite: OK - ${String(total)} citations resolved${against}${coverage}.`);
    return 0;
  }
  console.error(`\nvendor-cite: ${String(failures.length)} citation(s) do not read${coverage}:\n`);
  for (const failure of failures) console.error(failure);
  console.error(
    [
      "",
      "A citation names a file:line in an installed better-auth package. One that will",
      "not open is either pointing at a path the vendor moved or naming the wrong",
      "package - `@better-auth/core` ships a third of what this repository cites, and",
      "resolving those under `better-auth` is how issue #857 landed a citation a line",
      "out. One that opens on the wrong text is a line that has shifted under prose that",
      "did not move. Either way: re-read the source with `pnpm vendor:cite` and fix the",
      "citation and the sentence around it. Do not rewrite the line number, or the",
      "expectation, to whatever makes this pass.",
    ].join("\n"),
  );
  return 1;
}

/**
 * Whether a citation that failed would have opened in the other better-auth package -
 * the one mistake this script exists for, so it is named rather than left to be
 * rediscovered.
 *
 * @param {Citation} citation
 * @param {string} owner package it was read against
 * @param {(pkg: string | null, path: string) => boolean} exists
 * @returns {string | null}
 */
function otherOwner(citation, owner, exists) {
  if (exists(citation.pkg, citation.path)) return null;
  for (const candidate of ["better-auth", "@better-auth/core"]) {
    if (candidate === owner) continue;
    if (exists(candidate, citation.path)) return candidate;
  }
  return null;
}

// Only when run as a command, so the tests can import the helpers above without the
// scan firing and without `process.exit` killing the run.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2)));
}
