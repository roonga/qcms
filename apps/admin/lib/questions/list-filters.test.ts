import { describe, expect, it } from "vitest";

import { readQuestionListFilters } from "./list-filters.ts";

describe("readQuestionListFilters", () => {
  it("reads an unfiltered library from an empty query string", () => {
    expect(readQuestionListFilters({})).toEqual({
      status: undefined,
      type: undefined,
      search: "",
      isFiltered: false,
      activeCount: 0,
    });
  });

  it("reads all three filters back out of the URL, which is what makes a view linkable", () => {
    expect(readQuestionListFilters({ q: "smoking", status: "draft", type: "boolean" })).toEqual({
      status: "draft",
      type: "boolean",
      search: "smoking",
      isFiltered: true,
      activeCount: 3,
    });
  });

  it.each([
    ["an unknown status is any status", { status: "archived" }, { status: undefined }],
    ["an unknown type is any type", { type: "signature" }, { type: undefined }],
    ["a repeated parameter takes its first value", { q: ["a", "b"] }, { search: "a" }],
  ])("%s", (_name, params: Record<string, string | string[]>, expected) => {
    expect(readQuestionListFilters(params)).toMatchObject(expected);
  });

  it("does not count whitespace as a search", () => {
    expect(readQuestionListFilters({ q: "   " })).toMatchObject({
      search: "   ",
      isFiltered: false,
      activeCount: 0,
    });
  });

  it("counts each filter once, so the count and the narrowing cannot disagree", () => {
    for (const params of [{ q: "x" }, { status: "draft" }, { type: "number" }]) {
      const read = readQuestionListFilters(params);
      expect(read.activeCount, JSON.stringify(params)).toBe(1);
      expect(read.isFiltered).toBe(true);
    }
  });
});
