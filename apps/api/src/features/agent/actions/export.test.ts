import { describe, expect, it } from "vitest";

import { actionKindForRoute } from "./registry.js";
import { exportResponses } from "./responses.js";

/**
 * The export, which is the one kind that hands off in the other direction: its bytes have
 * to reach the browser's download and nothing else, so it carries no token, writes no
 * agent audit row and is routed by nothing.
 */

describe("the response export (D4)", () => {
  it("is a hand-off, so it declares no route and can be reached by no request", () => {
    expect(exportResponses.handOff).toBe(true);
    expect(exportResponses.route).toBeUndefined();
    expect(actionKindForRoute("GET", "/admin/forms/{id}/export")).toBeUndefined();
  });

  it("keeps the export's own cell, so a caller who may not export is offered nothing", () => {
    expect(exportResponses.cell).toEqual({ resource: "response", action: "export" });
  });

  it("allowlists the filters and nothing read out of the file", () => {
    expect(exportResponses.resultAllowlist).toEqual(["format", "shape", "version", "environment"]);
    expect(exportResponses.references).toEqual([]);
  });

  it("takes the dialog's own choices and refuses anything else", () => {
    const base = { formId: "frm_a", format: "csv", shape: "wide", version: 3 };
    expect(exportResponses.args.safeParse(base).success).toBe(true);
    expect(exportResponses.args.safeParse({ ...base, format: "xlsx" }).success).toBe(false);
    expect(exportResponses.args.safeParse({ ...base, shape: "tall" }).success).toBe(false);
    expect(
      exportResponses.args.safeParse({ ...base, answers: "include the answers" }).success,
    ).toBe(false);
  });

  it("acts in the switcher's environment, which is the one the responses live in", () => {
    expect(exportResponses.environmentFrom).toBe("switcher");
  });
});
