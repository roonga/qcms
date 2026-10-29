#!/usr/bin/env node
// @ts-check
/**
 * Resolves every vendored source citation against the package that ships the file; `check:vendor-pin`
 * checks only the version digit. A marker binds to the citation before it and `--expect` fails when the cited lines lack the phrase:
 *     (`dist/api/rate-limiter/index.mjs:293`) <!-- expect: ctx.rateLimit.enabled -->
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

export const CONTEXT = 2;

export const DEFAULT_PACKAGE = "better-auth";

/** `git ls-files` is the enumerator: a directory walk reads build output as source. */
const GLOBS = ["*.md", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs", "*.cjs", "*.yml", "*.yaml"];

const LINES = String.raw`\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*`;

const PATH_CHARS = String.raw`[A-Za-z0-9_.\-/]`;

/** `.d.mts` ends in `.mts`, so both extensions are covered. */
const EXT = String.raw`(?:mjs|mts)`;

const FULL = new RegExp(
  String.raw`(?:(@better-auth\/[a-z0-9-]+)\/)?(dist\/${PATH_CHARS}+\.${EXT})(?::(${LINES}))?`,
  "g",
);

/** Backticks are required: outside them `.../draft/validate` is ordinary prose. */
const SHORTHAND = new RegExp(String.raw`\`\.\.\.\/(${PATH_CHARS}+\.${EXT})(?::(${LINES}))?\``, "g");

const LINE_ONLY = new RegExp(String.raw`\`:(${LINES})\``, "g");

/**
 * `.*?` rather than `.+?` so an empty marker is matched and then refused: with `.+?` it
 * matched anyway and passed `includes` against every line while counting as coverage.
 */
const EXPECT = /<!--\s*expect:\s*(.*?)\s*-->/g;

/**
 * Shortest phrase worth asserting, after {@link collapse}. Three refuses the empty and
 * one-character markers, which `{` alone would satisfy in every vendor file.
 */
export const MIN_PHRASE = 3;

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
 * @param {string | undefined} text
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
 * Suffix match first, then ancestor directories of the most recent citation, longest
 * first. The order is what makes the resolution deterministic rather than a guess.
 *
 * @param {string} tail
 * @param {Citation[]} earlier
 * @param {(pkg: string | null, path: string) => boolean} exists
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
 * @param {string} text
 * @param {(pkg: string | null, path: string) => boolean} [exists]
 * @returns {{ citations: Citation[], problems: string[] }}
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
    // Ignored unless it follows a citation closely: `:80` in a document about ports is
    // prose, and refusing it outright would make the shape unusable.
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
    const phrase = collapse(/** @type {string} */ (m[1]));
    if (phrase.length < MIN_PHRASE) {
      problems.push(
        `${String(line)}: expectation "${String(m[1])}" is empty or too short to assert ` +
          `anything (${String(MIN_PHRASE)} characters minimum). An empty phrase is contained ` +
          `by every line there is, so it would pass whatever the vendor did.`,
      );
      continue;
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
 * Matches the version exactly, since a tree can carry two copies. On Windows pnpm truncates
 * store names to 60 characters, so only the installed manifest can confirm the version.
 *
 * @param {string} nodeModules
 * @param {string} name
 * @param {string} version
 * @returns {string | null}
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
  const sorted = entries.sort();
  for (const entry of sorted) {
    if (entry !== prefix && !entry.startsWith(`${prefix}_`)) continue;
    const root = join(store, entry, "node_modules", ...name.split("/"));
    if (existsSync(join(root, "package.json"))) return root;
  }
  for (const entry of sorted) {
    const root = join(store, entry, "node_modules", ...name.split("/"));
    if (manifestVersion(root) === version) return root;
  }
  const direct = join(nodeModules, ...name.split("/"));
  if (manifestVersion(direct) === version) return direct;
  return null;
}

/**
 * @param {string} root
 * @returns {string | null}
 */
function manifestVersion(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * @param {Map<string, Set<string>>} resolved
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
 * Whitespace only, so a phrase still matches across a line the vendor's formatter
 * wrapped. Case and punctuation stay part of the phrase.
 *
 * @param {string} text
 * @returns {string}
 */
export function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * @param {Citation} citation
 * @param {string[] | null} source
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
    if (citation.spans.length === 0) {
      // Checked against the cited lines, never the whole file: a phrase occurring
      // anywhere in a module is a far weaker check wearing the same words.
      return {
        failure: "an expectation needs a cited line; this citation names a path only",
        shown,
      };
    }
    const cited = citation.spans.flatMap((span) => source.slice(span.from - 1, span.to));
    const haystack = collapse(cited.join("\n"));
    if (!haystack.includes(collapse(citation.expect))) {
      return { failure: `does not contain "${citation.expect}"`, shown };
    }
  }
  return { failure: null, shown };
}

/**
 * @param {Citation} citation
 * @param {string} owner
 * @returns {string}
 */
export function describeCitation(citation, owner) {
  const spans = citation.spans
    .map((span) =>
      span.from === span.to ? String(span.from) : `${String(span.from)}-${String(span.to)}`,
    )
    .join(",");
  const at = spans === "" ? " (path only)" : `:${spans}`;
  const canonical = `${citation.pkg === null ? "" : `${citation.pkg}/`}${citation.path}${spans === "" ? "" : `:${spans}`}`;
  // Those shapes are matched with their delimiting backticks, so stripping them leaves
  // exactly one pair around the quoted text.
  const raw = citation.raw.replaceAll("`", "");
  const written = raw === canonical ? "" : ` (written \`${raw}\`)`;
  return `${owner} ${citation.path}${at}${written}`;
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
 * @returns {string[]}
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
 * @returns {number}
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
  const read = /** @type {string[]} */ ([]);
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
      const described = describeCitation(citation, owner);
      if (failure !== null) {
        const elsewhere = otherOwner(citation, owner, exists);
        failures.push(
          `  ${file}:${String(citation.line)}\n` +
            `    ${described}: ${failure}` +
            (elsewhere === null ? "" : `\n    it does exist in ${elsewhere} - wrong package`),
        );
        continue;
      }
      const heading = `  ${described}`;
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
 * @param {Citation} citation
 * @param {string} owner
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

// Guarded so the tests can import the helpers without the scan firing and without
// `process.exit` killing the run.
if (argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2)));
}
