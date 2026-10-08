import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  PINNED_EXCEPTIONS,
  parseNameStatus,
  pinnedException,
  sha256,
  violationsIn,
} from "./check-golden-append-only.mjs";

/**
 * Tests for the append-only guard's **hash-pinned exception** (Q30, Code Owner
 * 2026-10-03).
 *
 * The guard answers one question - may this diff change this corpus file - and the
 * failure that would matter is the one where a pin turns into a hole: a listed path that
 * accepts any content, or a pin that leaks to a neighbour. So the cases below are the
 * four the ruling names, driven through the pure classifier rather than through a
 * repository, plus two that tie the committed pin to the file it describes.
 *
 * `violationsIn` is given the parsed `--name-status` output and a `contentsAt` that
 * stands in for `git show HEAD:<path>`, so a case can state exactly what the commit holds.
 */

const REPO_ROOT = new URL("../", import.meta.url);
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, REPO_ROOT)), "utf8");

/** The one path the record pins, and the hash it pins it to. */
const PINNED_PATH =
  "packages/core/golden/evaluator/scenarios/repeat-every-instance-empty-group.json";
const OTHER_SCENARIO = "packages/core/golden/evaluator/scenarios/answered-none.json";

const PINS = [{ path: PINNED_PATH, sha256: sha256("the one permitted content\n"), reason: "test" }];

/** A `contentsAt` that reports one path's bytes and nothing else. */
const holding = (contents: string) => (filePath: string) =>
  filePath === PINNED_PATH ? contents : undefined;

describe("the hash-pinned exception", () => {
  it("passes a modification of a listed path whose new content hashes to the pin", () => {
    const changes = parseNameStatus(`M\t${PINNED_PATH}`);
    expect(violationsIn(changes, holding("the one permitted content\n"), PINS)).toEqual([]);
  });

  it("refuses a DIFFERENT edit to the same listed path", () => {
    // The property that makes this a pin and not an allowlist: the path is not
    // unguarded afterwards, because only one content satisfies it.
    const changes = parseNameStatus(`M\t${PINNED_PATH}`);
    expect(violationsIn(changes, holding("some other content\n"), PINS)).toEqual([
      `M\t${PINNED_PATH}`,
    ]);
  });

  it("refuses a modification of an UNLISTED corpus file, whatever it holds", () => {
    const changes = parseNameStatus(`M\t${OTHER_SCENARIO}`);
    // Even when its bytes happen to be the pinned content, because the pin is matched by
    // exact path first and cannot leak to a neighbour.
    expect(violationsIn(changes, () => "the one permitted content\n", PINS)).toEqual([
      `M\t${OTHER_SCENARIO}`,
    ]);
  });

  it("refuses a DELETION of the listed path", () => {
    // No hash can describe a path that is gone, so a pin never excuses one.
    const changes = parseNameStatus(`D\t${PINNED_PATH}`);
    expect(violationsIn(changes, holding("the one permitted content\n"), PINS)).toEqual([
      `D\t${PINNED_PATH}`,
    ]);
  });

  it("refuses a RENAME of the listed path, naming both sides", () => {
    const changes = parseNameStatus(`R100\t${PINNED_PATH}\t${OTHER_SCENARIO}`);
    expect(violationsIn(changes, holding("the one permitted content\n"), PINS)).toEqual([
      `R100\t${PINNED_PATH}`,
      `R100\t${OTHER_SCENARIO}`,
    ]);
  });

  it("refuses a listed path whose content cannot be read at HEAD", () => {
    // A pin is satisfied by bytes, so an unreadable path fails closed rather than
    // passing on the strength of being listed.
    const changes = parseNameStatus(`M\t${PINNED_PATH}`);
    expect(violationsIn(changes, () => undefined, PINS)).toEqual([`M\t${PINNED_PATH}`]);
  });

  it("still allows an addition anywhere in the corpus", () => {
    const changes = parseNameStatus(`A\tpackages/core/golden/evaluator/scenarios/brand-new.json`);
    expect(violationsIn(changes, () => undefined, PINS)).toEqual([]);
  });

  it("leaves a file outside the guarded prefixes alone", () => {
    const changes = parseNameStatus("M\tpackages/core/src/evaluate-rules.ts");
    expect(violationsIn(changes, () => undefined, PINS)).toEqual([]);
  });
});

describe("the committed pin", () => {
  it("holds exactly one entry, for the scenario Q30 amended", () => {
    // A list that grew without a ruling is the thing a reader of CORPUS.md would not
    // know about, so its size is asserted rather than left to review.
    expect(PINNED_EXCEPTIONS.map((pin) => pin.path)).toEqual([PINNED_PATH]);
  });

  it("matches the bytes that scenario actually holds", () => {
    // The pin and the file have to agree, or the gate is red for everyone on the next
    // commit. This is what catches a hash pasted from a stale copy of the edit.
    const pin = pinnedException(PINNED_PATH);
    expect(pin).toBeDefined();
    expect(sha256(read(PINNED_PATH))).toBe(pin?.sha256);
  });

  it("gives a reason that cites the ruling, the precedent and the human record", () => {
    // The gate's reason and CORPUS.md are the same claim in two places; a pin whose
    // reason names neither is a pin nobody can audit.
    const reason = pinnedException(PINNED_PATH)?.reason ?? "";
    expect(reason).toContain("Q30");
    expect(reason).toContain("#128");
    expect(reason).toContain("CORPUS.md");
  });

  it("names the same file and hash as CORPUS.md", () => {
    const corpus = read("packages/core/golden/evaluator/CORPUS.md");
    const pin = pinnedException(PINNED_PATH);
    expect(corpus).toContain("repeat-every-instance-empty-group");
    expect(corpus).toContain(pin?.sha256 ?? "no hash in the pin");
  });
});
