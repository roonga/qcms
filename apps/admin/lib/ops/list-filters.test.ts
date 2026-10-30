import { describe, expect, it } from "vitest";

import { readWebhookOpsFilters } from "./list-filters.ts";

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
