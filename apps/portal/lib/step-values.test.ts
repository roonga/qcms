import { describe, expect, it } from "vitest";

import { mergeStepValues } from "./step-values";

/**
 * The merge the no-JS re-render does (issue #327), tested at the seam that
 * actually decides what a respondent sees rather than at the schema above it.
 *
 * The bug this file exists to stop: validation dropped a `values` entry it could
 * not read, on the reasoning that a dropped key degrades to the same state as an
 * absent one. Under a spread over the stored answers that is false. Absent lets
 * the stored answer show through; the pre-validation code's `null` overrode it.
 * So "drop it" silently turned a refused answer back into the accepted answer the
 * respondent was in the middle of replacing, next to an error message saying that
 * value was wrong.
 */

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

  /**
   * The regression. A respondent with an ACCEPTED number answer of 5 edits it to
   * "abc" and posts. `step-form.ts` decodes that to `NaN`, `JSON.stringify` writes
   * `NaN` as `null`, and validation turns it into an explicit clear. The field
   * must go blank beside "Enter a number", never back to the stale 5.
   */
  it("CLEARS a field the context cleared, rather than falling back to the stored answer", () => {
    const merged = mergeStepValues({ q_x: 5 }, { q_x: undefined });
    expect(merged.q_x).toBeUndefined();
    // The key is still present: an explicit clear, not a silent absence.
    expect(Object.hasOwn(merged, "q_x")).toBe(true);
  });

  it("distinguishes a cleared key from an absent one over the same stored answer", () => {
    // The two inputs are indistinguishable in a JSON dump and are opposite
    // renders. This is the assertion whose absence let the regression through.
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
