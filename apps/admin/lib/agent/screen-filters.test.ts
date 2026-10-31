import { describe, expect, it } from "vitest";

import { screenWithFilters } from "./screen-filters";
import { screenForPath } from "./screens";

function withQuery(path: string, query: string) {
  return screenWithFilters(screenForPath(path), new URLSearchParams(query));
}

describe("the response list's filters", () => {
  it("sends the filter set the operator is looking at", () => {
    const resolved = withQuery(
      "/forms/frm_a/responses",
      "version=2&from=2026-01-01&to=2026-01-31&flagged=true&tz=UTC",
    );
    expect(resolved?.params).toEqual({
      formId: "frm_a",
      filters: {
        version: 2,
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-31T23:59:59.999Z",
        flagged: true,
      },
    });
  });

  it("sends no filters for an unfiltered list", () => {
    expect(withQuery("/forms/frm_a/responses", "page=2")?.params).toEqual({ formId: "frm_a" });
  });

  it("drops a value the screen itself would ignore", () => {
    expect(withQuery("/forms/frm_a/responses", "flagged=maybe&from=03/01/2026")?.params).toEqual({
      formId: "frm_a",
    });
  });

  it("leaves every other screen's params alone", () => {
    expect(withQuery("/forms/frm_a/publish", "flagged=true")?.params).toEqual({
      formId: "frm_a",
    });
  });
});
