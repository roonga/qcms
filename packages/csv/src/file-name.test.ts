import { describe, expect, it } from "vitest";

import { responseExportFileName } from "./file-name.js";

describe("responseExportFileName", () => {
  it("names the environment in every shape", () => {
    expect(
      responseExportFileName({ formId: "frm_x", environment: "prod", extension: "json" }),
    ).toBe("frm_x-prod-responses.json");
    expect(
      responseExportFileName({
        formId: "frm_x",
        environment: "test",
        version: 3,
        extension: "csv",
      }),
    ).toBe("frm_x-test-v3-responses.csv");
    expect(
      responseExportFileName({
        formId: "frm_x",
        environment: "test",
        version: 3,
        extension: "zip",
      }),
    ).toBe("frm_x-test-v3-responses.zip");
  });

  it("tells two environments' exports of one form and version apart", () => {
    // Otherwise these are one name on an operator's desktop, and a report built
    // from the wrong file looks exactly like one built from the right one.
    const base = { formId: "frm_x", version: 1, extension: "csv" } as const;
    expect(responseExportFileName({ ...base, environment: "prod" })).not.toBe(
      responseExportFileName({ ...base, environment: "test" }),
    );
  });

  it("keeps the version next to `responses`, which is where a glob expects it", () => {
    expect(
      responseExportFileName({
        formId: "frm_x",
        environment: "prod",
        version: 12,
        extension: "csv",
      }),
    ).toMatch(/-v12-responses\.csv$/);
  });
});
