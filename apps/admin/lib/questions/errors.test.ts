import { describe, expect, it } from "vitest";

import { fieldError, issuesByField, messageForCode, unplacedIssues } from "./errors.ts";
import type { DefinitionIssue } from "./types.ts";

/**
 * Exit criterion 1's second half: "every 021 error surfaced somewhere readable".
 *
 * The Playwright walk proves the main codes reach a screen. This proves the two
 * properties that make that true for codes nobody wrote a test for: every code the
 * questions slice can raise has a sentence, and any issue the editor cannot place on a
 * field is still reported rather than dropped.
 */

/**
 * Every error code `apps/api/src/features/questions/handler.ts` can raise on a question
 * route, plus the cross-cutting ones reachable through the admin gates. Pinned here on
 * purpose: a new API code that arrives without a sentence should fail a test in the app
 * that has to render it, not surface as machine text in front of an author.
 */
const API_CODES = [
  "INVALID_QUESTION_ID",
  "INVALID_QUESTION_DEFINITION",
  "QUESTION_ID_MISMATCH",
  "QUESTION_ID_REUSED",
  "SLUG_TAKEN",
  "QUESTION_NOT_FOUND",
  "VERSION_NOT_FOUND",
  "VERSION_IMMUTABLE",
  "INVALID_VERSION_STATE",
  "unauthorized",
  "rate_limited",
  "internal",
];

describe("messageForCode", () => {
  it.each(API_CODES)("has a human sentence for %s", (code) => {
    const message = messageForCode(code);
    expect(message).not.toContain(code);
    expect(message.length).toBeGreaterThan(10);
  });

  it("names the rule for the two codes the wireframe calls out", () => {
    expect(messageForCode("VERSION_IMMUTABLE")).toMatch(/frozen/i);
    expect(messageForCode("VERSION_IMMUTABLE")).toMatch(/new version/i);
    expect(messageForCode("QUESTION_ID_REUSED")).toMatch(/never reused/i);
  });

  it("falls back without putting a bare code in front of a human", () => {
    const message = messageForCode("SOME_FUTURE_CODE");
    // The code is still present so a bug report can name it, but it is inside a
    // sentence rather than being the whole message.
    expect(message).toContain("SOME_FUTURE_CODE");
    expect(message).toMatch(/failed/i);
  });
});

describe("issue placement", () => {
  const issues: DefinitionIssue[] = [
    { code: "MIN_ABOVE_MAX", message: "min is above max", path: ["constraints", "min"] },
    { code: "OPTION_LABEL_EMPTY", message: "needs a label", path: ["options", 1, "label"] },
    { code: "INVALID_QUESTION_DEFINITION", message: "something broader" },
  ];

  it("addresses a field by its joined domain path", () => {
    const byField = issuesByField(issues);
    expect(fieldError(byField, "constraints.min")).toBe("min is above max");
    expect(fieldError(byField, "options.1.label")).toBe("needs a label");
    expect(fieldError(byField, "constraints.max")).toBeUndefined();
  });

  it("reports a pathless issue in the summary", () => {
    const leftover = unplacedIssues(issues, new Set(["constraints.min", "options.1.label"]));
    expect(leftover.map((issue) => issue.message)).toEqual(["something broader"]);
  });

  it("reports an issue whose field this form does not render", () => {
    // The exact case that makes the criterion hold for a future constraint: the kernel
    // knows a field the editor has never heard of, and the author still sees why the
    // save failed.
    const leftover = unplacedIssues(issues, new Set(["options.1.label"]));
    expect(leftover.map((issue) => issue.code)).toEqual([
      "MIN_ABOVE_MAX",
      "INVALID_QUESTION_DEFINITION",
    ]);
  });

  it("keeps several issues on one field without losing any", () => {
    const byField = issuesByField([
      { code: "A", message: "first", path: ["label"] },
      { code: "B", message: "second", path: ["label"] },
    ]);
    expect(byField.get("label")).toHaveLength(2);
    expect(fieldError(byField, "label")).toBe("first");
  });
});
