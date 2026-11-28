import { describe, expect, it } from "vitest";

import {
  NO_USAGE,
  addUsage,
  capReached,
  charge,
  chargedTokens,
  newBudget,
  sumUsage,
  tokensLeft,
} from "./budget.js";

const TURN = {
  inputTokens: 400,
  outputTokens: 100,
  cacheReadTokens: 900,
  cacheWriteTokens: 50,
};

describe("what a run has spent", () => {
  it("adds the four lines apart from one another", () => {
    expect(addUsage(TURN, TURN)).toEqual({
      inputTokens: 800,
      outputTokens: 200,
      cacheReadTokens: 1800,
      cacheWriteTokens: 100,
    });
    expect(sumUsage([])).toEqual(NO_USAGE);
  });

  it("charges input, output and the cache write, leaving the cache read reported", () => {
    expect(chargedTokens(TURN)).toBe(550);
    expect(chargedTokens({ ...NO_USAGE, cacheReadTokens: 90_000 })).toBe(0);
  });
});

describe("the cost cap", () => {
  it("refuses a cap that is not a whole number above zero", () => {
    expect(() => newBudget(0)).toThrow("above zero");
    expect(() => newBudget(1.5)).toThrow("above zero");
  });

  it("counts down as turns are charged", () => {
    const budget = charge(charge(newBudget(2000), TURN), TURN);

    expect(tokensLeft(budget)).toBe(900);
    expect(capReached(budget)).toBe(false);
  });

  it("stops the next turn once the cap is reached and never goes below zero", () => {
    const budget = charge(newBudget(1100), addUsage(TURN, TURN));

    expect(capReached(budget)).toBe(true);
    expect(tokensLeft(budget)).toBe(0);
  });
});
