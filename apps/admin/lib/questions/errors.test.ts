import { describe, expect, it } from "vitest";

import { fieldError, issuesByField, messageForCode, unplacedIssues } from "./errors.ts";
import type { DefinitionIssue } from "./types.ts";

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

  it("names the rule for the two codes the screen contract calls out", () => {
    expect(messageForCode("VERSION_IMMUTABLE")).toMatch(/frozen/i);
    expect(messageForCode("VERSION_IMMUTABLE")).toMatch(/new version/i);
    expect(messageForCode("QUESTION_ID_REUSED")).toMatch(/never reused/i);
  });

  it("falls back without putting a bare code in front of a human", () => {
    const message = messageForCode("SOME_FUTURE_CODE");

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
