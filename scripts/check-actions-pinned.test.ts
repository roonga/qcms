import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * Every `uses:` this repository executes is classified, and a third-party one is pinned to
 * a full-length commit SHA (issue #948; Code Owner ruling of 2026-09-19).
 *
 * A tag is a mutable pointer: the owner of the action's repository can move it to any
 * commit at any time, and a workflow that names one runs whatever it points at on the day
 * it runs. GitHub says so itself: "Pinning an action to a full-length commit SHA is
 * currently the only way to use an action as an immutable release", and "Pinning to a
 * particular SHA helps mitigate the risk of a bad actor adding a backdoor to the action's
 * repository, as they would need to generate a SHA-1 collision for a valid Git object
 * payload" (https://docs.github.com/en/actions/reference/security/secure-use, read
 * 2026-09-19). This repository already made the same argument one layer down, for
 * container base images under SEC-11 (#372), so an Actions reference by tag was an
 * undocumented gap rather than a recorded deviation.
 *
 * The mutability is not hypothetical here. At the time of #948 six files named
 * `pnpm/action-setup@v6.0.9` and two named `pnpm/action-setup@v6`, and the moving major
 * tag `v6` resolved to the `v6.0.10` commit - so two jobs in this repository were running
 * a different release of the same action from the other six, and nothing in the tree said
 * which. That is the whole defect class in one line: the reference did not name what ran.
 *
 * ## The rule, and the carve-out
 *
 * The Code Owner's ruling has three classes, and this guard is the thing that keeps a new
 * `uses:` inside one of them:
 *
 *   - **third-party** (any owner but the two below): a 40-character lowercase hex commit
 *     SHA, with the version in a trailing comment.
 *   - **first-party** (`actions/*`, `github/*`, published by GitHub itself): a version tag
 *     is accepted, because the trust argument that motivates a SHA is an argument about a
 *     third party's repository, and GitHub already runs the code that would consume the
 *     pin. What is still refused is no ref at all, which resolves to the action's default
 *     branch.
 *   - **local** (`./.github/actions/...`): neither. A composite action in this repository
 *     is reviewed in the pull request that changes it, like any other first-party file,
 *     and GitHub does not accept a ref on a local reference at all.
 *
 * ## How a bump arrives
 *
 * `.github/dependabot.yml`'s `actions` group, weekly. That half is load-bearing rather
 * than incidental, for the reason #372 recorded for base-image digests: a pin with no
 * updater is a dependency that ages quietly, which is worse than the moving tag it
 * replaced. Checked against GitHub's own documentation rather than assumed
 * (https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories,
 * "GitHub Actions", read 2026-09-19), three sentences of which decide the format asserted
 * below:
 *
 *   - "Dependabot only supports updates to GitHub Actions using the GitHub repository
 *     syntax, such as `actions/checkout@v6` or `actions/checkout@<commit>`. Dependabot
 *     will ignore actions or reusable workflows referenced locally (for example,
 *     `./.github/actions/foo.yml`)." - so a SHA pin is a form the updater moves, and the
 *     local class is outside its reach by design rather than by omission.
 *   - "Dependabot updates the version documentation of GitHub Actions when the comment is
 *     on the same line, such as `actions/checkout@<commit> #<tag or link>` or
 *     `actions/checkout@<tag> #<tag or link>`." - so the trailing comment is machine-read,
 *     not decoration, and it has to be on the same line. That is why a missing or
 *     unreadable comment is a failure here and not a style note.
 *   - "If the commit you use is not associated with any tag, Dependabot will update the
 *     GitHub Actions to the latest commit (which might differ from the latest release)."
 *     - so a SHA that is not a release commit silently opts out of release-based bumps,
 *     which is the other reason the comment is required: it is the claim about which
 *     release the SHA is.
 *
 * ## What this cannot prove
 *
 * That the SHA is the commit the version comment names. Resolving a tag needs the network,
 * and every gate in `pnpm verify` runs offline. So the comment is checked for being a
 * readable tag or link and not for being true; the truth of it is established once, by
 * hand, when the pin is written, and recorded in the pull request that writes it (this
 * one resolved `pnpm/action-setup@v6.0.9` through its annotated tag object
 * `008330803749db0355799c700092d9a85fd074e9` to commit
 * `0ebf47130e4866e96fce0953f49152a61190b271`, confirmed twice: `gh api
 * repos/pnpm/action-setup/git/ref/tags/v6.0.9` plus the tag dereference, and
 * `git ls-remote --tags` reading `refs/tags/v6.0.9^{}`). After that, Dependabot owns the
 * pair and moves both together.
 *
 * ## Why a test rather than a `check:*` script
 *
 * Two reasons, and the second is the deciding one. `scripts/check-dependabot-groups.test.ts`
 * (issue #889) is the closest precedent in the tree - a derived guard over a file in
 * `.github/`, asserting a property nothing else asserts, living in the `tooling` Vitest
 * project because that project runs from the repository root and outside turbo, so it reads
 * the tree as it is. And a new `check:*` in `check:all` must also appear as its own step in
 * `ci.yml`'s `verify` job, which `pnpm check:ci-parity` enforces: that is a workflow edit
 * beyond the `uses:` lines, in a file two other pull requests are changing at the same
 * time. Nothing here needs to run outside `pnpm test`, so the cheaper seam is the right
 * one.
 *
 * ## What is derived and what is written down
 *
 * The file set comes from git, through `trackedFilesUnder`, per CONTRIBUTING's rule for a
 * test that asserts a property of every X in the codebase (issues #635, #641): a directory
 * walk reads a checkout's leftovers as source and asserts a property of the machine rather
 * than of the repository. Both `.github/workflows/**` and `.github/actions/**` are in the
 * pattern, because a composite action can reference a third-party action too, and the
 * inventory has to cover the places a `uses:` can execute rather than the one place they
 * happen to live today. What is written down is only the subject of the guard: the two
 * first-party owners, and the shape of a commit SHA.
 *
 * The reader refuses a `uses:` shape it does not understand instead of skipping it, so the
 * set cannot shrink quietly. Every assertion is a pure function over the read references,
 * and each is proved non-vacuous below by mutating a copy; two cases mutate workflow TEXT
 * instead, because a defect in how the text becomes that model is invisible to a mutation
 * of the model.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The owners whose actions GitHub itself publishes, and the entire carve-out.
 *
 * Any other owner is third-party and must be a SHA, so the default is the strict side: a
 * new owner appearing in a workflow fails this guard until someone pins it, rather than
 * being admitted because nobody added it to a list.
 */
const FIRST_PARTY_OWNERS = new Set(["actions", "github"]);

/** A full-length commit SHA as git writes one. Lowercase hex, exactly 40. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The trailing comment's first token, in the `#<tag or link>` form GitHub documents.
 *
 * A tag (`v6.0.9`, `6.0.9`) or a URL. `# pinned` and `# see the PR` are refused: the
 * comment is what says which release the SHA is, so a comment that names no version is
 * the same as none.
 */
const TAG_OR_LINK = /^(?:https?:\/\/\S+|v?\d[A-Za-z0-9._+-]*)$/;

/**
 * The files whose `uses:` lines GitHub executes.
 *
 * Any depth under either directory, which is a superset of what GitHub reads (workflows
 * must sit directly in `.github/workflows/`), because a superset can only ever add a file
 * to the inventory and a tighter pattern can lose one.
 */
const ACTION_FILES = /^\.github\/(?:workflows|actions)\/.*\.ya?ml$/;

// ---------------------------------------------------------------------------
// Reading the `uses:` lines.
//
// By shape rather than with a YAML parser: no YAML parser is resolvable from this
// repository, and the established answer is to read the shape rather than add a dependency
// for a one-property read (`scripts/check-docker-job-guards.mjs` says so in as many words,
// `scripts/check-ci-parity.mjs` and `scripts/check-dependabot-groups.test.ts` do the same).
// ---------------------------------------------------------------------------

/** The three classes of the ruling, plus the two shapes that are refusals. */
type Kind = "first-party" | "third-party" | "local" | "docker" | "unknown";

interface Reference {
  /** Repository-relative path of the file the reference was read from. */
  file: string;
  /** 1-based line number, so a failure names the line to edit. */
  line: number;
  /** The `uses:` value with quotes removed, or the whole line body for an unknown shape. */
  value: string;
  kind: Kind;
  /** `owner/repo` for a remote reference; undefined for local, docker and unknown. */
  action: string | undefined;
  /** Whatever follows `@`; undefined when the reference names no ref at all. */
  ref: string | undefined;
  /** The same-line trailing comment, trimmed; undefined when there is none. */
  comment: string | undefined;
}

/** A key whose value is a block scalar: everything indented under it is text, not YAML. */
const BLOCK_SCALAR = /^(?:-\s+)?[A-Za-z0-9_.-]+:[ \t]*[|>][+-]?\d*[ \t]*$/;

/** A `uses:` key, in either the sequence-item or the plain-key position. */
const USES_KEY = /^[ \t]*(?:-[ \t]+)?uses:/;

/** The whole line, when it is one this guard understands. */
const USES_LINE =
  /^[ \t]*(?:-[ \t]+)?uses:[ \t]+(?:(["'])(.*?)\1|([^\s#]+))[ \t]*(?:#[ \t]*(.*?))?[ \t]*$/;

/** A leading sequence dash, whose width the block-scalar indent has to account for. */
const SEQUENCE_DASH = /^-[ \t]+/;

/**
 * `owner/repo` or `owner/repo/path`, with no ref attached.
 *
 * Anchored on both sides so a value this guard has not thought about cannot slip through
 * as a plausible-looking action path.
 */
const ACTION_PATH =
  /^(?<owner>[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\/(?<repo>[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._\-/]+)?$/;

/**
 * Classify one `uses:` value.
 *
 * @param value the value as written, quotes already removed
 */
export function classify(value: string): Pick<Reference, "kind" | "action" | "ref"> {
  const none = { action: undefined, ref: undefined };

  // A Docker container action. None exists in this repository, and this is the explicit
  // handling rather than a gap: Dependabot cannot track one ("references to Docker
  // container actions using `docker://` syntax aren't supported", same GitHub page as
  // above), so a `docker://` tag would be a mutable reference with no updater behind it -
  // the exact arrangement #372 rejected for base images. If one is ever needed, it is a
  // decision with a digest and a recorded reason, and this guard learns the rule then.
  if (value.startsWith("docker://")) return { kind: "docker", ...none };

  if (value.startsWith("./")) {
    // GitHub does not accept a ref on a local reference, so one here means the author
    // believes something about this reference that is not true.
    return value.includes("@") ? { kind: "unknown", ...none } : { kind: "local", ...none };
  }
  // `.` or `..` leading anything else: not a form GitHub resolves, and not one to guess at.
  if (value.startsWith(".")) return { kind: "unknown", ...none };

  const at = value.indexOf("@");
  const path = at === -1 ? value : value.slice(0, at);
  const ref = at === -1 ? undefined : value.slice(at + 1);
  const parsed = ACTION_PATH.exec(path);
  const owner = parsed?.groups?.["owner"];
  const repo = parsed?.groups?.["repo"];
  if (owner === undefined || repo === undefined) return { kind: "unknown", ...none };
  // An empty or whitespace-bearing ref is not a ref; refuse rather than treat it as absent.
  if (ref !== undefined && (ref === "" || /\s/.test(ref))) return { kind: "unknown", ...none };

  return {
    kind: FIRST_PARTY_OWNERS.has(owner) ? "first-party" : "third-party",
    action: `${owner}/${repo}`,
    ref,
  };
}

/**
 * Every `uses:` reference one workflow or composite action declares.
 *
 * Block scalars are skipped, so a `uses:` written inside a `run: |` shell body is shell
 * text and not an action reference. Anything sitting in the `uses:` key position that this
 * reader cannot parse comes back as `kind: "unknown"` and fails below, which is the
 * "never read past a shape you do not understand" half: the corpus cannot shrink silently.
 *
 * @param file repository-relative path, used only in the messages
 * @param text the file's contents
 */
export function usesReferences(file: string, text: string): Reference[] {
  const references: Reference[] = [];
  const lines = text.split("\n");
  /** Column of the key that opened the current block scalar, or undefined outside one. */
  let blockKeyColumn: number | undefined;

  for (const [index, raw] of lines.entries()) {
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    if (blockKeyColumn !== undefined) {
      if (indent > blockKeyColumn) continue;
      blockKeyColumn = undefined;
    }

    const body = raw.trimStart();
    if (BLOCK_SCALAR.test(body)) {
      blockKeyColumn = indent + (SEQUENCE_DASH.exec(body)?.[0].length ?? 0);
      continue;
    }

    if (!USES_KEY.test(raw)) continue;
    const line = index + 1;
    const match = USES_LINE.exec(raw);
    if (match === null) {
      references.push({
        file,
        line,
        value: body,
        kind: "unknown",
        action: undefined,
        ref: undefined,
        comment: undefined,
      });
      continue;
    }
    const value = match[2] ?? match[3] ?? "";
    const comment = match[4];
    references.push({
      file,
      line,
      value,
      ...classify(value),
      comment: comment === undefined || comment.trim() === "" ? undefined : comment.trim(),
    });
  }

  return references;
}

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------

/**
 * Every way the inventory can break the ruling, as one list, so a mutation can be shown to
 * break exactly the assertion it should.
 *
 * @param references every `uses:` read from the derived file set
 */
export function pinProblems(references: Reference[]): string[] {
  const problems: string[] = [];

  // An enumeration that found nothing would leave every check below vacuously true, which
  // is the fail-open direction this whole file is arranged against.
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
          `${at}: \`${reference.value}\` is a \`uses:\` shape this guard does not ` +
            "understand. It is refused rather than skipped, because a reference nobody " +
            "classified is a reference nobody pinned. Teach this file the shape, or write " +
            "the reference in one of the three documented forms.",
        );
        break;
      }
      case "docker": {
        problems.push(
          `${at}: \`${reference.value}\` is a Docker container action. Dependabot does not ` +
            "support `docker://` references, so it would be a mutable pin with no updater " +
            "behind it - the arrangement #372 rejected for base images. This needs a Code " +
            "Owner decision and a rule in this file, not a tag.",
        );
        break;
      }
      case "local": {
        // Nothing to pin: the action is in this repository and is reviewed in the pull
        // request that changes it. `pnpm check:docker-job-guards` is what asserts which
        // jobs reference which local action.
        break;
      }
      case "first-party": {
        if (reference.ref === undefined) {
          problems.push(
            `${at}: \`${reference.value}\` names no ref, so it resolves to the action's ` +
              "default branch and runs whatever is on it. A first-party action may stay on " +
              "a version tag, but it must name one.",
          );
        }
        break;
      }
      case "third-party": {
        if (reference.ref === undefined) {
          problems.push(
            `${at}: \`${reference.value}\` is a third-party action naming no ref at all, so ` +
              "it runs the default branch. Pin it to a full 40-character commit SHA with " +
              "the version in a trailing comment (SEC-11, issue #948).",
          );
          break;
        }
        if (!FULL_SHA.test(reference.ref)) {
          problems.push(
            `${at}: \`${reference.value}\` pins the third-party action ` +
              `${reference.action ?? "(unknown)"} to \`${reference.ref}\`, which is not a ` +
              "40-character lowercase hex commit SHA. A tag is mutable and a short SHA is " +
              "not what GitHub treats as an immutable release. Resolve the tag " +
              `(\`gh api repos/${reference.action ?? "<owner>/<repo>"}/git/ref/tags/<tag>\`, ` +
              "dereferencing an annotated tag) and write `uses: owner/repo@<sha> # vX.Y.Z`.",
          );
          break;
        }
        if (reference.comment === undefined) {
          problems.push(
            `${at}: \`${reference.value}\` is pinned but carries no trailing version ` +
              "comment. Dependabot updates the version documentation only when the comment " +
              "is on the same line, and the comment is also the only readable statement of " +
              "which release the SHA is. Write `# vX.Y.Z` after it.",
          );
          break;
        }
        const token = reference.comment.split(/\s+/)[0] ?? "";
        if (!TAG_OR_LINK.test(token)) {
          problems.push(
            `${at}: the trailing comment \`# ${reference.comment}\` names no version. ` +
              "Dependabot reads this comment as the version documentation, so it has to be " +
              "a tag or a link (`# v6.0.9`), not prose.",
          );
        }
        break;
      }
    }
  }

  // One action, one pin. Six files named `pnpm/action-setup@v6.0.9` and two named `@v6`
  // when #948 was raised, which is how a repository comes to run two releases of one
  // action without saying so. Dependabot moves every occurrence together, so a divergence
  // after this point is a hand edit, and it should be a red rather than a discovery.
  const byAction = new Map<string, Reference[]>();
  for (const reference of references) {
    if (reference.kind !== "third-party" || reference.action === undefined) continue;
    const seen = byAction.get(reference.action);
    if (seen === undefined) byAction.set(reference.action, [reference]);
    else seen.push(reference);
  }
  for (const [action, group] of byAction) {
    const pins = new Set(
      group.map((reference) => `${reference.ref ?? "(none)"} # ${reference.comment ?? "(none)"}`),
    );
    if (pins.size > 1) {
      problems.push(
        `${action} is referenced at more than one pin: ${[...pins].sort().join(" / ")}. ` +
          "Two releases of one action running in one repository is the #948 defect itself; " +
          `the references are at ${group.map((reference) => `${reference.file}:${String(reference.line)}`).join(", ")}.`,
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Reading the repository.
// ---------------------------------------------------------------------------

const actionFiles = trackedFilesUnder(REPO_ROOT, { match: ACTION_FILES });
const references = actionFiles.flatMap((file) =>
  usesReferences(file, readFileSync(join(REPO_ROOT, file), "utf8")),
);

/** References of one class, for the non-vacuity assertions. */
const of = (kind: Kind): Reference[] => references.filter((reference) => reference.kind === kind);

/** A mutation applied to a copy, so the repository's own inventory is never edited. */
function mutated(change: (copy: Reference[]) => Reference[]): Reference[] {
  return change(references.map((reference) => ({ ...reference })));
}

/** The first third-party reference, which every third-party mutation below starts from. */
const firstThirdParty = (): Reference => {
  const found = of("third-party")[0];
  if (found === undefined) throw new Error("no third-party reference to mutate");
  return found;
};

describe("the action pin inventory", () => {
  it("classifies every `uses:` in the repository and pins each to its class's rule", () => {
    // The whole guard, over the derived file set. Its inputs are asserted too: a pattern
    // that matched nothing, or a reader that read nothing, would satisfy the property by
    // having no subject.
    expect(actionFiles.length).toBeGreaterThan(0);
    expect(references.length).toBeGreaterThan(0);
    expect(pinProblems(references)).toStrictEqual([]);
  });

  it("reaches all three classes, so no branch of the rule is untested by the tree", () => {
    expect(of("third-party").length).toBeGreaterThan(0);
    expect(of("first-party").length).toBeGreaterThan(0);
    expect(of("local").length).toBeGreaterThan(0);
    // These two are refusals; the tree must contain neither.
    expect(of("docker")).toStrictEqual([]);
    expect(of("unknown")).toStrictEqual([]);
  });

  it("derives the file set from git, and reaches composite actions as well as workflows", () => {
    // The inventory covers the places a `uses:` can execute, not the one directory they
    // happen to live in: a composite action can call a third-party action too, which is
    // the gap #948 asked to close explicitly.
    expect(actionFiles).toContain(".github/workflows/ci.yml");
    expect(actionFiles).toContain(".github/actions/test-postgres-image/action.yml");
    expect(actionFiles.every((file) => ACTION_FILES.test(file))).toBe(true);
  });

  it("has every third-party reference on one SHA with a version comment", () => {
    // The positive statement of the pin, readable in the failure output rather than only
    // as an empty problems list.
    const pins = new Set(
      of("third-party").map(
        (reference) =>
          `${reference.action ?? "?"}@${reference.ref ?? "?"} # ${reference.comment ?? "?"}`,
      ),
    );
    expect([...pins]).toHaveLength(1);
    expect([...pins][0]).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });
});

describe("the reader", () => {
  const workflow = (...steps: string[]): string =>
    ["name: X", "on: push", "jobs:", "  one:", "    steps:", ...steps].join("\n");

  it("reads both the sequence-item and the plain-key spelling, with and without quotes", () => {
    const read = usesReferences(
      "x.yml",
      workflow(
        "      - uses: actions/checkout@v7",
        "      - name: named step",
        '        uses: "actions/setup-node@v7"',
        "      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9",
      ),
    );

    expect(
      read.map((reference) => [reference.line, reference.value, reference.kind]),
    ).toStrictEqual([
      [6, "actions/checkout@v7", "first-party"],
      [8, "actions/setup-node@v7", "first-party"],
      [9, "pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271", "third-party"],
    ]);
    expect(read[2]?.comment).toBe("v6.0.9");
    expect(pinProblems(read)).toStrictEqual([]);
  });

  it("does not read a `uses:` written inside a shell body", () => {
    // The block-scalar skip. Without it a workflow could be made to look pinned - or
    // unpinned - by what its scripts echo, and the corpus would include lines GitHub
    // never resolves.
    const read = usesReferences(
      "x.yml",
      workflow(
        "      - run: |",
        "          echo 'uses: evil/action@v1'",
        "          echo done",
        "      - uses: actions/checkout@v7",
      ),
    );

    expect(read.map((reference) => reference.value)).toStrictEqual(["actions/checkout@v7"]);
  });

  it("does not read a `uses:` inside a folded description, as a composite action has", () => {
    const read = usesReferences(
      "action.yml",
      [
        "name: Local",
        "description: >",
        "  This action uses: nothing at all.",
        "runs:",
        "  using: composite",
        "  steps:",
        "    - run: echo hi",
      ].join("\n"),
    );

    expect(read).toStrictEqual([]);
  });

  it("refuses a `uses:` line it cannot parse rather than skipping it", () => {
    const read = usesReferences("x.yml", workflow("      - uses:", "      - uses: a b c"));

    expect(read.map((reference) => reference.kind)).toStrictEqual(["unknown", "unknown"]);
    expect(pinProblems(read).join("\n")).toContain("does not");
  });

  it("classifies a reusable-workflow reference by its owner, like any other", () => {
    expect(classify("owner/repo/.github/workflows/build.yml@v1").kind).toBe("third-party");
    expect(classify("./.github/workflows/build.yml").kind).toBe("local");
  });

  it("classifies a first-party action with a sub-path by its owner and repo", () => {
    expect(classify("github/codeql-action/init@v4.38.0")).toStrictEqual({
      kind: "first-party",
      action: "github/codeql-action",
      ref: "v4.38.0",
    });
  });
});

describe("the rule bites", () => {
  it("fails when the third-party action is put back on a tag", () => {
    const problems = pinProblems(
      mutated((copy) =>
        copy.map((reference) =>
          reference.kind === "third-party" ? { ...reference, ref: "v6.0.9" } : reference,
        ),
      ),
    );

    expect(problems.join("\n")).toContain("which is not a 40-character lowercase hex commit SHA");
  });

  it("fails when a third-party tag ref is written into a real workflow's text", () => {
    // The same defect one layer earlier. A mutation of the model cannot catch a reader
    // that fails to see the line at all, so this one edits the file's contents.
    const subject = firstThirdParty();
    const text = readFileSync(join(REPO_ROOT, subject.file), "utf8");
    const detuned = text.replace(
      `${subject.action ?? ""}@${subject.ref ?? ""}`,
      `${subject.action ?? ""}@v6`,
    );

    expect(detuned).not.toBe(text);
    expect(pinProblems(usesReferences(subject.file, detuned)).join("\n")).toContain(
      "which is not a 40-character lowercase hex commit SHA",
    );
  });

  it("fails on a short SHA", () => {
    const subject = firstThirdParty();
    const short = (subject.ref ?? "").slice(0, 7);

    expect(short).toHaveLength(7);
    expect(
      pinProblems(
        mutated((copy) =>
          copy.map((reference) =>
            reference.kind === "third-party" ? { ...reference, ref: short } : reference,
          ),
        ),
      ).join("\n"),
    ).toContain(short);
  });

  it("fails on an uppercase SHA, which is not what git writes or Dependabot compares", () => {
    const subject = firstThirdParty();
    expect(
      pinProblems(
        mutated((copy) =>
          copy.map((reference) =>
            reference.kind === "third-party"
              ? { ...reference, ref: (reference.ref ?? "").toUpperCase() }
              : reference,
          ),
        ),
      ).join("\n"),
    ).toContain("not a 40-character lowercase hex commit SHA");
    expect(subject.ref).toMatch(FULL_SHA);
  });

  it("fails on a new unknown owner, because third-party is the default side", () => {
    // The property that makes the carve-out safe: nothing has to be added to a list for a
    // new action to be held to the SHA rule.
    const read = usesReferences(
      "x.yml",
      [
        "name: X",
        "on: push",
        "jobs:",
        "  one:",
        "    steps:",
        "      - uses: some-vendor/setup@v3",
      ].join("\n"),
    );

    expect(read[0]?.kind).toBe("third-party");
    expect(pinProblems(read).join("\n")).toContain("some-vendor/setup");
  });

  it("fails on a `docker://` reference rather than ignoring it", () => {
    const read = usesReferences(
      "x.yml",
      [
        "name: X",
        "on: push",
        "jobs:",
        "  one:",
        "    steps:",
        "      - uses: docker://alpine:3.20",
      ].join("\n"),
    );

    expect(read[0]?.kind).toBe("docker");
    expect(pinProblems(read).join("\n")).toContain("Dependabot does not support `docker://`");
  });

  it("fails a first-party reference with no ref at all", () => {
    const read = usesReferences(
      "x.yml",
      [
        "name: X",
        "on: push",
        "jobs:",
        "  one:",
        "    steps:",
        "      - uses: actions/checkout",
      ].join("\n"),
    );

    expect(read[0]?.kind).toBe("first-party");
    expect(pinProblems(read).join("\n")).toContain("names no ref");
  });

  it("fails a local reference that carries a ref, which GitHub does not accept", () => {
    const read = usesReferences(
      "x.yml",
      [
        "name: X",
        "on: push",
        "jobs:",
        "  one:",
        "    steps:",
        "      - uses: ./.github/actions/test-postgres-image@v1",
      ].join("\n"),
    );

    expect(read[0]?.kind).toBe("unknown");
    expect(pinProblems(read).join("\n")).toContain("shape this guard does not");
  });

  it("fails a pinned third-party reference whose version comment is missing or prose", () => {
    const missing = pinProblems(
      mutated((copy) =>
        copy.map((reference) =>
          reference.kind === "third-party" ? { ...reference, comment: undefined } : reference,
        ),
      ),
    );
    expect(missing.join("\n")).toContain("carries no trailing version comment");

    const prose = pinProblems(
      mutated((copy) =>
        copy.map((reference) =>
          reference.kind === "third-party"
            ? { ...reference, comment: "pinned, see the PR" }
            : reference,
        ),
      ),
    );
    expect(prose.join("\n")).toContain("names no version");
  });

  it("fails when one action is referenced at two different pins", () => {
    // The #948 inconsistency itself: `@v6.0.9` in six files and `@v6` in two.
    const problems = pinProblems(
      mutated((copy) => {
        const first = copy.findIndex((reference) => reference.kind === "third-party");
        const subject = copy[first];
        if (subject === undefined) throw new Error("no third-party reference to mutate");
        copy[first] = {
          ...subject,
          ref: "a".repeat(40),
          comment: "v6.0.10",
        };
        return copy;
      }),
    );

    expect(problems.join("\n")).toContain("referenced at more than one pin");
  });

  it("fails on an empty inventory rather than passing vacuously", () => {
    expect(pinProblems([]).join("\n")).toContain("would assert nothing");
  });

  it("is silent on the shapes the ruling allows", () => {
    // The negative control for the three classes, so the cases above are shown to fail for
    // the reason claimed and not because the comparator refuses everything.
    const read = usesReferences(
      "x.yml",
      [
        "name: X",
        "on: push",
        "jobs:",
        "  one:",
        "    steps:",
        "      - uses: actions/checkout@v7",
        "      - uses: github/codeql-action/init@v4.38.0",
        "      - uses: ./.github/actions/test-postgres-image",
        "      - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9",
        "      - uses: some-vendor/setup@0000000000000000000000000000000000000000 # https://example.com/releases/v3",
      ].join("\n"),
    );

    expect(read.map((reference) => reference.kind)).toStrictEqual([
      "first-party",
      "first-party",
      "local",
      "third-party",
      "third-party",
    ]);
    expect(pinProblems(read)).toStrictEqual([]);
  });
});
