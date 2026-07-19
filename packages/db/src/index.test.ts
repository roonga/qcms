import { describe, expect, it } from "vitest";

import { packageName } from "./index.js";

describe("@qcms/db placeholder", () => {
  it("exports the package name (pipeline smoke test, task 001)", () => {
    expect(packageName).toBe("@qcms/db");
  });
});
