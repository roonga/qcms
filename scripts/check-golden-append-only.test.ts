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

const REPO_ROOT = new URL("../", import.meta.url);
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, REPO_ROOT)), "utf8");

const PINNED_PATH =
  "packages/core/golden/evaluator/scenarios/repeat-every-instance-empty-group.json";
const OTHER_SCENARIO = "packages/core/golden/evaluator/scenarios/answered-none.json";

const PINS = [{ path: PINNED_PATH, sha256: sha256("the one permitted content\n"), reason: "test" }];

const holding = (contents: string) => (filePath: string) =>
  filePath === PINNED_PATH ? contents : undefined;

describe("the hash-pinned exception", () => {
  it("passes a modification of a listed path whose new content hashes to the pin", () => {
    const changes = parseNameStatus(`M\t${PINNED_PATH}`);
    expect(violationsIn(changes, holding("the one permitted content\n"), PINS)).toEqual([]);
  });

  it("refuses a DIFFERENT edit to the same listed path", () => {
    const changes = parseNameStatus(`M\t${PINNED_PATH}`);
    expect(violationsIn(changes, holding("some other content\n"), PINS)).toEqual([
      `M\t${PINNED_PATH}`,
    ]);
  });

  it("refuses a modification of an UNLISTED corpus file, whatever it holds", () => {
    const changes = parseNameStatus(`M\t${OTHER_SCENARIO}`);
    expect(violationsIn(changes, () => "the one permitted content\n", PINS)).toEqual([
      `M\t${OTHER_SCENARIO}`,
    ]);
  });

  it("refuses a DELETION of the listed path", () => {
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
    const changes = parseNameStatus(`M\t${PINNED_PATH}`);
    expect(violationsIn(changes, () => undefined, PINS)).toEqual([`M\t${PINNED_PATH}`]);
  });

  it("refuses content whose trailing newline was stripped", () => {
    // The reader must stay untrimmed: the script's own `git` helper trims its output,
    // which strips a trailing newline and hashes to bytes the file never had.
    const changes = parseNameStatus(`M\t${PINNED_PATH}`);
    expect(violationsIn(changes, holding("the one permitted content"), PINS)).toEqual([
      `M\t${PINNED_PATH}`,
    ]);
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
    expect(PINNED_EXCEPTIONS.map((pin) => pin.path)).toEqual([PINNED_PATH]);
  });

  it("matches the bytes that scenario actually holds", () => {
    const pin = pinnedException(PINNED_PATH);
    expect(pin).toBeDefined();
    expect(sha256(read(PINNED_PATH))).toBe(pin?.sha256);
  });

  it("gives a reason that cites the ruling, the precedent and the human record", () => {
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
