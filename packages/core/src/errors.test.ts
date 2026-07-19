import { describe, expect, it } from "vitest";

import { QcmsError, err, ok, qcmsError } from "./index.js";

describe("QcmsError", () => {
  it("round-trips the base shape, with and without path", () => {
    const withPath = { code: "SOME_CODE", message: "explains itself", path: ["steps", 0] };
    expect(QcmsError.parse(withPath)).toEqual(withPath);
    const bare = { code: "SOME_CODE", message: "explains itself" };
    expect(QcmsError.parse(bare)).toEqual(bare);
  });

  it("rejects empty code or message", () => {
    expect(QcmsError.safeParse({ code: "", message: "m" }).success).toBe(false);
    expect(QcmsError.safeParse({ code: "C", message: "" }).success).toBe(false);
    expect(QcmsError.safeParse({ code: "C" }).success).toBe(false);
  });

  it("qcmsError builds the shape and copies the path", () => {
    expect(qcmsError("C", "m")).toEqual({ code: "C", message: "m" });
    const path = ["a", 1] as const;
    const built = qcmsError("C", "m", path);
    expect(built).toEqual({ code: "C", message: "m", path: ["a", 1] });
  });
});

describe("Result helpers", () => {
  it("ok and err tag their payloads", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err(qcmsError("C", "m"))).toEqual({ ok: false, error: { code: "C", message: "m" } });
  });
});
