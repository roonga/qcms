import { describe, expect, it } from "vitest";

import type { FormReleaseHistoryRow } from "@roonga/qcms-db";

import { ApiError } from "../../errors.js";
import {
  effectiveWorkflow,
  productionFloorApplies,
  requireDraftEligible,
  requirePrerequisite,
  ruleFor,
  type WorkflowRule,
} from "./workflow.js";

const SITES: readonly (readonly string[])[] = [
  ["test", "prod"],
  ["dev", "test", "prod"],
  ["dev", "prod"],
  ["staging", "prod"],
];

/** Every prod rule a revision could hold, the ones that try to lift the floor included. */
function prodRules(served: readonly string[]): WorkflowRule[] {
  const prerequisites = [[], ...served.filter((name) => name !== "prod").map((name) => [name])];
  const rules: WorkflowRule[] = [];
  for (const requiresPriorReleaseIn of prerequisites) {
    for (const allowsDraftPublish of [true, false]) {
      for (const allowsInBatch of [true, false]) {
        rules.push({
          environment: "prod",
          requiresPriorReleaseIn,
          allowsDraftPublish,
          allowsInBatch,
        });
      }
    }
  }
  return rules;
}

function configurations(served: readonly string[]) {
  return [
    undefined,
    { revision: 1, rules: [] },
    ...prodRules(served).map((rule) => ({ revision: 1, rules: [rule] })),
  ];
}

function release(environment: string, version: number): FormReleaseHistoryRow {
  return { environment, version } as unknown as FormReleaseHistoryRow;
}

function codeOf(thunk: () => void): string | undefined {
  try {
    thunk();
    return undefined;
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
}

describe("the fixed prod floor", () => {
  it("applies only where prod is served beside a non-prod environment", () => {
    expect(productionFloorApplies(["test", "prod"])).toBe(true);
    expect(productionFloorApplies(["dev", "prod"])).toBe(true);
    expect(productionFloorApplies(["prod"])).toBe(false);
    expect(productionFloorApplies(["test"])).toBe(false);
  });

  it("refuses a draft straight to prod under every configuration where a non-prod environment exists", () => {
    for (const served of SITES) {
      for (const configured of configurations(served)) {
        const workflow = effectiveWorkflow(configured, served);
        expect(ruleFor(workflow, "prod").allowsDraftPublish).toBe(false);
        expect(
          codeOf(() => requireDraftEligible(workflow, "prod")),
          `${served.join(",")} ${JSON.stringify(configured)}`,
        ).toBeDefined();
      }
    }
  });

  it("refuses a version live nowhere but accepts one live in any non-prod environment", () => {
    for (const served of SITES) {
      for (const configured of configurations(served)) {
        const workflow = effectiveWorkflow(configured, served);
        const label = `${served.join(",")} ${JSON.stringify(configured)}`;
        expect(
          codeOf(() =>
            requirePrerequisite({ workflow, releases: [], environment: "prod", version: 1 }),
          ),
          label,
        ).toBeDefined();
        const required = ruleFor(workflow, "prod").requiresPriorReleaseIn;
        expect(required.length, label).toBeGreaterThan(0);
        expect(required.includes("prod"), label).toBe(false);
        for (const environment of required) {
          expect(
            codeOf(() =>
              requirePrerequisite({
                workflow,
                releases: [release(environment, 1)],
                environment: "prod",
                version: 1,
              }),
            ),
            label,
          ).toBeUndefined();
        }
      }
    }
  });

  it("accepts any non-prod environment under the default, not test alone", () => {
    const workflow = effectiveWorkflow(undefined, ["dev", "test", "prod"]);
    expect(ruleFor(workflow, "prod").requiresPriorReleaseIn).toEqual(["dev", "test"]);
    expect(
      codeOf(() =>
        requirePrerequisite({
          workflow,
          releases: [release("dev", 2)],
          environment: "prod",
          version: 2,
        }),
      ),
    ).toBeUndefined();
  });

  it("keeps the default refusal code and names the non-prod environments", () => {
    const workflow = effectiveWorkflow(undefined, ["test", "prod"]);
    try {
      requireDraftEligible(workflow, "prod");
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).code).toBe("TEST_RELEASE_REQUIRED");
      expect((error as ApiError).details).toEqual({ environment: "prod", requiresAnyOf: ["test"] });
    }
  });

  it("lets a rollback through, since prod already served that version", () => {
    const workflow = effectiveWorkflow(undefined, ["test", "prod"]);
    expect(
      codeOf(() =>
        requirePrerequisite({
          workflow,
          releases: [release("prod", 1)],
          environment: "prod",
          version: 1,
        }),
      ),
    ).toBeUndefined();
  });

  it("leaves a prod-only site free to publish a draft to prod", () => {
    for (const configured of [undefined, { revision: 1, rules: [] }]) {
      const workflow = effectiveWorkflow(configured, ["prod"]);
      expect(codeOf(() => requireDraftEligible(workflow, "prod"))).toBeUndefined();
    }
  });

  it("leaves the non-prod environments to the configuration", () => {
    const workflow = effectiveWorkflow(
      {
        revision: 1,
        rules: [
          {
            environment: "test",
            requiresPriorReleaseIn: [],
            allowsDraftPublish: false,
            allowsInBatch: true,
          },
        ],
      },
      ["test", "prod"],
    );
    expect(codeOf(() => requireDraftEligible(workflow, "test"))).toBe("DRAFT_PUBLISH_NOT_ALLOWED");
    expect(ruleFor(workflow, "test").requiresPriorReleaseIn).toEqual([]);
  });
});
