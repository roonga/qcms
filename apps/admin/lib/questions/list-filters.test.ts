import { describe, expect, it } from "vitest";

import { readQuestionListFilters } from "./list-filters.ts";

/**
 * The question library's URL state (issue #1117 lifted it out of the page).
 *
 * The sibling of `lib/forms/list-filters.test.ts`, and here for the same reason that file
 * gives: reading a query string is a set of decisions - which raw value counts, what "any"
 * means, whether the screen is narrowed - and §7.0 made two React trees depend on all of
 * them agreeing. The page asks for the list; the rail draws the controls and the count. A
 * pure module is what lets both ask once.
 */

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
      // All three count: unlike the form library, this list has no sort to exclude, so
      // every parameter it reads can hide a question.
      activeCount: 3,
    });
  });

  it.each([
    ["an unknown status is any status", { status: "archived" }, { status: undefined }],
    ["an unknown type is any type", { type: "signature" }, { type: undefined }],
    ["a repeated parameter takes its first value", { q: ["a", "b"] }, { search: "a" }],
  ])("%s", (_name, params: Record<string, string | string[]>, expected) => {
    // A stale bookmark or a hand-edited URL still opens the library, and the control then
    // shows what is actually in force rather than an option that does not exist.
    expect(readQuestionListFilters(params)).toMatchObject(expected);
  });

  it("does not count whitespace as a search", () => {
    // The API trims what it matches on, so a term of spaces narrows nothing - and a rail
    // reading "1 active" over an unnarrowed library would be a count that lies.
    expect(readQuestionListFilters({ q: "   " })).toMatchObject({
      search: "   ",
      isFiltered: false,
      activeCount: 0,
    });
  });

  it("counts each filter once, so the count and the narrowing cannot disagree", () => {
    // `isFiltered` is `activeCount > 0` by construction. Asserted across the three
    // single-filter cases because the pair is read by two different trees - the rail shows
    // the count, the page chooses its empty state - and a build where they parted would
    // show "no question matches this" with no filter named anywhere.
    for (const params of [{ q: "x" }, { status: "draft" }, { type: "number" }]) {
      const read = readQuestionListFilters(params);
      expect(read.activeCount, JSON.stringify(params)).toBe(1);
      expect(read.isFiltered).toBe(true);
    }
  });
});
