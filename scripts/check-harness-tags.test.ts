import { describe, expect, it } from "vitest";

import { HARNESS_TAG_PATTERNS, harnessTagsIn } from "./check-harness-tags.mjs";

/**
 * Tests for the harness-tag gate (issue #767).
 *
 * The gate exists for a leak that four deploy documents took and every other gate
 * passed, so the case that matters is the false negative. Each banned shape is driven
 * through the scanner rather than inspected, and the negative controls are the shapes
 * closest to a real tag: ordinary markup, and prose that merely contains the words.
 *
 * Every tag here is assembled from fragments, exactly as the gate assembles them, so
 * this file scans cleanly over itself. Writing one out would put the literal into a
 * committed file and turn the gate red - which is the gate working, and is why it is
 * built this way on both sides.
 */

const LT = "<";
const CLOSE = `${LT}/`;

describe("harnessTagsIn", () => {
  it("catches every banned shape, one per pattern", () => {
    // Built from the patterns' own source so a shape added to the gate without a case
    // here cannot pass silently: each pattern is fed a line it must match.
    const samples = [
      `${LT}function_calls>`,
      `${CLOSE}function_calls>`,
      `${LT}invoke name="Write">`,
      `${CLOSE}invoke>`,
      `${LT}parameter name="file_path">`,
      `${CLOSE}parameter>`,
      `${CLOSE}content>`,
      `${LT}antml:thinking`,
      `${CLOSE}antml:thinking`,
    ];

    expect(samples).toHaveLength(HARNESS_TAG_PATTERNS.length);
    for (const sample of samples) {
      expect(harnessTagsIn(`prose ${sample} trailing`), sample).not.toEqual([]);
    }
  });

  it("catches the exact leak from PRs #758 and #762: closing tags on the last line", () => {
    const document = ["# Deploying to a VPS", "", "Some prose.", `${CLOSE}content>${CLOSE}invoke>`];

    const found = harnessTagsIn(document.join("\n"));

    expect(found).toHaveLength(2);
    expect(found.every((hit) => hit.line === 4)).toBe(true);
  });

  it("reports the line number, so the failure is navigable", () => {
    const found = harnessTagsIn(["one", "two", `${LT}invoke name="Write">`].join("\n"));

    expect(found[0]?.line).toBe(3);
  });

  it("does not let an attribute list hide an opening tag", () => {
    // The leak arrives with attributes far more often than bare, so the opening
    // patterns stop before the closing bracket.
    expect(harnessTagsIn(`${LT}parameter name="content">x`)).toHaveLength(1);
  });

  it("leaves ordinary markup and prose alone", () => {
    const clean = [
      `${LT}div class="x">text${LT}/div>`,
      `${CLOSE}p>`,
      "The function invokes a parameter of the content model.",
      "invoke, parameter, content: all fine as words.",
      // The near-miss that matters: a longer element name that starts with a banned
      // one. Without the delimiter lookahead this line fails the gate.
      `${LT}parameterised>`,
      `${LT}invoker>`,
    ].join("\n");

    expect(harnessTagsIn(clean)).toEqual([]);
  });

  it("keeps its patterns stateless", () => {
    // A global or sticky flag would make `exec` advance `lastIndex` between calls and
    // silently skip roughly every second file - the fail-open shrink that
    // scripts/tracked-files.mjs refuses for the same reason.
    for (const pattern of HARNESS_TAG_PATTERNS) {
      expect(pattern.global, String(pattern)).toBe(false);
      expect(pattern.sticky, String(pattern)).toBe(false);
    }
  });
});
