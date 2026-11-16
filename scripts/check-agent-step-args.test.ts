import { describe, expect, it } from "vitest";

import {
  HANDED_OFF_KINDS,
  STEP_ACTIONS,
  STEP_BOUND_ARGUMENTS,
  advertisedKinds,
  checkAgentStepArgs,
  checkStepArguments,
  runnerReads,
} from "./check-agent-step-args.mjs";

/** One kind with one argument, in the shape the rendered tool view carries. */
function rendered(
  kinds: Readonly<Record<string, readonly string[]>>,
  extra: readonly object[] = [],
): string {
  const arms = Object.entries(kinds).map(([kind, args]) => ({
    properties: {
      kind: { type: "string", const: kind },
      args: { properties: Object.fromEntries(args.map((name) => [name, {}])) },
    },
  }));
  return JSON.stringify([
    ...extra,
    { name: "propose_plan", inputSchema: { properties: { steps: { items: { anyOf: arms } } } } },
  ]);
}

const RUNNER = `const RUNNERS = {
  "form.close": async ({ step, args }) => run(step.environment, text(args["formId"])),
};`;

describe("the agent step argument check", () => {
  it("passes the repository as it stands", () => {
    expect(checkAgentStepArgs()).toEqual([]);
  });

  it("reads every advertised kind and its arguments out of the rendered view", () => {
    expect(advertisedKinds(rendered({ "form.close": ["formId"] }))).toEqual({
      "form.close": ["formId"],
    });
  });

  it("reads the kinds a runner keys on and every argument name it names", () => {
    expect(runnerReads(RUNNER)).toEqual({ kinds: ["form.close"], names: ["formId"] });
  });

  it("accepts a runner that reads exactly what its kind advertises", () => {
    expect(checkStepArguments(rendered({ "form.close": ["formId"] }), RUNNER)).toEqual([]);
  });

  it("refuses an argument the kind advertises and no runner reads", () => {
    const problems = checkStepArguments(rendered({ "form.close": ["formId", "note"] }), RUNNER);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('reads no "note" argument');
  });

  it("refuses an argument a runner reads and no kind advertises", () => {
    const problems = checkStepArguments(
      rendered({ "form.close": ["formId"] }),
      `${RUNNER}\nconst extra = text(args["note"]);`,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('reads an "note" argument no kind advertises');
  });

  it("refuses a kind with no runner, and a runner naming no kind", () => {
    const missing = checkStepArguments(
      rendered({ "form.close": ["formId"], "form.reopen": ["formId"] }),
      RUNNER,
    );
    expect(missing.some((problem) => problem.includes('no runner for "form.reopen"'))).toBe(true);

    const stray = checkStepArguments(rendered({ "form.reopen": ["formId"] }), RUNNER);
    expect(stray.some((problem) => problem.includes('runs "form.close"'))).toBe(true);
  });

  it("asks nothing of a handed-off kind's arguments, because no runner completes one", () => {
    const kind = HANDED_OFF_KINDS[0] ?? "";
    expect(
      checkStepArguments(rendered({ "form.close": ["formId"], [kind]: ["format"] }), RUNNER),
    ).toEqual([]);
  });

  it("takes the environment off the step rather than the arguments", () => {
    const bound = STEP_BOUND_ARGUMENTS[0] ?? "";
    expect(checkStepArguments(rendered({ "form.close": ["formId", bound] }), RUNNER)).toEqual([]);
    const problems = checkStepArguments(
      rendered({ "form.close": ["formId"] }),
      RUNNER.replace("step.environment", "step.where"),
    );
    expect(problems.some((problem) => problem.includes("never reads step.environment"))).toBe(true);
  });

  it("refuses a vacuous run on either side", () => {
    expect(checkStepArguments(JSON.stringify([]), RUNNER)[0]).toContain(
      "advertises no action kind",
    );
    expect(checkStepArguments(rendered({ "form.close": ["formId"] }), "")[0]).toContain(
      `${STEP_ACTIONS} reads no step argument`,
    );
  });
});
