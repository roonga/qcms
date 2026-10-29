import { describe, expect, it } from "vitest";

import { readResponsesIndexFilters, readWebhookOpsFilters } from "./list-filters.ts";

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
    expect(readResponsesIndexFilters({ q: "  " })).toEqual({ search: "  ", activeCount: 0 });
  });

  it("takes the first value of a repeated parameter", () => {
    expect(readResponsesIndexFilters({ q: ["a", "b"] })).toMatchObject({ search: "a" });
  });
});

describe("readWebhookOpsFilters", () => {
  it("reads no filter from an empty query string, and from an empty parameter", () => {
    // An empty `?form=` is what the "Any form" option submits, so it has to mean the same
    // thing as the parameter's absence.
    expect(readWebhookOpsFilters({})).toEqual({ formId: undefined, activeCount: 0 });
    expect(readWebhookOpsFilters({ form: "" })).toEqual({ formId: undefined, activeCount: 0 });
  });

  it("keeps an unrecognised form id rather than resetting to any form", () => {
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
