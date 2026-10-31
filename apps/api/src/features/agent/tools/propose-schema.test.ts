import { describe, expect, it } from "vitest";

import { offerableActionKinds } from "../screens.js";
import { advertisedJsonSchema } from "./registry.js";
import { proposeActionSchema, proposePlanSchema } from "./propose-schema.js";

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

describe("the propose tools' advertised schemas", () => {
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
        proposeActionSchema([{ kind: "link.mint", environments: ["test"] }]),
      ),
    );
    expect(schema).toContain("link.mint");
    expect(schema).not.toContain("form.release");
  });

  it("advertises no kind at all when the grant filter offered none", async () => {
    const schema = JSON.stringify(await advertisedJsonSchema(proposeActionSchema([])));
    expect(schema).not.toContain("link.mint");
    expect(schema).not.toContain("form.publish");
  });

  it("accepts one plan spanning the form subtree's screens (Code Owner, 2026-10-31)", () => {
    const offered = offerableActionKinds("/forms/[formId]/links").map((kind) => ({
      kind,
      environments: ["test"],
    }));
    const parsed = proposePlanSchema(offered).safeParse({
      steps: [
        { kind: "form.publish", args: { formId: "frm_a" } },
        {
          kind: "form.release",
          args: {
            formId: "frm_a",
            version: { fromStep: 0, field: "version" },
            environment: "test",
          },
        },
        {
          kind: "link.mint",
          args: { formId: "frm_a", count: 2, expiresAt: "2026-12-01T00:00:00.000Z", oneTime: true },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("lets any argument carry a symbolic reference to an earlier step", async () => {
    const schema = JSON.stringify(
      await advertisedJsonSchema(
        proposePlanSchema([{ kind: "form.release", environments: ["test"] }]),
      ),
    );
    expect(schema).toContain("fromStep");
  });
});
