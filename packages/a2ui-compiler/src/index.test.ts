import { describe, expect, it } from "vitest";

import { packageName } from "./index.js";

describe("@qcms/a2ui-compiler placeholder", () => {
  it("exports the package name (pipeline smoke test, task 001)", () => {
    expect(packageName).toBe("@qcms/a2ui-compiler");
  });
});
