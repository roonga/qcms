import { describe, expect, it } from "vitest";

import { advertisedJsonSchema } from "./registry.js";
import { MAX_PLAN_TITLE } from "./plan-title.js";
import { proposePlanSchema } from "./propose-schema.js";
import { collectRefs } from "./tool-schema.js";

/**
 * Criterion 3 on the provider-facing schema: an editor without `prod` in scope is shown a
 * release kind whose environment enum has no `prod`, and a caller offered nothing is shown
 * no kind at all.
 */

const EDITOR_WITHOUT_PROD = [
  { kind: "form.publish", environments: ["test"] },
  { kind: "form.release", environments: ["test", "staging"] },
] as const;

function enumsIn(value: unknown, member: string): string[][] {
  const found: string[][] = [];
  const walk = (node: unknown, key: string | undefined): void => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, key);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const row = node as Record<string, unknown>;
    if (key === member && Array.isArray(row.enum)) {
      found.push(row.enum.filter((entry): entry is string => typeof entry === "string"));
    }
    for (const [name, child] of Object.entries(row)) {
      walk(child, name === "properties" || name === "anyOf" || name === "oneOf" ? key : name);
    }
  };
  walk(value, undefined);
  return found;
}

describe("the propose tool's advertised schema", () => {
  it("narrows an argument kind's environment enum to the caller's environments", async () => {
    const schema = await advertisedJsonSchema(proposePlanSchema(EDITOR_WITHOUT_PROD));
    const enums = enumsIn(schema, "environment");
    expect(enums.length).toBeGreaterThan(0);
    for (const values of enums) {
      expect(values).not.toContain("prod");
      expect(values).toContain("test");
    }
  });

  it("advertises only the offered kinds", async () => {
    const schema = JSON.stringify(
      await advertisedJsonSchema(
        proposePlanSchema([{ kind: "link.mint", environments: ["test"] }]),
      ),
    );
    expect(schema).toContain("link.mint");
    expect(schema).not.toContain("form.release");
  });

  it("advertises no kind at all when the grant filter offered none", async () => {
    const schema = JSON.stringify(await advertisedJsonSchema(proposePlanSchema([])));
    expect(schema).not.toContain("link.mint");
    expect(schema).not.toContain("form.publish");
  });

  it("offers an optional title, capped at a heading's length", () => {
    const schema = proposePlanSchema([{ kind: "form.publish", environments: ["test"] }]);
    const steps = [{ kind: "form.publish", args: { formId: "frm_a", environment: "test" } }];

    expect(schema.safeParse({ steps }).success).toBe(true);
    expect(
      schema.safeParse({ steps, title: "Add the questions, then publish to test" }).success,
    ).toBe(true);
    expect(schema.safeParse({ steps, title: "x".repeat(MAX_PLAN_TITLE + 1) }).success).toBe(false);
  });

  it("accepts a plan of one step, which is how a single action is proposed", () => {
    const parsed = proposePlanSchema([{ kind: "form.publish", environments: ["test"] }]).safeParse({
      steps: [{ kind: "form.publish", args: { formId: "frm_a", environment: "test" } }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a plan spanning one form subtree, and refuses one spanning both", () => {
    const authoring = ["apply-draft", "form.publish", "form.settings", "form.release"].map(
      (kind) => ({ kind, environments: ["test"] }),
    );
    const parsed = proposePlanSchema(authoring).safeParse({
      steps: [
        { kind: "form.publish", args: { formId: "frm_a", environment: "test" } },
        {
          kind: "form.release",
          args: {
            formId: "frm_a",
            version: { fromStep: 0, field: "version" },
            environment: "test",
          },
        },
      ],
    });
    expect(parsed.success).toBe(true);

    // The two form subtrees are separate lists, so a step of the other kind is not in the
    // schema the turn was offered.
    const mixed = proposePlanSchema(authoring).safeParse({
      steps: [
        { kind: "form.publish", args: { formId: "frm_a", environment: "test" } },
        {
          kind: "link.mint",
          args: { formId: "frm_a", count: 2, expiresAt: "2026-12-01T00:00:00.000Z", oneTime: true },
        },
      ],
    });
    expect(mixed.success).toBe(false);
  });

  it("lets any argument carry a symbolic reference to an earlier step", async () => {
    const schema = JSON.stringify(
      await advertisedJsonSchema(
        proposePlanSchema([{ kind: "form.release", environments: ["test"] }]),
      ),
    );
    expect(schema).toContain("fromStep");
  });

  it("writes the step reference once and points every argument at that one definition", async () => {
    const schema = await advertisedJsonSchema(
      proposePlanSchema([
        { kind: "form.publish", environments: ["test"] },
        { kind: "form.release", environments: ["test"] },
      ]),
    );
    const refs = collectRefs(schema).filter(({ ref }) => ref.includes("StepReference"));
    expect(refs.length).toBeGreaterThan(1);
    for (const { resolves } of refs) expect(resolves).toBe(true);
    expect(new Set(refs.map(({ ref }) => ref)).size).toBe(1);
    expect(JSON.stringify(schema).match(/The zero-based index of an earlier step/gu)).toHaveLength(
      1,
    );
  });
});
