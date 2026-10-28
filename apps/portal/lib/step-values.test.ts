import { describe, expect, it } from "vitest";

import { mergeStepValues } from "./step-values";

describe("mergeStepValues", () => {
  it("shows the stored answers when there is no context (a plain resume)", () => {
    expect(mergeStepValues({ q_x: 5, q_plate: "ABC-123" }, undefined)).toEqual({
      q_x: 5,
      q_plate: "ABC-123",
    });
  });

  it("lets the context override a stored answer, so a refused input stays on screen", () => {
    expect(mergeStepValues({ q_plate: "OLD-000" }, { q_plate: "typed-by-hand" })).toEqual({
      q_plate: "typed-by-hand",
    });
  });

  it("lets a stored answer show through for a question the context never mentions", () => {
    expect(mergeStepValues({ q_x: 5, q_plate: "ABC-123" }, { q_plate: "new" })).toEqual({
      q_x: 5,
      q_plate: "new",
    });
  });

  it("CLEARS a field the context cleared, rather than falling back to the stored answer", () => {
    const merged = mergeStepValues({ q_x: 5 }, { q_x: undefined });
    expect(merged.q_x).toBeUndefined();
    expect(Object.hasOwn(merged, "q_x")).toBe(true);
  });

  it("distinguishes a cleared key from an absent one over the same stored answer", () => {
    expect(mergeStepValues({ q_x: 5 }, {}).q_x).toBe(5);
    expect(mergeStepValues({ q_x: 5 }, { q_x: undefined }).q_x).toBeUndefined();
  });

  it("clears one field without disturbing the answers beside it", () => {
    expect(mergeStepValues({ q_x: 5, q_plate: "ABC-123" }, { q_x: undefined })).toEqual({
      q_x: undefined,
      q_plate: "ABC-123",
    });
  });
});
