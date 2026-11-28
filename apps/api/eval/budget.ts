export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export const NO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  };
}

export function sumUsage(usages: readonly Usage[]): Usage {
  return usages.reduce(addUsage, NO_USAGE);
}

/** Input, output and cache writes: a cache read is reported on its own line and not charged. */
export function chargedTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens;
}

export interface Budget {
  readonly maxTokens: number;
  readonly spent: Usage;
}

export function newBudget(maxTokens: number): Budget {
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error("the token cap must be a whole number above zero");
  }
  return { maxTokens, spent: NO_USAGE };
}

export function charge(budget: Budget, usage: Usage): Budget {
  return { maxTokens: budget.maxTokens, spent: addUsage(budget.spent, usage) };
}

export function tokensLeft(budget: Budget): number {
  return Math.max(0, budget.maxTokens - chargedTokens(budget.spent));
}

/** Stops the next turn starting; a turn already running is never cut off part way. */
export function capReached(budget: Budget): boolean {
  return tokensLeft(budget) === 0;
}
