import { describe, expect, it } from "vitest";

import { readFormListFilters } from "./list-filters.ts";

/**
 * The form library list's URL state (issue 686).
 *
 * The rules this file pins are the ones a reader of the page cannot check by looking at
 * the markup: what an absent parameter means, what an unreadable one means, and which
 * parameters make the screen "filtered" - the last of which decides whether the empty
 * panel offers "Create the first form" or "Clear filters", and so decides what an author
 * is told when the list comes back with nothing in it.
 */

describe("readFormListFilters", () => {
  it("reads an unfiltered library from an empty query string", () => {
    expect(readFormListFilters({})).toEqual({
      status: undefined,
      sort: "slug-asc",
      search: "",
      isFiltered: false,
    });
  });

  it("reads all three parameters back out of the URL, which is what makes a view linkable", () => {
    expect(readFormListFilters({ q: "vehicle", status: "closed", sort: "published-desc" })).toEqual(
      {
        status: "closed",
        sort: "published-desc",
        search: "vehicle",
        isFiltered: true,
      },
    );
  });

  it.each([
    ["an unknown status is any status", { status: "archived" }, { status: undefined }],
    ["an unknown sort is the default order", { sort: "oldest" }, { sort: "slug-asc" }],
    [
      "a repeated parameter takes its first value",
      { status: ["open", "closed"] },
      { status: "open" },
    ],
  ])("%s", (_name, params, expected) => {
    expect(readFormListFilters(params)).toMatchObject(expected);
  });

  it("treats a whitespace-only search as no search at all", () => {
    // The API trims before it matches, so a screen that called this "filtered" would
    // offer "Clear filters" over a library nothing had narrowed.
    expect(readFormListFilters({ q: "   " })).toMatchObject({ search: "   ", isFiltered: false });
  });

  it("does not count a sort as a filter, because a sort hides no form", () => {
    // The consequence is the empty panel: under a non-default sort with nothing to show,
    // the library really is empty, and the panel has to offer creating rather than
    // clearing. Sorting an empty list differently produces the same empty list.
    expect(readFormListFilters({ sort: "published-asc" }).isFiltered).toBe(false);
    expect(readFormListFilters({ sort: "published-asc", q: "a" }).isFiltered).toBe(true);
    expect(readFormListFilters({ sort: "published-asc", status: "open" }).isFiltered).toBe(true);
  });
});
