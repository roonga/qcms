#!/usr/bin/env node
// @ts-check
/**
 * The action-pin rule as functions over text; SEC-11 of `docs/SECURITY_DESIGN.md` has the reasoning.
 * An unrecognised spelling of `uses` is refused by file and line rather than skipped. This is not a
 * YAML parser: deliberate obfuscation of a key is left to review.
 */

/**
 * The entire carve-out: any other owner is third-party and must be a SHA, so a new owner
 * fails until someone pins it. Case-sensitive on purpose, so `Actions/checkout@v7` is held to
 * the third-party rule.
 */
export const FIRST_PARTY_OWNERS = new Set(["actions", "github"]);

/** A full-length commit SHA as git writes one. Lowercase hex, exactly 40. */
export const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * A complete three-part release, stricter than GitHub's `#<tag or link>` form: a major-only
 * comment would re-admit the ambiguity the SHA removed from the ref, and the comment's whole
 * job is to say which release the SHA is. A pre-release or build suffix is allowed because
 * upstream publishes releases in that form.
 */
export const RELEASE_VERSION =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.]*)?$/;

/**
 * A version tag or a SHA, which is narrower than "has some ref": a first-party `@main` is a
 * ref and still a moving branch, so it is refused. A SHA is stricter than the rule asks.
 */
export const FIRST_PARTY_REF =
  /^(?:[0-9a-f]{40}|v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z][0-9A-Za-z.]*)?)$/;

/**
 * Any depth under either directory, a superset of what GitHub reads, because a superset can
 * only add a file to the inventory and a tighter pattern can lose one.
 */
export const ACTION_FILES = /^\.github\/(?:workflows|actions)\/.*\.ya?ml$/;

const SCANNED_LOCAL_PREFIXES = ["./.github/actions/", "./.github/workflows/"];

// Read by shape because no YAML parser is resolvable from this repository, and a dependency
// for a one-property read is not worth adding.

/**
 * @typedef {"first-party" | "third-party" | "local" | "docker" | "unknown"} Kind
 */

/**
 * @typedef {object} Reference
 * @property {string} file Repository-relative path of the file it was read from.
 * @property {number} line 1-based line number, so a failure names the line to edit.
 * @property {string} value The `uses:` value with quotes removed, or the line's content for
 *   a shape the reader refused.
 * @property {Kind} kind
 * @property {string | undefined} action `owner/repo` for a remote reference, with any
 *   sub-path dropped, so `github/codeql-action/init` and `github/codeql-action/analyze` are
 *   one value. The one-pin rule keys on it, which is why the sub-path goes.
 * @property {string | undefined} ref Whatever follows `@`; undefined when there is none.
 * @property {string | undefined} comment The same-line trailing comment, trimmed.
 * @property {string | undefined} why Why the reader refused this line, when it did.
 */

/** A key whose value is a block scalar: everything indented under it is text, not YAML. */
const BLOCK_SCALAR = /^(?:-[ \t]+)?[A-Za-z0-9_.-]+:[ \t]*[|>][+-]?\d*[ \t]*$/;

/** The one spelling this reader parses. Everything else that mentions the key is refused. */
const CANONICAL_USES = /^[ \t]*(?:-[ \t]+)?uses:(?:[ \t]+(\S.*?))?[ \t]*$/;

/** The flow indicators after which a key can begin. */
const FLOW_INDICATORS = /[{[,]/g;

/** A leading sequence dash, whose width a block-scalar's key column has to account for. */
const SEQUENCE_DASH = /^-(?:[ \t]+|$)/;

/** `owner/repo` or `owner/repo/path`, with no ref attached. Anchored on both sides. */
const ACTION_PATH =
  /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._\-/]+)?$/;

/**
 * A `#` begins a comment only at the start of the content or after whitespace, and only
 * outside a quoted scalar. The backslash escape is honoured for double quotes alone, because
 * YAML has none for single quotes: without it `{ name: "a\" # ", uses: evil/action@v1 }`
 * closes the string early and the `uses` key after it is never seen.
 *
 * @param {string} line
 * @returns {{ code: string; comment: string | undefined }}
 */
export function splitComment(line) {
  /** @type {string | undefined} */
  let quote;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote !== undefined) {
      if (quote === '"' && char === "\\") {
        i += 1;
        continue;
      }
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      return { code: line.slice(0, i), comment: line.slice(i + 1).trim() };
    }
  }
  return { code: line, comment: undefined };
}

/**
 * YAML lets an anchor, an alias, a tag and an explicit-key `?` sit in front of a key in any
 * combination and order, so this loops rather than trying each once.
 *
 * @param {string} text already left-trimmed
 */
function stripKeyPrefixes(text) {
  let rest = text;
  for (;;) {
    const prefix =
      /^\?(?:[ \t]+|$)/.exec(rest) ??
      /^[&*][A-Za-z0-9_-]+[ \t]+/.exec(rest) ??
      /^![^\s,{}[\]]*[ \t]+/.exec(rest);
    if (prefix === null) return rest;
    rest = rest.slice(prefix[0].length).trimStart();
  }
}

/**
 * YAML decodes `\x75` to `u`, so `"\x75ses"` is the key `uses` in a form no textual
 * comparison catches. Rather than implement YAML's escape table, any double-quoted key
 * carrying a backslash is a candidate and therefore refused: the reader says it cannot tell.
 *
 * @param {string} text already left-trimmed, positioned at the key
 */
function isUndecodableQuotedKey(text) {
  if (!text.startsWith('"')) return false;
  const end = /^"(?:[^"\\]|\\.)*"/.exec(text);
  if (end === null) return text.includes("\\");
  return end[0].includes("\\");
}

/**
 * `requireColon` separates the two call sites: in block position `- ? uses` is a key whose
 * value is on the next line, while in flow position `[uses, x]` is a sequence of two scalars
 * and demanding the colon is what keeps it from being read as a key.
 *
 * @param {string} text the text from the candidate position onwards
 * @param {{ requireColon: boolean }} options
 */
function startsWithUsesKey(text, options) {
  const rest = stripKeyPrefixes(text.trimStart());
  if (isUndecodableQuotedKey(rest)) return true;
  const key = /^(?:"uses"|'uses'|uses)(?![A-Za-z0-9_-])/.exec(rest);
  if (key === null) return false;
  if (!options.requireColon) return true;
  return /^[ \t]*:/.test(rest.slice(key[0].length));
}

/**
 * Deliberately generous within the spellings it knows, because everything it admits and
 * `CANONICAL_USES` does not becomes a refusal: a near-miss is then a red rather than a
 * skipped line. The bound on what it recognises is in the file header.
 *
 * @param {string} code a line with its trailing comment already removed
 */
export function mentionsUsesKey(code) {
  for (const indicator of code.matchAll(FLOW_INDICATORS)) {
    if (startsWithUsesKey(code.slice(indicator.index + 1), { requireColon: true })) return true;
  }
  let rest = code.trimStart();
  const dash = SEQUENCE_DASH.exec(rest);
  if (dash !== null) rest = rest.slice(dash[0].length).trimStart();

  // A quoted scalar that does not close on this line folds the key across lines, so nothing
  // on any single line looks like `uses`. The reader refuses the indicator rather than
  // following it.
  const explicit = /^\?[ \t]+(["'])/.exec(rest);
  if (explicit !== null) {
    const quote = explicit[1] ?? '"';
    const closes =
      quote === '"'
        ? /^\?[ \t]+"(?:[^"\\]|\\.)*"/.test(rest)
        : /^\?[ \t]+'(?:[^']|'')*'/.test(rest);
    if (!closes) return true;
  }

  return startsWithUsesKey(rest, { requireColon: false });
}

/** @param {string} value */
function unquote(value) {
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * @param {string} value the value as written, quotes already removed
 * @returns {{ kind: Kind; action: string | undefined; ref: string | undefined; why: string | undefined }}
 */
export function classify(value) {
  const none = { action: undefined, ref: undefined, why: undefined };

  // Dependabot cannot track a `docker://` action reference, so one would be a mutable
  // reference with no updater behind it.
  if (value.startsWith("docker://")) return { kind: "docker", ...none };

  if (value.startsWith("./")) {
    // GitHub accepts no ref on a local reference, so one here means the author believes
    // something about this reference that is not true.
    if (value.includes("@")) {
      return { kind: "unknown", ...none, why: "a local reference cannot carry a ref" };
    }
    // `./.github/actions/../../tools/x` starts with a scanned prefix and lands outside it, so
    // the prefix test alone is not the containment check it looks like.
    if (value.split("/").includes("..")) {
      return {
        kind: "unknown",
        ...none,
        why:
          "a local reference containing a `..` segment escapes the directory its prefix " +
          "names, so where it actually points is not what the path reads as",
      };
    }
    if (!SCANNED_LOCAL_PREFIXES.some((prefix) => value.startsWith(prefix))) {
      return {
        kind: "unknown",
        ...none,
        why:
          "a local reference outside .github/actions/ and .github/workflows/ points at a " +
          "file this inventory does not read, so a third-party action called from inside " +
          "it would be unpinned and unseen",
      };
    }
    return { kind: "local", ...none };
  }
  // `.` or `..` leading anything else: not a form GitHub resolves, and not one to guess at.
  if (value.startsWith(".")) return { kind: "unknown", ...none };

  const at = value.indexOf("@");
  const path = at === -1 ? value : value.slice(0, at);
  const ref = at === -1 ? undefined : value.slice(at + 1);
  const parsed = ACTION_PATH.exec(path);
  const owner = parsed?.[1];
  const repo = parsed?.[2];
  if (owner === undefined || repo === undefined) return { kind: "unknown", ...none };
  // An empty or whitespace-bearing ref is not a ref; refuse rather than treat it as absent.
  if (ref !== undefined && (ref === "" || /\s/.test(ref))) return { kind: "unknown", ...none };

  return {
    kind: FIRST_PARTY_OWNERS.has(owner) ? "first-party" : "third-party",
    action: `${owner}/${repo}`,
    ref,
    why: undefined,
  };
}

/**
 * @param {string} file repository-relative path, used in the messages
 * @param {string} text the file's contents
 * @returns {Reference[]}
 */
export function usesReferences(file, text) {
  /** @type {Reference[]} */
  const references = [];
  const lines = text.split("\n");
  /** Column of the key that opened the current block scalar, or undefined outside one. */
  let blockKeyColumn;

  for (const [index, withCr] of lines.entries()) {
    const raw = withCr.endsWith("\r") ? withCr.slice(0, -1) : withCr;
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;

    // A block scalar's body is text, whatever it says. This is the only skip left.
    if (blockKeyColumn !== undefined) {
      if (indent > blockKeyColumn) continue;
      blockKeyColumn = undefined;
    }

    const { code, comment } = splitComment(raw);
    if (code.trim() === "") continue;

    // The `uses` test comes FIRST, so `uses: >-` is a refused reference and not a block
    // opener whose body then disappears.
    if (mentionsUsesKey(code)) {
      const line = index + 1;
      const match = CANONICAL_USES.exec(code);
      const written = match?.[1];
      const value = written === undefined ? undefined : unquote(written.trim());
      if (value === undefined || value === "" || /\s/.test(value)) {
        references.push({
          file,
          line,
          value: code.trim(),
          kind: "unknown",
          action: undefined,
          ref: undefined,
          comment,
          why:
            match === null
              ? "the token `uses` is in key position in a spelling this reader does not parse"
              : "the `uses:` key names no single unquoted value",
        });
        continue;
      }
      references.push({
        file,
        line,
        value,
        ...classify(value),
        comment: comment === undefined || comment === "" ? undefined : comment,
      });
      continue;
    }

    if (BLOCK_SCALAR.test(code.trimStart())) {
      blockKeyColumn = indent + (SEQUENCE_DASH.exec(code.trimStart())?.[0].length ?? 0);
    }
  }

  return references;
}

/**
 * The directories the `github-actions` updater searches, with no leading or trailing slash (the
 * root is the empty string). Throws on a shape it does not recognise.
 *
 * @param {string} dependabotYaml
 * @returns {string[]}
 */
export function dependabotActionsDirectories(dependabotYaml) {
  const lines = dependabotYaml
    .split("\n")
    .map((line) => splitComment(line).code.replace(/\s+$/, ""));
  const updatesAt = lines.findIndex((line) => line === "updates:");
  if (updatesAt === -1) {
    throw new Error("dependabotActionsDirectories: .github/dependabot.yml has no `updates:` key");
  }

  /** @type {{ ecosystem: string | undefined; directories: string[] }[]} */
  const entries = [];
  /** Indent of an open `directories:` block, while its `- item` lines are being collected. */
  let inDirectoriesBlock;

  for (const line of lines.slice(updatesAt + 1)) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // back out to another top-level key
    const body = line.trimStart();

    // A `directories:` block list stays open only while its own deeper items continue.
    if (inDirectoriesBlock !== undefined) {
      const listItem = /^-[ \t]+(\S+)$/.exec(body);
      if (indent > inDirectoriesBlock && listItem !== null) {
        entries.at(-1)?.directories.push(stripQuotes(listItem[1] ?? ""));
        continue;
      }
      inDirectoriesBlock = undefined;
    }

    const item = /^-[ \t]+(.*)$/.exec(body);
    const key = item === null ? body : (item[1] ?? "");
    if (item !== null && indent === 2) entries.push({ ecosystem: undefined, directories: [] });
    const current = entries.at(-1);
    if (current === undefined) continue;

    const ecosystem = /^package-ecosystem:[ \t]*(\S+)$/.exec(key);
    if (ecosystem?.[1] !== undefined) {
      current.ecosystem = stripQuotes(ecosystem[1]);
      continue;
    }
    const directory = /^directory:[ \t]*(\S+)$/.exec(key);
    if (directory?.[1] !== undefined) {
      current.directories.push(stripQuotes(directory[1]));
      continue;
    }
    const directories = /^directories:[ \t]*(.*)$/.exec(key);
    if (directories !== null) {
      const inline = (directories[1] ?? "").trim();
      if (inline === "") {
        inDirectoriesBlock = indent;
        continue;
      }
      if (!inline.startsWith("[") || !inline.endsWith("]")) {
        throw new Error(
          `dependabotActionsDirectories: \`directories: ${inline}\` is a shape this reader ` +
            "does not understand. Use a flow list or a block list of paths.",
        );
      }
      const within = inline.slice(1, -1).trim();
      if (within !== "") {
        for (const part of within.split(",")) current.directories.push(stripQuotes(part.trim()));
      }
    }
  }

  const actions = entries.filter((entry) => entry.ecosystem === "github-actions");
  if (actions.length === 0) {
    throw new Error(
      "dependabotActionsDirectories: .github/dependabot.yml declares no " +
        "`package-ecosystem: github-actions` entry, so no action pin has an updater at all",
    );
  }
  /** @type {string[]} */
  const normalised = [];
  for (const entry of actions) {
    if (entry.directories.length === 0) {
      throw new Error(
        "dependabotActionsDirectories: a `github-actions` entry declares neither `directory` " +
          "nor `directories`, which Dependabot requires, so its reach cannot be derived",
      );
    }
    for (const value of entry.directories) {
      const trimmed = value.replace(/^\/+/, "").replace(/\/+$/, "");
      if (!normalised.includes(trimmed)) normalised.push(trimmed);
    }
  }
  return normalised;
}

/**
 * @param {string} text
 */
function stripQuotes(text) {
  return unquote(text.trim());
}

/**
 * A directory `D` reaches `D/.github/workflows/<file>` and `D/action.yml`, not
 * `D/.github/actions/<name>/action.yml` (GitHub's semantics, SEC-11). `*` matches within a
 * segment and `**` spans segments.
 *
 * @param {string} path repository-relative, slash-separated
 * @param {string[]} directories from `dependabotActionsDirectories`
 */
export function coveredByDependabot(path, directories) {
  return directories.some((directory) => {
    const base = directory === "" ? "" : `${globToSource(directory)}/`;
    const workflows = new RegExp(String.raw`^${base}\.github/workflows/[^/]+\.ya?ml$`);
    const rootAction = new RegExp(String.raw`^${base}action\.ya?ml$`);
    return workflows.test(path) || rootAction.test(path);
  });
}

/** @param {string} directory */
function globToSource(directory) {
  return directory
    .split("**")
    .map((span) =>
      span
        .split("*")
        .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
        .join("[^/]*"),
    )
    .join(".*");
}

/**
 * @param {Reference[]} references every `uses:` read from the derived file set
 * @param {string[]} dependabotDirectories from `dependabotActionsDirectories`; required, so
 *   the gate cannot run without a model of which pins have an updater
 * @returns {string[]}
 */
export function pinProblems(references, dependabotDirectories) {
  if (!Array.isArray(dependabotDirectories)) {
    throw new TypeError("pinProblems: dependabotDirectories is required");
  }

  /** @type {string[]} */
  const problems = [];

  // An enumeration that found nothing would leave every check below vacuously true, which is
  // the fail-open direction this whole file is arranged against.
  if (references.length === 0) {
    problems.push(
      "no `uses:` reference was read from .github/workflows/** or .github/actions/**, so " +
        "this guard would assert nothing. Either the reader broke or the file pattern no " +
        "longer reaches the workflows.",
    );
    return problems;
  }

  for (const reference of references) {
    const at = `${reference.file}:${String(reference.line)}`;
    switch (reference.kind) {
      case "unknown": {
        problems.push(
          `${at}: \`${reference.value}\` is refused: ` +
            `${reference.why ?? "this is not a `uses:` shape the reader parses"}. A reference ` +
            "nobody classified is a reference nobody pinned, so this is a red rather than a " +
            "skipped line. Write it as `uses: owner/repo@ref`, `uses: ./.github/actions/<name>` " +
            "or teach scripts/actions-pinned.mjs the spelling.",
        );
        break;
      }
      case "docker": {
        problems.push(
          `${at}: \`${reference.value}\` is a Docker container action. Dependabot does not ` +
            "support `docker://` references, so it would be a mutable pin with no updater " +
            "behind it - the arrangement #372 rejected for base images. This needs a Code " +
            "Owner decision and a rule in scripts/actions-pinned.mjs, not a tag.",
        );
        break;
      }
      case "local": {
        // Nothing to pin: a local action is in this repository and is reviewed in the pull
        // request that changes it.
        break;
      }
      case "first-party": {
        if (reference.ref === undefined) {
          problems.push(
            `${at}: \`${reference.value}\` names no ref, so it resolves to the action's ` +
              "default branch and runs whatever is on it.",
          );
          break;
        }
        if (!FIRST_PARTY_REF.test(reference.ref)) {
          problems.push(
            `${at}: \`${reference.value}\` puts a first-party action on \`${reference.ref}\`, ` +
              "which is not a version tag. The ruling keeps GitHub's own actions on version " +
              "tags, and a branch name is a moving pointer with no version in it at all. Use " +
              "`@vX` or `@vX.Y.Z` (a commit SHA is also accepted, being stricter).",
          );
        }
        break;
      }
      case "third-party": {
        if (reference.ref === undefined) {
          problems.push(
            `${at}: \`${reference.value}\` is a third-party action naming no ref at all, so it ` +
              "runs the default branch. Pin it to a full 40-character commit SHA with the " +
              "version in a trailing comment (SEC-11, issue #948).",
          );
          break;
        }
        if (!FULL_SHA.test(reference.ref)) {
          problems.push(
            `${at}: \`${reference.value}\` pins the third-party action ` +
              `${reference.action ?? "(unknown)"} to \`${reference.ref}\`, which is not a ` +
              "40-character lowercase hex commit SHA. A tag is mutable and a short SHA is not " +
              "what GitHub treats as an immutable release. Resolve the tag " +
              `(\`gh api repos/${reference.action ?? "<owner>/<repo>"}/git/ref/tags/<tag>\`, ` +
              "dereferencing an annotated tag) and write `uses: owner/repo@<sha> # vX.Y.Z`.",
          );
          break;
        }
        if (reference.comment === undefined) {
          problems.push(
            `${at}: \`${reference.value}\` is pinned but carries no trailing version comment. ` +
              "Dependabot updates the version documentation only when the comment is on the " +
              "same line, and the comment is also the only readable statement of which release " +
              "the SHA is. Write `# vX.Y.Z` after it.",
          );
          break;
        }
        const token = reference.comment.split(/\s+/)[0] ?? "";
        if (!RELEASE_VERSION.test(token)) {
          problems.push(
            `${at}: the trailing comment \`# ${reference.comment}\` does not begin with a ` +
              "complete release version. A major-only tag such as `v6` names whatever release " +
              "that tag pointed at, which is the ambiguity the SHA removed from the ref; write " +
              "`# vX.Y.Z`.",
          );
          break;
        }
        if (!coveredByDependabot(reference.file, dependabotDirectories)) {
          problems.push(
            `${at}: \`${reference.value}\` is a third-party pin in a file Dependabot's ` +
              "`github-actions` updater does not search. For GitHub Actions it searches " +
              "`<directory>/.github/workflows` and a `<directory>/action.yml` only, and this " +
              `configuration covers ${describeDirectories(dependabotDirectories)}. So this pin ` +
              "would never be bumped - a dependency ageing quietly, which is worse than the " +
              "moving tag it replaced (#372). Add a `directories` entry to " +
              ".github/dependabot.yml that covers this file, or move the step into a workflow.",
          );
        }
        break;
      }
    }
  }

  // One pin per repository, first-party included and case-insensitively: Dependabot moves every
  // occurrence together, so a divergence is a hand edit. Local and `docker://` references have no
  // repository pin to compare.
  /** @type {Map<string, Reference[]>} */
  const byRepository = new Map();
  for (const reference of references) {
    if (reference.kind !== "third-party" && reference.kind !== "first-party") continue;
    if (reference.action === undefined) continue;
    const key = reference.action.toLowerCase();
    const seen = byRepository.get(key);
    if (seen === undefined) byRepository.set(key, [reference]);
    else seen.push(reference);
  }
  for (const [repository, group] of byRepository) {
    const pins = new Set(group.map(pinIdentity));
    if (pins.size > 1) {
      problems.push(
        `${repository} is referenced at more than one pin: ${[...pins].sort().join(" / ")}. Two ` +
          "releases of one action running in one repository is the #948 defect itself; the " +
          `references are at ${group
            .map((reference) => `${reference.file}:${String(reference.line)}`)
            .join(", ")}.`,
      );
    }
  }

  return problems;
}

/**
 * For a third-party reference the version comment is part of the pin; for a first-party one it
 * carries no requirement, so it is not part of the identity.
 *
 * @param {Reference} reference
 */
function pinIdentity(reference) {
  const ref = reference.ref ?? "(none)";
  if (reference.kind !== "third-party") return ref;
  return `${ref} # ${reference.comment ?? "(none)"}`;
}

/**
 * @param {string[]} directories
 */
function describeDirectories(directories) {
  return directories
    .map((directory) => (directory === "" ? "the repository root" : directory))
    .join(", ");
}
