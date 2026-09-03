import { describe, expect, it } from "vitest";

import { clampedPage, pageCount } from "./paging.ts";

/**
 * The past-the-end rule for a paged admin table (issue #550).
 *
 * The cases that matter are the two ends of it: a page past a result set that HAS rows
 * must be corrected, because leaving it renders an empty table under a sentence saying
 * the form has never been submitted to; and a page past a result set that has NO rows
 * must be left alone, because there the empty sentence is true and a clamp would re-read
 * page 1 to learn nothing.
 */

/** The page size the responses list reports, and what `lib/server/responses.ts` defaults to. */
const PAGE_SIZE = 50;

describe("pageCount", () => {
  it("is one for an empty result set rather than zero", () => {
    expect(pageCount(0, PAGE_SIZE)).toBe(1);
  });

  it("is one while the rows fit on one page, including exactly", () => {
    expect(pageCount(1, PAGE_SIZE)).toBe(1);
    expect(pageCount(50, PAGE_SIZE)).toBe(1);
  });

  it("rounds a partial last page up", () => {
    expect(pageCount(51, PAGE_SIZE)).toBe(2);
    expect(pageCount(120, PAGE_SIZE)).toBe(3);
  });

  it("survives a page size a malformed payload could produce", () => {
    expect(pageCount(120, 0)).toBe(120);
    expect(pageCount(120, -5)).toBe(120);
    expect(pageCount(-3, PAGE_SIZE)).toBe(1);
  });
});

describe("clampedPage", () => {
  it("clamps a page past the end to the last page that has rows", () => {
    // The defect verbatim: one page of results, `?page=99`.
    expect(clampedPage(99, 12, PAGE_SIZE)).toBe(1);
    expect(clampedPage(99, 120, PAGE_SIZE)).toBe(3);
  });

  it("corrects nothing for a page that is in range", () => {
    expect(clampedPage(1, 120, PAGE_SIZE)).toBeUndefined();
    expect(clampedPage(3, 120, PAGE_SIZE)).toBeUndefined();
  });

  it("leaves an empty result set alone, so its empty message still speaks", () => {
    // A form nobody has answered, and a filter nothing matches, are the same case here:
    // no rows on any page, and the screen's own sentence about it is true.
    expect(clampedPage(99, 0, PAGE_SIZE)).toBeUndefined();
    expect(clampedPage(1, 0, PAGE_SIZE)).toBeUndefined();
  });

  it("clamps the page immediately after the last one, not only a distant one", () => {
    expect(clampedPage(4, 120, PAGE_SIZE)).toBe(3);
  });
});
