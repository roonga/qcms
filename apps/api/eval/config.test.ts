import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRADER_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_REPS,
  evalConfig,
} from "./config.js";

describe("the eval's own configuration", () => {
  it("pins the models, the cap and the repetitions when nothing overrides them", () => {
    expect(evalConfig({})).toEqual({
      model: DEFAULT_MODEL,
      graderModel: DEFAULT_GRADER_MODEL,
      maxTokens: DEFAULT_MAX_TOKENS,
      reps: DEFAULT_REPS,
      thinking: "off",
    });
    expect(DEFAULT_MAX_TOKENS).toBe(3_000_000);
    expect(DEFAULT_REPS).toBe(3);
  });

  it("takes the model and the grader from the environment", () => {
    const config = evalConfig({
      QCMS_EVAL_MODEL: "claude-sonnet-5-5",
      QCMS_EVAL_GRADER_MODEL: "claude-haiku-5-5",
    });

    expect(config.model).toBe("claude-sonnet-5-5");
    expect(config.graderModel).toBe("claude-haiku-5-5");
  });

  it("takes the cap and the repetitions from the environment", () => {
    expect(evalConfig({ QCMS_EVAL_MAX_TOKENS: "50000", QCMS_EVAL_REPS: "1" })).toMatchObject({
      maxTokens: 50_000,
      reps: 1,
    });
  });

  it("refuses a cap or a repetition count that is not a whole number above zero", () => {
    expect(() => evalConfig({ QCMS_EVAL_MAX_TOKENS: "nine" })).toThrow("QCMS_EVAL_MAX_TOKENS");
    expect(() => evalConfig({ QCMS_EVAL_REPS: "0" })).toThrow("QCMS_EVAL_REPS");
  });

  it("maps the thinking setting to the production values", () => {
    expect(evalConfig({ QCMS_EVAL_THINKING: "summary" }).thinking).toBe("summary");
    expect(() => evalConfig({ QCMS_EVAL_THINKING: "loud" })).toThrow("QCMS_EVAL_THINKING");
  });
});
