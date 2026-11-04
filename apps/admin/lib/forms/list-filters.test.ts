import { describe, expect, it } from "vitest";

import { readFormListFilters } from "./list-filters.ts";

describe("readFormListFilters", () => {
  it("reads an unfiltered library from an empty query string", () => {
    expect(readFormListFilters({})).toEqual({
      status: undefined,
      sort: "slug-asc",
      search: "",
      isFiltered: false,
      activeCount: 0,
    });
  });

  it("reads all three parameters back out of the URL, which is what makes a view linkable", () => {
    expect(readFormListFilters({ q: "vehicle", status: "closed", sort: "published-desc" })).toEqual(
      {
        status: "closed",
        sort: "published-desc",
        search: "vehicle",
        isFiltered: true,

        activeCount: 2,
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
    expect(readFormListFilters({ q: "   " })).toMatchObject({ search: "   ", isFiltered: false });
  });

  it("does not count a sort as a filter, because a sort hides no form", () => {
    expect(readFormListFilters({ sort: "published-asc" }).isFiltered).toBe(false);
    expect(readFormListFilters({ sort: "published-asc", q: "a" }).isFiltered).toBe(true);
    expect(readFormListFilters({ sort: "published-asc", status: "open" }).isFiltered).toBe(true);
  });
});
