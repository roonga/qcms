#!/usr/bin/env node
// @ts-check
/**
 * The action-pin rule, as functions over text (issue #948; Code Owner ruling of 2026-09-19).
 *
 * Every `uses:` this repository executes is classified, and a third-party one is pinned to a
 * full-length commit SHA with the version in a trailing comment. The reasoning, the sources
 * and the first-party carve-out are in SEC-11 of `docs/SECURITY_DESIGN.md`; the contributor
 * -facing version is in CONTRIBUTING. `scripts/check-actions-pinned.test.ts` is what runs
 * these functions over the repository.
 *
 * This is a module rather than code inside the test so a reviewer can drive it without
 * Vitest (`node -e 'import("./scripts/actions-pinned.mjs").then(...)'`), which is how the
 * #972 review found the spellings below.
 *
 * ## The reader's default is refusal
 *
 * The first version of this reader recognised one spelling of a `uses:` key and `continue`d
 * past every other line, so "unknown" was reachable only for a line that already looked like
 * the shape it understood. Nine valid YAML spellings of a `uses:` key therefore disappeared
 * in silence, each of them able to carry an unpinned third-party action: a flow mapping, a
 * flow sequence, a double-quoted key, a single-quoted key, a space before the colon, a folded
 * scalar value, a literal scalar value, an anchored key and an explicit key. A gate that
 * claims the inventory cannot shrink quietly has to be right about that, so the default
 * is inverted here: a line the reader recognises as putting `uses` in key position is either
 * parsed as the one canonical form or refused by file and line. Only the canonical form is
 * parsed, deliberately - this repository writes one spelling, and a refusal that names the
 * line and asks for `uses: owner/repo@ref` is cheaper to act on than a parser for nine
 * equivalent forms.
 *
 * ## What "recognises" covers, and what it does not
 *
 * The bound matters, because an earlier version of this comment claimed every spelling and
 * the #972 delta review falsified it in eight lines. What is recognised is: the bare key, a
 * single- or double-quoted key, any run of explicit-key `?`, anchor, alias and tag before it,
 * a key after any flow indicator, a space or nothing between the key and its colon, and a
 * double-quoted key carrying a backslash - which is refused outright rather than decoded,
 * since YAML turns `"\x75ses"` into `uses` and this reader does not implement that table.
 * `splitComment` honours `\"` inside a double-quoted scalar, and an explicit key whose quoted
 * scalar does not close on its line is refused rather than followed.
 *
 * What it is NOT is a YAML parser, and it does not claim to see every way the language can
 * spell a key. It guards against drift and honest mistakes - a contributor writing a form
 * this repository does not use, a tool rewriting a line - and not against someone
 * deliberately obfuscating a key to smuggle an unpinned action past it. That is what review
 * is for, and a by-shape reader cannot be made to replace it.
 *
 * The one thing still skipped is a block scalar's body, because a `uses:` inside a
 * `run: |` shell script is shell text and not a reference. The `uses` test runs **before**
 * the block-scalar test, so `uses: >-` is a refused reference rather than a block opener.
 */

/**
 * The owners whose actions GitHub itself publishes, and the entire carve-out.
 *
 * Any other owner is third-party and must be a SHA, so the default is the strict side: a new
 * owner appearing in a workflow fails until someone pins it, rather than being admitted
 * because nobody added it to a list. The comparison is case-sensitive on purpose, which is
 * also the strict side: `Actions/checkout@v7` is held to the third-party rule.
 */
export const FIRST_PARTY_OWNERS = new Set(["actions", "github"]);

/** A full-length commit SHA as git writes one. Lowercase hex, exactly 40. */
export const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The trailing comment's first token: a complete three-part release.
 *
 * `v6` is refused although GitHub's `#<tag or link>` form would accept it (#972 review,
 * Copilot on the same line). A major-only comment re-admits into the comment exactly the
 * ambiguity the SHA removed from the ref - `v6` named two different releases during the life
 * of this repository - and the comment's whole job is to say which release the SHA is.
 *
 * A SemVer pre-release or build suffix is allowed (`v1.2.3-rc.1`, `v1.2.3+build.4`), because
 * upstream does publish releases in that form and refusing them would force the comment to
 * misname the release it documents. Anything after the first token is free text, so
 * `# v6.0.10 (https://github.com/pnpm/action-setup/releases/tag/v6.0.10)` is fine; a link
 * alone is not, for the same reason `v6` is not.
 */
export const RELEASE_VERSION =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.]*)?$/;

/**
 * What a first-party ref may be: a version tag, or a commit SHA.
 *
 * The ruling says GitHub's own actions "stay on version tags", which is narrower than "has
 * some ref": a first-party `@main` is a ref and is still a moving branch, so it is refused
 * (#972 review, Low). A SHA is accepted because it is stricter than the rule asks, never
 * looser.
 */
export const FIRST_PARTY_REF =
  /^(?:[0-9a-f]{40}|v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z][0-9A-Za-z.]*)?)$/;

/**
 * The files whose `uses:` lines GitHub executes.
 *
 * Any depth under either directory, which is a superset of what GitHub reads (workflows must
 * sit directly in `.github/workflows/`), because a superset can only add a file to the
 * inventory and a tighter pattern can lose one.
 */
export const ACTION_FILES = /^\.github\/(?:workflows|actions)\/.*\.ya?ml$/;

/** The local reference prefixes whose own `uses:` lines this inventory reaches. */
const SCANNED_LOCAL_PREFIXES = ["./.github/actions/", "./.github/workflows/"];

// ---------------------------------------------------------------------------
// Reading the `uses:` lines.
//
// By shape rather than with a YAML parser: no YAML parser is resolvable from this repository,
// and the established answer is to read the shape rather than add a dependency for a
// one-property read (`scripts/check-docker-job-guards.mjs` says so in as many words;
// `scripts/check-ci-parity.mjs` and `scripts/check-dependabot-groups.test.ts` do the same).
// ---------------------------------------------------------------------------

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
 * @property {string | undefined} action `owner/repo` for a remote reference.
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
 * Split a line into its code and its trailing comment, respecting quotes.
 *
 * A `#` begins a comment only at the start of the content or after whitespace, and only
 * outside a quoted scalar - so `run: echo a#b` keeps its `#` and `uses: x # v1.2.3` does not.
 *
 * A backslash escapes the next character inside a DOUBLE-quoted scalar, and the #972 delta
 * review turned that omission into a hole: in `{ name: "a\" # ", uses: evil/action@v1 }` the
 * escaped quote closed the string early here, the rest of the line became a comment, and the
 * `uses` key after it was never seen. Single quotes have no backslash escape in YAML (a
 * doubled `''` is the only one, and closing then reopening leaves this scan in the same
 * place), so the escape is honoured for double quotes alone.
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
 * Strip the node properties and explicit-key indicator that may precede a key.
 *
 * YAML lets an anchor (`&a`), an alias (`*a`), a tag (`!!str`, `!mytag`) and an explicit-key
 * `?` sit in front of a key in any combination and order, so this loops rather than trying
 * each once. The #972 delta review found `- !!str uses:` and `- &a !!str uses:` walking past
 * a version of this that stripped only an anchor.
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
 * A double-quoted scalar this reader will not decode.
 *
 * YAML decodes `\x75` to `u`, so `"\x75ses"` is the key `uses` written in a way no textual
 * comparison catches. Rather than implement YAML's escape table for one key, any
 * double-quoted key carrying a backslash is treated as a candidate and therefore refused:
 * the reader says it cannot tell, instead of deciding it is not `uses` (#972 delta review).
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
 * Is a `uses` key starting here, in one of the spellings this reader knows to look for?
 *
 * Used at the head of a line and just after each flow indicator. `requireColon` is the
 * difference between the two: in block position `- ? uses` is a key with its value on the
 * next line and there is no colon to demand, while in flow position `[uses, x]` is a
 * sequence of two scalars and demanding the colon is what keeps it from being read as a key.
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
 * Does this line put the token `uses` in a YAML key position?
 *
 * Deliberately generous within the spellings it knows: it strips one sequence dash, then any
 * run of explicit-key `?`, anchor, alias and tag, in block position and after each flow
 * indicator, and asks whether the key is `uses` bare or quoted - or a double-quoted key it
 * cannot decode, which is a candidate precisely because the reader cannot rule it out. The
 * generosity is the point: everything it admits and `CANONICAL_USES` does not is a refusal,
 * so a near-miss of a spelling it knows is a red rather than a skipped line.
 *
 * What it does not claim is to see EVERY way YAML can spell a key. The bound, and the reason
 * it is an acceptable one, are in the file header.
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

  // An explicit key whose quoted scalar does not close on this line folds the key across
  // lines, so nothing on any single line looks like `uses` (#972 delta review). The reader
  // cannot follow it, so it refuses the indicator rather than the key.
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

/**
 * Strip one pair of matching quotes, if the whole value is quoted.
 *
 * @param {string} value
 */
function unquote(value) {
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Classify one `uses:` value.
 *
 * @param {string} value the value as written, quotes already removed
 * @returns {{ kind: Kind; action: string | undefined; ref: string | undefined; why: string | undefined }}
 */
export function classify(value) {
  const none = { action: undefined, ref: undefined, why: undefined };

  // A Docker container action. None exists here, and this is the explicit handling rather
  // than a gap: Dependabot cannot track one ("references to Docker container actions using
  // `docker://` syntax aren't supported"), so a `docker://` tag would be a mutable reference
  // with no updater behind it - the arrangement #372 rejected for base images.
  if (value.startsWith("docker://")) return { kind: "docker", ...none };

  if (value.startsWith("./")) {
    // GitHub accepts no ref on a local reference, so one here means the author believes
    // something about this reference that is not true.
    if (value.includes("@")) {
      return { kind: "unknown", ...none, why: "a local reference cannot carry a ref" };
    }
    // `./.github/actions/../../tools/x` starts with a scanned prefix and lands outside it,
    // so the prefix test alone is not the containment check it looks like (#972 delta review).
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
 * Every `uses:` reference one workflow or composite action declares, plus every line that
 * mentions the key in a spelling this reader refuses.
 *
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
    // opener whose body then disappears (#972 review, B3).
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

// ---------------------------------------------------------------------------
// Dependabot's reach.
// ---------------------------------------------------------------------------

/**
 * The directories the `github-actions` updater is configured to search, normalised with no
 * leading or trailing slash (the repository root is the empty string).
 *
 * Read by shape, fail loud, and derived from `.github/dependabot.yml` rather than written
 * down here. `scripts/check-dependabot-groups.test.ts` has a fuller YAML reader and exports
 * it, but it is a **test** file: importing it from a module would register its suites inside
 * whatever imported it. So this reads the three keys it needs and throws on a shape it does
 * not recognise, rather than either duplicating that reader or guessing.
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
 * Is this file inside the `github-actions` updater's configured reach?
 *
 * The semantics are GitHub's, quoted in SEC-11: "Define directories relative to the root of
 * the repository for most package managers. For GitHub Actions, use the value `/`. Dependabot
 * will search the `/.github/workflows` directory, as well as the `action.yml`/`action.yaml`
 * file from the root directory" (Dependabot options reference, `directories or directory`,
 * read 2026-09-19). So a directory `D` reaches `D/.github/workflows/<file>` and
 * `D/action.yml` - and **not** `D/.github/actions/<name>/action.yml`, which is why a
 * third-party reference inside a local composite action would be a pin with no updater.
 *
 * `directories` supports the wildcard `*` ("The `directories` key supports globbing and the
 * wildcard character `*`. These features are not supported by the `directory` key"), so a
 * segment wildcard is honoured here; `**` spans segments.
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

/**
 * A Dependabot directory glob as a regular-expression source.
 *
 * @param {string} directory
 */
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

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------

/**
 * Every way the inventory can break the ruling, as one list, so a mutation can be shown to
 * break exactly the assertion it should.
 *
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
        // Nothing to pin: the action is in this repository and is reviewed in the pull
        // request that changes it. `pnpm check:docker-job-guards` asserts which jobs
        // reference which local action.
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

  // One action, one pin. Six files named `pnpm/action-setup@v6.0.9` and two the moving `@v6` when
  // #948 was raised, which is how a repository comes to run two releases of one action
  // without saying so. Dependabot moves every occurrence together, so a divergence after
  // this point is a hand edit, and it should be a red rather than a discovery. Keyed
  // case-insensitively, because GitHub resolves `Pnpm/Action-Setup` to the same repository.
  /** @type {Map<string, Reference[]>} */
  const byAction = new Map();
  for (const reference of references) {
    if (reference.kind !== "third-party" || reference.action === undefined) continue;
    const key = reference.action.toLowerCase();
    const seen = byAction.get(key);
    if (seen === undefined) byAction.set(key, [reference]);
    else seen.push(reference);
  }
  for (const [action, group] of byAction) {
    const pins = new Set(
      group.map((reference) => `${reference.ref ?? "(none)"} # ${reference.comment ?? "(none)"}`),
    );
    if (pins.size > 1) {
      problems.push(
        `${action} is referenced at more than one pin: ${[...pins].sort().join(" / ")}. Two ` +
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
 * @param {string[]} directories
 */
function describeDirectories(directories) {
  return directories
    .map((directory) => (directory === "" ? "the repository root" : directory))
    .join(", ");
}
