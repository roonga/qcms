import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ScenarioRunError } from "./harness.js";
import { parseTrace, usageOfTrace } from "./trace.js";

const FIXTURE = fileURLToPath(new URL("fixtures/trace-smoke.json", import.meta.url));

function smoke(): ReturnType<typeof parseTrace> {
  return parseTrace(JSON.parse(readFileSync(FIXTURE, "utf8")));
}

describe("a repetition that stopped part way", () => {
  it("carries the turns it reached, so the run records and charges them", () => {
    const cause = new Error("the assist turn answered 500");
    const error = new ScenarioRunError("S00 repetition 1 stopped", smoke(), cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.trace.turns).toHaveLength(1);
    expect(usageOfTrace(error.trace)).toMatchObject({ inputTokens: 520, cacheWriteTokens: 900 });
    expect(error.cause).toBe(cause);
  });
});
