import { describe, expect, it } from "vitest";

import { readResponsesIndexFilters, readWebhookOpsFilters } from "./list-filters.ts";

/**
 * The two operations screens' URL state (issue #1117).
 *
 * Both are one filter each, which is what §7.0's table gives them, so what is worth pinning
 * is not arithmetic but the two decisions each one makes about a raw value: what an empty
 * parameter means, and whether an unrecognised one is honoured or discarded. They are
 * answered differently on purpose, and the module records why.
 */

describe("readResponsesIndexFilters", () => {
  it("reads no filter from an empty query string", () => {
    expect(readResponsesIndexFilters({})).toEqual({ search: "", activeCount: 0 });
  });

  it("reads the term the way-in list is narrowed by", () => {
    expect(readResponsesIndexFilters({ q: "intake" })).toEqual({
      search: "intake",
      activeCount: 1,
    });
  });

  it("does not count whitespace as a search", () => {
    // The API trims what it matches, so a term of spaces narrows nothing and the rail has
    // no filter to count.
    expect(readResponsesIndexFilters({ q: "  " })).toEqual({ search: "  ", activeCount: 0 });
  });

  it("takes the first value of a repeated parameter", () => {
    expect(readResponsesIndexFilters({ q: ["a", "b"] })).toMatchObject({ search: "a" });
  });
});

describe("readWebhookOpsFilters", () => {
  it("reads no filter from an empty query string, and from an empty parameter", () => {
    // An empty `?form=` is what the Select's own "Any form" option submits, so it has to
    // mean the same thing as the parameter's absence or pressing Apply on "Any form" would
    // narrow the queue to the forms whose id is the empty string.
    expect(readWebhookOpsFilters({})).toEqual({ formId: undefined, activeCount: 0 });
    expect(readWebhookOpsFilters({ form: "" })).toEqual({ formId: undefined, activeCount: 0 });
  });

  it("keeps an unrecognised form id rather than resetting to any form", () => {
    // DELIBERATELY UNLIKE the library screens' status and type, which fall back to "any".
    // There the fallback keeps a stale bookmark working; here it would make the control
    // disagree with the rows beside it. An id the installation does not have narrows the
    // queue to nothing, which is the truthful answer to what the address asked for.
    expect(readWebhookOpsFilters({ form: "frm_gone" })).toEqual({
      formId: "frm_gone",
      activeCount: 1,
    });
  });

  it("takes the first value of a repeated parameter", () => {
    expect(readWebhookOpsFilters({ form: ["frm_a", "frm_b"] })).toMatchObject({
      formId: "frm_a",
    });
  });
});
