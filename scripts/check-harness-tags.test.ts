import { describe, expect, it } from "vitest";

import { HARNESS_TAG_PATTERNS, harnessTagsIn } from "./check-harness-tags.mjs";

/**
 * Every tag here is assembled from fragments, as the gate assembles them, so this file
 * scans cleanly over itself. Writing one out turns the gate red.
 */

const LT = "<";
const CLOSE = `${LT}/`;

describe("harnessTagsIn", () => {
  it("catches every banned shape, one per pattern", () => {
    // Built from the patterns' own source, so a shape added to the gate with no case here
    // cannot pass silently.
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
    expect(harnessTagsIn(`${LT}parameter name="content">x`)).toHaveLength(1);
  });

  it("leaves ordinary markup and prose alone", () => {
    const clean = [
      `${LT}div class="x">text${LT}/div>`,
      `${CLOSE}p>`,
      "The function invokes a parameter of the content model.",
      "invoke, parameter, content: all fine as words.",
      // A longer element name that starts with a banned one: without the delimiter
      // lookahead this line would fail the gate.
      `${LT}parameterised>`,
      `${LT}invoker>`,
    ].join("\n");

    expect(harnessTagsIn(clean)).toEqual([]);
  });

  it("keeps its patterns stateless", () => {
    // A global or sticky flag would make `exec` advance `lastIndex` between calls and
    // silently skip files, which is the fail-open direction for a gate.
    for (const pattern of HARNESS_TAG_PATTERNS) {
      expect(pattern.global, String(pattern)).toBe(false);
      expect(pattern.sticky, String(pattern)).toBe(false);
    }
  });
});
