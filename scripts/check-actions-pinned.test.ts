import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACTION_FILES,
  FULL_SHA,
  classify,
  coveredByDependabot,
  dependabotActionsDirectories,
  mentionsUsesKey,
  pinProblems,
  splitComment,
  usesReferences,
} from "./actions-pinned.mjs";
import { trackedFilesUnder } from "./tracked-files.mjs";

/**
 * Every `uses:` this repository executes is classified, and a third-party one is pinned to a
 * full-length commit SHA (issue #948; Code Owner ruling of 2026-09-19).
 *
 * A tag is a mutable pointer: the owner of the action's repository can move it to any commit
 * at any time, and a workflow that names one runs whatever it points at on the day it runs.
 * GitHub says so itself: "Pinning an action to a full-length commit SHA is currently the only
 * way to use an action as an immutable release", and "Pinning to a particular SHA helps
 * mitigate the risk of a bad actor adding a backdoor to the action's repository, as they
 * would need to generate a SHA-1 collision for a valid Git object payload"
 * (https://docs.github.com/en/actions/reference/security/secure-use, read 2026-09-19). This
 * repository already made the same argument one layer down, for container base images under
 * SEC-11 (#372), so an Actions reference by tag was an undocumented gap rather than a
 * recorded deviation.
 *
 * The mutability is not hypothetical here. At the time of #948 six files named
 * `pnpm/action-setup@v6.0.9` and two named `pnpm/action-setup@v6`, and the moving major tag
 * `v6` resolved to the `v6.0.10` commit - so two jobs in this repository were running a
 * different release of the same action from the other six, and nothing in the tree said
 * which. That is the whole defect class in one line: the reference did not name what ran.
 * All eight now name the `v6.0.10` commit, which is the release the Code Owner chose as the
 * single pin because it carries a patched bundled pnpm (SEC-11, issue #948).
 *
 * ## Where the rule lives, and why not here
 *
 * `scripts/actions-pinned.mjs`. The three classes, the reader, the Dependabot reach model and
 * the problem list are all there, and this file drives them over the repository. The split
 * came out of the #972 review, which found six spellings the first reader walked past: it had
 * to plant each one in a workflow and call the functions, and they were buried inside a
 * Vitest file. A reviewer can now drive them with `node` alone.
 *
 * ## What this file asserts
 *
 * The derived inventory, and the bite. The file set comes from git, through
 * `trackedFilesUnder`, per CONTRIBUTING's rule for a test that asserts a property of every X
 * in the codebase (issues #635, #641): a directory walk reads a checkout's leftovers as
 * source and asserts a property of the machine rather than of the repository. Both
 * `.github/workflows/**` and `.github/actions/**` are in the pattern, because a composite
 * action can reference a third-party action too.
 *
 * Every rule is proved non-vacuous by mutation. Some mutations edit the model; the ones that
 * matter most edit workflow **text**, because a defect in how the text becomes the model is
 * invisible to a mutation of the model - which is exactly how six valid spellings of a `uses`
 * key survived the first round of this file.
 *
 * ## What this cannot prove
 *
 * That a SHA is the commit its version comment names. Resolving a tag needs the network and
 * every gate in `pnpm verify` runs offline, so the comment is checked for being a complete
 * release version and not for being true. That is established once, by hand, when the pin is
 * written, and recorded in the pull request that writes it. After that Dependabot owns the
 * pair - for the files its `github-actions` updater actually searches, which is the limit
 * `coveredByDependabot` models and SEC-11 records.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const readRepoFile = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");

const actionFiles = trackedFilesUnder(REPO_ROOT, { match: ACTION_FILES });
const references = actionFiles.flatMap((file) => usesReferences(file, readRepoFile(file)));

/** Dependabot's configured reach, derived from the config rather than written down here. */
const dependabotDirectories = dependabotActionsDirectories(readRepoFile(".github/dependabot.yml"));

/** The whole rule over the real tree, which every mutation below is measured against. */
const problemsNow = (refs = references): string[] => pinProblems(refs, dependabotDirectories);

/** References of one class, for the non-vacuity assertions. */
const of = (kind: string) => references.filter((reference) => reference.kind === kind);

/** A mutation applied to a copy, so the repository's own inventory is never edited. */
const mutated = (change: (copy: typeof references) => typeof references): string[] =>
  problemsNow(change(references.map((reference) => ({ ...reference }))));

/** Put `ref` on every third-party reference in a copy of the inventory. */
const withThirdPartyRef = (ref: string): string[] =>
  mutated((copy) =>
    copy.map((reference) => (reference.kind === "third-party" ? { ...reference, ref } : reference)),
  );

/** The first third-party reference, which the text mutations below start from. */
const firstThirdParty = () => {
  const found = of("third-party")[0];
  if (found === undefined) throw new Error("no third-party reference to mutate");
  return found;
};

/**
 * A synthetic workflow at a path Dependabot's updater does cover, so a fixture exercises the
 * pin rules rather than the reach rule.
 */
const WORKFLOW_PATH = ".github/workflows/x.yml";
const workflow = (...steps: string[]): string =>
  ["name: X", "on: push", "jobs:", "  one:", "    steps:", ...steps].join("\n");
const readWorkflow = (...steps: string[]) => usesReferences(WORKFLOW_PATH, workflow(...steps));

describe("the action pin inventory", () => {
  it("classifies every `uses:` in the repository and pins each to its class's rule", () => {
    // The whole guard, over the derived file set. Its inputs are asserted too: a pattern that
    // matched nothing, or a reader that read nothing, would satisfy the property by having no
    // subject.
    expect(actionFiles.length).toBeGreaterThan(0);
    expect(references.length).toBeGreaterThan(0);
    expect(problemsNow()).toStrictEqual([]);
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
    // happen to live in: a composite action can call a third-party action too, which is the
    // gap #948 asked to close explicitly.
    expect(actionFiles).toContain(".github/workflows/ci.yml");
    expect(actionFiles).toContain(".github/actions/test-postgres-image/action.yml");
    expect(actionFiles.every((file) => ACTION_FILES.test(file))).toBe(true);
  });

  it("holds each third-party action at one SHA with one complete version comment", () => {
    // The property, not today's count (#972 review, Copilot on the previous shape). A second
    // correctly pinned vendor action must pass here, so nothing below pins the number of
    // actions or the character set of a repository name.
    const byAction = new Map<string, Set<string>>();
    for (const reference of of("third-party")) {
      const key = (reference.action ?? "?").toLowerCase();
      const pins = byAction.get(key) ?? new Set<string>();
      pins.add(`${reference.ref ?? "?"} # ${reference.comment ?? "?"}`);
      byAction.set(key, pins);
    }

    expect(byAction.size).toBeGreaterThan(0);
    for (const [action, pins] of byAction) {
      expect([...pins], `${action} is referenced at more than one pin`).toHaveLength(1);
      expect([...pins][0]).toMatch(/^[0-9a-f]{40} # v\d+\.\d+\.\d+/);
    }
  });
});

describe("Dependabot's reach", () => {
  it("is derived from .github/dependabot.yml and is the repository root today", () => {
    expect(dependabotDirectories).toStrictEqual([""]);
  });

  it("covers the workflows directory and not the composite actions", () => {
    // GitHub's own semantics, quoted in SEC-11: for GitHub Actions a directory reaches
    // `<directory>/.github/workflows` and a `<directory>/action.yml`, nothing else. So a
    // third-party action added to a local composite would be a pin with no updater.
    expect(coveredByDependabot(".github/workflows/ci.yml", dependabotDirectories)).toBe(true);
    expect(coveredByDependabot("action.yml", dependabotDirectories)).toBe(true);
    expect(
      coveredByDependabot(".github/actions/test-postgres-image/action.yml", dependabotDirectories),
    ).toBe(false);
  });

  it("honours a `directories` glob, which is how a composite would be brought into reach", () => {
    const widened = dependabotActionsDirectories(
      [
        "version: 2",
        "updates:",
        "  - package-ecosystem: github-actions",
        '    directories: ["/", "/.github/actions/*"]',
        "    schedule:",
        "      interval: weekly",
      ].join("\n"),
    );

    expect(widened).toStrictEqual(["", ".github/actions/*"]);
    expect(coveredByDependabot(".github/actions/mine/action.yml", widened)).toBe(true);
    expect(coveredByDependabot(".github/actions/mine/nested/action.yml", widened)).toBe(false);
  });

  it("reads a block list of directories too", () => {
    expect(
      dependabotActionsDirectories(
        [
          "version: 2",
          "updates:",
          "  - package-ecosystem: github-actions",
          "    directories:",
          '      - "/"',
          "      - /tools",
          "    schedule:",
          "      interval: weekly",
        ].join("\n"),
      ),
    ).toStrictEqual(["", "tools"]);
  });

  it("throws rather than guessing when the config has no actions entry or no directory", () => {
    expect(() =>
      dependabotActionsDirectories(
        "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n",
      ),
    ).toThrow(/no .package-ecosystem: github-actions. entry/);
    expect(() =>
      dependabotActionsDirectories(
        "version: 2\nupdates:\n  - package-ecosystem: github-actions\n    schedule:\n      interval: weekly\n",
      ),
    ).toThrow(/neither .directory. nor .directories./);
    expect(() => dependabotActionsDirectories("version: 2\n")).toThrow(/no .updates:. key/);
  });

  it("refuses a third-party pin in a file the updater does not search", () => {
    // Latent today - the two composite actions reference no third-party action - and this is
    // the check that keeps it latent rather than discovered later by a Dependabot pull request
    // that moves the workflow copies and leaves the composite behind.
    const inComposite = usesReferences(
      ".github/actions/mine/action.yml",
      [
        "name: Mine",
        "runs:",
        "  using: composite",
        "  steps:",
        "    - uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10",
      ].join("\n"),
    );

    expect(inComposite[0]?.kind).toBe("third-party");
    expect(pinProblems(inComposite, dependabotDirectories).join("\n")).toContain("does not search");
    // And it passes once the config reaches it, so the refusal is about the config and not
    // about the directory's name.
    expect(pinProblems(inComposite, ["", ".github/actions/*"])).toStrictEqual([]);
  });

  it("requires the reach model rather than defaulting to permissive", () => {
    // @ts-expect-error - the second argument is required on purpose.
    expect(() => pinProblems(references)).toThrow(/dependabotDirectories is required/);
  });
});

describe("the reader", () => {
  it("reads both the sequence-item and the plain-key spelling, with and without quotes", () => {
    const read = readWorkflow(
      "      - uses: actions/checkout@v7",
      "      - name: named step",
      '        uses: "actions/setup-node@v7"',
      "      - uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10",
    );

    expect(
      read.map((reference) => [reference.line, reference.value, reference.kind]),
    ).toStrictEqual([
      [6, "actions/checkout@v7", "first-party"],
      [8, "actions/setup-node@v7", "first-party"],
      [9, "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86", "third-party"],
    ]);
    expect(read[2]?.comment).toBe("v6.0.10");
    expect(problemsNow(read)).toStrictEqual([]);
  });

  it("does not read a `uses:` written inside a shell body", () => {
    // The one skip left, and the reason it stays: a `uses:` inside a `run: |` script is shell
    // text, not a reference. A blank line inside the body must not end it either.
    const read = readWorkflow(
      "      - run: |",
      "          echo 'uses: evil/action@v1'",
      "",
      "          uses: evil/action@v1",
      "      - uses: actions/checkout@v7",
    );

    expect(read.map((reference) => reference.value)).toStrictEqual(["actions/checkout@v7"]);
  });

  it("does not read a `uses:` inside a folded description, as a composite action has", () => {
    const read = usesReferences(
      ".github/actions/mine/action.yml",
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

  it("does not read the word `uses` out of prose or a trailing comment", () => {
    const read = readWorkflow(
      "      # this step uses: nothing",
      "      - run: pnpm build # uses the mirror",
      "      - name: a step that uses a thing",
      "      - uses: actions/checkout@v7",
    );

    expect(read.map((reference) => reference.value)).toStrictEqual(["actions/checkout@v7"]);
  });

  it("splits a trailing comment without being fooled by a quoted or unspaced hash", () => {
    expect(splitComment("uses: x # v1.2.3")).toStrictEqual({ code: "uses: x ", comment: "v1.2.3" });
    expect(splitComment("run: echo a#b")).toStrictEqual({
      code: "run: echo a#b",
      comment: undefined,
    });
    expect(splitComment(`run: echo "a # b"`)).toStrictEqual({
      code: `run: echo "a # b"`,
      comment: undefined,
    });
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
      why: undefined,
    });
  });

  it("reads a file with CRLF line ends", () => {
    const read = usesReferences(
      WORKFLOW_PATH,
      workflow("      - uses: actions/checkout@v7").replaceAll("\n", "\r\n"),
    );

    expect(read.map((reference) => reference.value)).toStrictEqual(["actions/checkout@v7"]);
  });
});

/**
 * The spellings the #972 reviewer planted in `.github/workflows/audit.yml` and got zero
 * problems from, plus the ones the first reader did refuse, so the whole set is one table.
 * Each is applied to the real file's text, so the assertion is about the reader and not about
 * a hand-built model of it.
 */
const SPELLINGS: [name: string, replacement: string][] = [
  ["a flow mapping", "      - { uses: evil/action@v1 }"],
  ["a flow sequence in a value", "      - name: x\n        with: { uses: evil/action@v1 }"],
  ["a double-quoted key", '      - "uses": evil/action@v1'],
  ["a single-quoted key", "      - 'uses': evil/action@v1"],
  ["a space before the colon", "      - uses : evil/action@v1"],
  ["a folded scalar value", "      - uses: >-\n          evil/action@v1"],
  ["a literal scalar value", "      - uses: |-\n          evil/action@v1"],
  ["an anchored key", "      - &step uses: evil/action@v1"],
  ["an explicit key", "      - ? uses\n        : evil/action@v1"],
  ["no value at all", "      - uses:"],
  ["an aliased value", "      - uses: *step"],
  ["a tagged value", "      - uses: !!str evil/action@v1"],
];

describe("every spelling of a `uses` key is parsed or refused, never skipped", () => {
  const subject = firstThirdParty();
  const original = readRepoFile(subject.file);
  const pinnedLine = original
    .split("\n")
    .find((line) => line.includes(`${subject.action ?? ""}@${subject.ref ?? ""}`));

  it("has a line to replace, so the cases below are not rewriting nothing", () => {
    expect(pinnedLine).toBeDefined();
  });

  for (const [name, replacement] of SPELLINGS) {
    it(`refuses ${name}`, () => {
      const text = original.replace(pinnedLine as string, replacement);
      expect(text).not.toBe(original);

      const problems = pinProblems(usesReferences(subject.file, text), dependabotDirectories);
      expect(problems.join("\n")).toContain("is refused:");
      expect(problems.join("\n")).toContain(`${subject.file}:`);
    });
  }

  it("leaves a genuine shell body alone in the same file", () => {
    // The negative control for the whole block: the spellings above must not be refused
    // because the reader became indiscriminate. `audit.yml` has real `run:` bodies.
    expect(problemsNow(usesReferences(subject.file, original))).toStrictEqual([]);
  });

  it("agrees with the token detector about which lines are candidates", () => {
    expect(mentionsUsesKey("      - uses: actions/checkout@v7")).toBe(true);
    expect(mentionsUsesKey("      - { uses: evil/action@v1 }")).toBe(true);
    expect(mentionsUsesKey('      - "uses": evil/action@v1')).toBe(true);
    expect(mentionsUsesKey("      - uses : evil/action@v1")).toBe(true);
    expect(mentionsUsesKey("      - &s uses: evil/action@v1")).toBe(true);
    expect(mentionsUsesKey("      - ? uses")).toBe(true);
    expect(mentionsUsesKey("      - run: pnpm test")).toBe(false);
    expect(mentionsUsesKey("      - name: a step that uses a thing")).toBe(false);
    expect(mentionsUsesKey("      - run: node -e 'x.uses'")).toBe(false);
  });
});

describe("the rule bites", () => {
  it("fails when the third-party action is put back on a tag", () => {
    expect(withThirdPartyRef("v6.0.9").join("\n")).toContain(
      "which is not a 40-character lowercase hex commit SHA",
    );
  });

  it("fails when a third-party tag ref is written into a real workflow's text", () => {
    // The same defect one layer earlier. A mutation of the model cannot catch a reader that
    // fails to see the line at all, so this one edits the file's contents.
    const subject = firstThirdParty();
    const text = readRepoFile(subject.file).replace(
      `${subject.action ?? ""}@${subject.ref ?? ""}`,
      `${subject.action ?? ""}@v6`,
    );

    expect(
      pinProblems(usesReferences(subject.file, text), dependabotDirectories).join("\n"),
    ).toContain("which is not a 40-character lowercase hex commit SHA");
  });

  it("fails on a short SHA", () => {
    const short = (firstThirdParty().ref ?? "").slice(0, 7);

    expect(short).toHaveLength(7);
    expect(withThirdPartyRef(short).join("\n")).toContain(short);
  });

  it("fails on an uppercase SHA, which is not what git writes or Dependabot compares", () => {
    const subject = firstThirdParty();
    expect(subject.ref).toMatch(FULL_SHA);
    expect(withThirdPartyRef((subject.ref ?? "").toUpperCase()).join("\n")).toContain(
      "not a 40-character lowercase hex commit SHA",
    );
  });

  it("fails on a new unknown owner, because third-party is the default side", () => {
    // The property that makes the carve-out safe: nothing has to be added to a list for a new
    // action to be held to the SHA rule.
    const read = readWorkflow("      - uses: some-vendor/setup@v3");

    expect(read[0]?.kind).toBe("third-party");
    expect(problemsNow(read).join("\n")).toContain("some-vendor/setup");
  });

  it("fails on an owner that only differs from a first-party one by case", () => {
    const read = readWorkflow("      - uses: Actions/checkout@v7");

    expect(read[0]?.kind).toBe("third-party");
    expect(problemsNow(read).join("\n")).toContain("not a 40-character");
  });

  it("fails on a `docker://` reference rather than ignoring it", () => {
    const read = readWorkflow("      - uses: docker://alpine:3.20");

    expect(read[0]?.kind).toBe("docker");
    expect(problemsNow(read).join("\n")).toContain("Dependabot does not support `docker://`");
  });

  it("fails a first-party reference with no ref at all", () => {
    const read = readWorkflow("      - uses: actions/checkout");

    expect(read[0]?.kind).toBe("first-party");
    expect(problemsNow(read).join("\n")).toContain("names no ref");
  });

  it("fails a first-party reference on a branch, which is not a version tag", () => {
    // The ruling keeps GitHub's own actions on version tags, which is narrower than "has some
    // ref" (#972 review, Low). A SHA is accepted, being stricter.
    expect(problemsNow(readWorkflow("      - uses: actions/checkout@main")).join("\n")).toContain(
      "which is not a version tag",
    );
    expect(problemsNow(readWorkflow("      - uses: actions/checkout@v7"))).toStrictEqual([]);
    expect(
      problemsNow(readWorkflow(`      - uses: actions/checkout@${"0".repeat(40)}`)),
    ).toStrictEqual([]);
  });

  it("fails a local reference that carries a ref, which GitHub does not accept", () => {
    const read = readWorkflow("      - uses: ./.github/actions/test-postgres-image@v1");

    expect(read[0]?.kind).toBe("unknown");
    expect(problemsNow(read).join("\n")).toContain("cannot carry a ref");
  });

  it("fails a local reference outside the directories this inventory reads", () => {
    const read = readWorkflow("      - uses: ./tools/my-action");

    expect(read[0]?.kind).toBe("unknown");
    expect(problemsNow(read).join("\n")).toContain("this inventory does not read");
  });

  it("fails a pinned third-party reference whose version comment is missing, prose or major-only", () => {
    const strip = (comment: string | undefined): string[] =>
      mutated((copy) =>
        copy.map((reference) =>
          reference.kind === "third-party" ? { ...reference, comment } : reference,
        ),
      );

    expect(strip(undefined).join("\n")).toContain("carries no trailing version comment");
    expect(strip("pinned, see the PR").join("\n")).toContain("complete release version");
    // The Copilot finding: `# v6` re-admits the moving-major ambiguity the SHA removed.
    expect(strip("v6").join("\n")).toContain("complete release version");
    expect(strip("https://github.com/pnpm/action-setup/releases/tag/v6.0.10").join("\n")).toContain(
      "complete release version",
    );
    // A complete version with free text after it is fine, and so is a pre-release.
    expect(strip("v6.0.10 (the release this SHA is)")).toStrictEqual([]);
    expect(strip("v6.0.10-rc.1")).toStrictEqual([]);
  });

  it("fails when one action is referenced at two different pins, whatever the case", () => {
    // The #948 inconsistency itself: `@v6.0.9` in six files and `@v6` in two. Grouping is
    // case-insensitive because GitHub resolves `Pnpm/Action-Setup` to the same repository.
    const split = (action: string): string[] =>
      mutated((copy) => {
        const first = copy.findIndex((reference) => reference.kind === "third-party");
        const subject = copy[first];
        if (subject === undefined) throw new Error("no third-party reference to mutate");
        copy[first] = { ...subject, action, ref: "a".repeat(40), comment: "v6.1.0" };
        return copy;
      });

    expect(split(firstThirdParty().action ?? "").join("\n")).toContain(
      "referenced at more than one pin",
    );
    expect(split((firstThirdParty().action ?? "").toUpperCase()).join("\n")).toContain(
      "referenced at more than one pin",
    );
  });

  it("fails on an empty inventory rather than passing vacuously", () => {
    expect(pinProblems([], dependabotDirectories).join("\n")).toContain("would assert nothing");
  });

  it("is silent on the shapes the ruling allows", () => {
    // The negative control for the three classes, so the cases above are shown to fail for the
    // reason claimed and not because the comparator refuses everything. The last line is a
    // second vendor action with uppercase, dot and underscore in its name, which must pass.
    const read = readWorkflow(
      "      - uses: actions/checkout@v7",
      "      - uses: github/codeql-action/init@v4.38.0",
      "      - uses: ./.github/actions/test-postgres-image",
      "      - uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6.0.10",
      `      - uses: Some.Vendor/My_Action@${"0".repeat(40)} # v1.2.3`,
    );

    expect(read.map((reference) => reference.kind)).toStrictEqual([
      "first-party",
      "first-party",
      "local",
      "third-party",
      "third-party",
    ]);
    expect(problemsNow(read)).toStrictEqual([]);
  });
});
