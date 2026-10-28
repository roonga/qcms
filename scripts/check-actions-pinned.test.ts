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
 * The file set comes from git, not a directory walk, so the property holds of the repository. The
 * version comment is checked for being a complete release, not for naming the right commit (offline).
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const readRepoFile = (relative: string): string => readFileSync(join(REPO_ROOT, relative), "utf8");

const actionFiles = trackedFilesUnder(REPO_ROOT, { match: ACTION_FILES });
const references = actionFiles.flatMap((file) => usesReferences(file, readRepoFile(file)));

const dependabotDirectories = dependabotActionsDirectories(readRepoFile(".github/dependabot.yml"));

const problemsNow = (refs = references): string[] => pinProblems(refs, dependabotDirectories);

const of = (kind: string) => references.filter((reference) => reference.kind === kind);

/** A mutation applied to a copy, so the repository's own inventory is never edited. */
const mutated = (change: (copy: typeof references) => typeof references): string[] =>
  problemsNow(change(references.map((reference) => ({ ...reference }))));

const withThirdPartyRef = (ref: string): string[] =>
  mutated((copy) =>
    copy.map((reference) => (reference.kind === "third-party" ? { ...reference, ref } : reference)),
  );

const firstThirdParty = () => {
  const found = of("third-party")[0];
  if (found === undefined) throw new Error("no third-party reference to mutate");
  return found;
};

/** At a path Dependabot covers, so a fixture exercises the pin rules, not the reach rule. */
const WORKFLOW_PATH = ".github/workflows/x.yml";
const workflow = (...steps: string[]): string =>
  ["name: X", "on: push", "jobs:", "  one:", "    steps:", ...steps].join("\n");
const readWorkflow = (...steps: string[]) => usesReferences(WORKFLOW_PATH, workflow(...steps));

describe("the action pin inventory", () => {
  it("classifies every `uses:` in the repository and pins each to its class's rule", () => {
    // Non-vacuity: a pattern that matched nothing, or a reader that read nothing, would
    // satisfy the property by having no subject.
    expect(actionFiles.length).toBeGreaterThan(0);
    expect(references.length).toBeGreaterThan(0);
    expect(problemsNow()).toStrictEqual([]);
  });

  it("reaches all three classes, so no branch of the rule is untested by the tree", () => {
    expect(of("third-party").length).toBeGreaterThan(0);
    expect(of("first-party").length).toBeGreaterThan(0);
    expect(of("local").length).toBeGreaterThan(0);
    expect(of("docker")).toStrictEqual([]);
    expect(of("unknown")).toStrictEqual([]);
  });

  it("derives the file set from git, and reaches composite actions as well as workflows", () => {
    expect(actionFiles).toContain(".github/workflows/ci.yml");
    expect(actionFiles).toContain(".github/actions/test-postgres-image/action.yml");
    expect(actionFiles.every((file) => ACTION_FILES.test(file))).toBe(true);
  });

  it("holds every remote action at one pin per repository, first-party included", () => {
    // The property, not today's count, so nothing below pins the number of actions. Grouped
    // by repository over both remote classes, not the third-party class alone.
    const byRepository = new Map<string, Set<string>>();
    for (const reference of [...of("third-party"), ...of("first-party")]) {
      const key = (reference.action ?? "?").toLowerCase();
      const pins = byRepository.get(key) ?? new Set<string>();
      pins.add(reference.ref ?? "?");
      byRepository.set(key, pins);
    }

    expect(byRepository.size).toBeGreaterThan(0);
    for (const [repository, pins] of byRepository) {
      expect([...pins], `${repository} is referenced at more than one pin`).toHaveLength(1);
    }
    expect(
      of("first-party").filter((reference) => reference.action === "github/codeql-action").length,
    ).toBeGreaterThan(1);

    const thirdPartyPins = new Map<string, Set<string>>();
    for (const reference of of("third-party")) {
      const key = (reference.action ?? "?").toLowerCase();
      const pins = thirdPartyPins.get(key) ?? new Set<string>();
      pins.add(`${reference.ref ?? "?"} # ${reference.comment ?? "?"}`);
      thirdPartyPins.set(key, pins);
    }

    expect(thirdPartyPins.size).toBeGreaterThan(0);
    for (const [action, pins] of thirdPartyPins) {
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
    // Per SEC-11, a Dependabot directory reaches `<dir>/.github/workflows` and a
    // `<dir>/action.yml`, nothing else, so a third-party action in a local composite has no
    // updater behind its pin.
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
    // Latent today, and this is what keeps it latent: the composite actions reference no
    // third-party action yet.
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
    // The one deliberate skip: a `uses:` inside a `run: |` body is shell text, not a
    // reference, and a blank line inside the body must not end it.
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
 * Applied to a real workflow's text, so the assertion is about the reader rather than about
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

/**
 * A separate class from the table above: nobody writes one by accident, so these are a key
 * hidden from a by-shape reader. Refused because each was cheap to refuse, not because
 * refusing them is what the gate is for (the bound is in SEC-11).
 */
const ADVERSARIAL_SPELLINGS: [name: string, replacement: string][] = [
  ["a tagged key", String.raw`      - !!str uses: evil/action@v1`],
  ["an anchored and tagged key", String.raw`      - &a !!str uses: evil/action@v1`],
  // YAML decodes `\x75` to `u`, so this is `uses` spelled past any textual comparison. The
  // reader refuses a double-quoted key carrying a backslash rather than implementing YAML's
  // escape table.
  ["an escape-encoded double-quoted key", String.raw`      - "\x75ses": evil/action@v1`],
  ["an explicit key inside a flow mapping", String.raw`      - { ? uses : evil/action@v1 }`],
  ["an anchored key inside a flow mapping", String.raw`      - { &a uses: evil/action@v1 }`],
  ["a tagged key inside a flow mapping", String.raw`      - { !!str uses: evil/action@v1 }`],
  // An escaped quote closing the string early in `splitComment` made ` # ` a comment, and the
  // `uses` key after it was discarded with the rest of the line.
  [
    "a flow mapping whose earlier value contains an escaped quote and a hash",
    String.raw`      - { name: "a\" # ", uses: evil/action@v1 }`,
  ],
  [
    "a double-quoted key folded across two lines under an explicit key",
    [
      String.raw`      - ? "us`,
      String.raw`          es"`,
      String.raw`        : evil/action@v1`,
    ].join("\n"),
  ],
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

  for (const [name, replacement] of [...SPELLINGS, ...ADVERSARIAL_SPELLINGS]) {
    it(`refuses ${name}`, () => {
      const text = original.replace(pinnedLine as string, replacement);
      expect(text).not.toBe(original);

      const problems = pinProblems(usesReferences(subject.file, text), dependabotDirectories);
      expect(problems.join("\n")).toContain("is refused:");
      expect(problems.join("\n")).toContain(`${subject.file}:`);
    });
  }

  it("leaves a genuine shell body alone in the same file", () => {
    // Negative control: the spellings above must not be refused by a reader that has merely
    // become indiscriminate.
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
    expect(mentionsUsesKey("      - !!str uses: evil/action@v1")).toBe(true);
    expect(mentionsUsesKey("      - &a !!str uses: evil/action@v1")).toBe(true);
    expect(mentionsUsesKey(String.raw`      - "\x75ses": evil/action@v1`)).toBe(true);
    expect(mentionsUsesKey("      - { ? uses : evil/action@v1 }")).toBe(true);
    expect(mentionsUsesKey("      - { !!str uses: evil/action@v1 }")).toBe(true);
    // A flow SEQUENCE of scalars is not a key, which is why the flow scan wants the colon.
    expect(mentionsUsesKey("      - { with: [uses, other] }")).toBe(false);
  });
});

describe("the rule bites", () => {
  it("fails when the third-party action is put back on a tag", () => {
    expect(withThirdPartyRef("v6.0.9").join("\n")).toContain(
      "which is not a 40-character lowercase hex commit SHA",
    );
  });

  it("fails when a third-party tag ref is written into a real workflow's text", () => {
    // Edits the file's contents: a mutation of the model cannot catch a reader that never
    // sees the line.
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
    // What makes the carve-out safe: a new action is held to the SHA rule without being
    // added to any list.
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
    // GitHub's own actions stay on version tags, which is narrower than "has some ref". A SHA
    // is accepted, being stricter.
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

  it("fails a local reference that climbs out of its prefix with `..`", () => {
    // The prefix test looks like a containment check and is not one: this path starts with
    // `./.github/actions/` and lands outside it.
    const read = readWorkflow("      - uses: ./.github/actions/../../tools/x");

    expect(read[0]?.kind).toBe("unknown");
    expect(problemsNow(read).join("\n")).toContain("`..` segment");
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
    // `# v6` re-admits the moving-major ambiguity the SHA removed.
    expect(strip("v6").join("\n")).toContain("complete release version");
    expect(strip("https://github.com/pnpm/action-setup/releases/tag/v6.0.10").join("\n")).toContain(
      "complete release version",
    );
    expect(strip("v6.0.10 (the release this SHA is)")).toStrictEqual([]);
    expect(strip("v6.0.10-rc.1")).toStrictEqual([]);
  });

  it("fails when one THIRD-PARTY action is referenced at two different pins, whatever the case", () => {
    // Grouping is case-insensitive: GitHub resolves `Pnpm/Action-Setup` to the same
    // repository.
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

  it("fails when one FIRST-PARTY action is referenced at two different version tags", () => {
    // The carve-out is about the form of a first-party pin, not about running two releases
    // of one action at once: each tag below is individually valid and nothing compared them.
    const read = readWorkflow(
      "      - uses: actions/checkout@v7",
      "      - uses: actions/setup-node@v7",
      "      - uses: actions/checkout@v6",
    );

    expect(read.map((reference) => reference.kind)).toStrictEqual([
      "first-party",
      "first-party",
      "first-party",
    ]);
    expect(problemsNow(read).join("\n")).toContain(
      "actions/checkout is referenced at more than one pin: v6 / v7",
    );
    expect(problemsNow(read).join("\n")).toContain(`${WORKFLOW_PATH}:6, ${WORKFLOW_PATH}:8`);
    expect(problemsNow(read).join("\n")).not.toContain("actions/setup-node");
    // A SHA and a tag are two pins too, although each is accepted on its own.
    expect(
      problemsNow(
        readWorkflow(
          "      - uses: actions/checkout@v7",
          `      - uses: actions/checkout@${"0".repeat(40)}`,
        ),
      ).join("\n"),
    ).toContain("more than one pin");
    // A first-party OWNER is case-sensitive by design, so `Actions/checkout` is a
    // third-party reference and is covered above.
    expect(
      problemsNow(
        readWorkflow("      - uses: actions/Checkout@v7", "      - uses: actions/checkout@v6"),
      ).join("\n"),
    ).toContain("more than one pin");
  });

  it("fails when two sub-actions of one repository sit at two different pins", () => {
    // One release of `github/codeql-action` publishes several action paths from one commit,
    // so the grouping key is the repository rather than the path.
    const read = readWorkflow(
      "      - uses: github/codeql-action/init@v4.38.2",
      "      - uses: github/codeql-action/analyze@v4.39.0",
    );

    expect(read.map((reference) => reference.action)).toStrictEqual([
      "github/codeql-action",
      "github/codeql-action",
    ]);
    expect(problemsNow(read).join("\n")).toContain(
      "github/codeql-action is referenced at more than one pin: v4.38.2 / v4.39.0",
    );
  });

  it("passes when both sub-actions of one repository sit at one pin", () => {
    // Negative control: the grouping must not red a repository for being referenced through
    // two paths.
    expect(
      problemsNow(
        readWorkflow(
          "      - uses: github/codeql-action/init@v4.39.0",
          "      - uses: github/codeql-action/analyze@v4.39.0",
        ),
      ),
    ).toStrictEqual([]);
  });

  it("leaves local and `docker://` references out of the one-pin grouping", () => {
    // Neither has a repository pin to compare: a local reference carries no ref at all, and
    // a `docker://` reference is refused outright.
    const problems = problemsNow(
      readWorkflow(
        "      - uses: ./.github/actions/test-postgres-image",
        "      - uses: ./.github/actions/assert-no-docker-hub-pulls",
        "      - uses: docker://alpine:3.20",
        "      - uses: docker://alpine:3.21",
      ),
    );

    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).not.toContain("more than one pin");
  });

  it("does not treat a trailing comment on a first-party line as a second pin", () => {
    // Dependabot moves the SHA and its comment together, so two readings of one SHA means
    // one is false. No rule asks a first-party line for a comment.
    expect(
      problemsNow(
        readWorkflow(
          "      - uses: actions/checkout@v7",
          "      - uses: actions/checkout@v7 # the pinned major",
        ),
      ),
    ).toStrictEqual([]);
  });

  it("fails on an empty inventory rather than passing vacuously", () => {
    expect(pinProblems([], dependabotDirectories).join("\n")).toContain("would assert nothing");
  });

  it("is silent on the shapes the ruling allows", () => {
    // Negative control for the three classes: the comparator must not refuse everything. The
    // last line carries uppercase, a dot and an underscore in the repository name.
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
