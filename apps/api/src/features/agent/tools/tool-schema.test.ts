import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { asSchema } from "ai";

import { Condition, FormDefinition } from "@roonga/qcms-core";

import {
  collectRefs,
  selfContainedToolSchema,
  TOOL_SCHEMA_CONDITION_DEPTH,
} from "./tool-schema.js";

const recursiveDocument = {
  type: "object",
  properties: { when: { $ref: "#/definitions/node" } },
  required: ["when"],
  definitions: {
    node: {
      oneOf: [
        { type: "object", properties: { op: { const: "leaf" } }, required: ["op"] },
        {
          type: "object",
          properties: {
            op: { const: "and" },
            conditions: { type: "array", items: { $ref: "#/definitions/node" }, minItems: 1 },
          },
          required: ["op", "conditions"],
        },
      ],
    },
  },
} as const;

describe("selfContainedToolSchema", () => {
  it("emits $defs rather than definitions", () => {
    // LM Studio's schema-to-grammar conversion reads `$defs`; the Zod conversion writes
    // draft-07 `definitions`, which leaves the $ref resolving to nothing.
    const out = selfContainedToolSchema(recursiveDocument as never, 2);
    expect(out.$defs).toBeDefined();
    expect(JSON.stringify(out)).not.toContain('"definitions"');
  });

  it("resolves every reference inside the document it ships", () => {
    const out = selfContainedToolSchema(recursiveDocument as never, 3);
    const refs = collectRefs(out);
    expect(refs.length).toBeGreaterThan(0);
    for (const { ref, resolves } of refs) expect(resolves, ref).toBe(true);
  });

  it("leaves no reference cycle, which is the half a resolve check misses", () => {
    const out = selfContainedToolSchema(recursiveDocument as never, 3);
    const defs = out.$defs ?? {};
    for (const [name, entry] of Object.entries(defs)) {
      const reachable = collectRefs(entry as never).map((r) => r.ref);
      expect(reachable, `${name} references itself`).not.toContain(`#/$defs/${name}`);
    }
    // Entries are numbered by remaining budget, so one at depth n may only name n-1.
    const depthOf = (name: string): number => Number(/_d(\d+)$/u.exec(name)?.[1] ?? "0");
    for (const [name, entry] of Object.entries(defs)) {
      for (const { ref } of collectRefs(entry as never)) {
        const target = ref.slice("#/$defs/".length);
        expect(depthOf(target), `${name} -> ${target}`).toBeLessThan(depthOf(name));
      }
    }
  });

  it("unrolls to exactly the requested depth and stops", () => {
    const one = selfContainedToolSchema(recursiveDocument as never, 1);
    const three = selfContainedToolSchema(recursiveDocument as never, 3);
    expect(Object.keys(one.$defs ?? {})).toHaveLength(1);
    expect(Object.keys(three.$defs ?? {})).toHaveLength(3);
    const floor = (one.$defs?.node_d1 ?? {}) as { oneOf?: unknown[] };
    expect(floor.oneOf).toHaveLength(1);
  });

  it("drops a branch it cannot write rather than emitting a broken one", () => {
    const out = selfContainedToolSchema(recursiveDocument as never, 1);
    // Keeping the arm without its required `conditions` would describe an object no
    // valid document matches.
    expect(JSON.stringify(out)).not.toContain("conditions");
  });

  it("throws rather than shipping a tool no model can call", () => {
    expect(() => selfContainedToolSchema(recursiveDocument as never, 0)).toThrow(/unsatisfiable/iu);
  });

  it("keeps a closed object closed rather than reading `false` as unsatisfiable", () => {
    // Why the unsatisfiable sentinel is an internal marker and not the JSON Schema
    // `false` literal: `additionalProperties: false` means "no extra properties", not
    // "no instance can match".
    const closed = {
      type: "object",
      properties: { a: { type: "string" } },
      additionalProperties: false,
    } as const;
    const out = selfContainedToolSchema(closed, 3);
    expect(out.additionalProperties).toBe(false);
    expect(out.properties).toEqual({ a: { type: "string" } });
  });

  it("leaves a schema with no references alone", () => {
    const plain = { type: "object", properties: { a: { type: "string" } } } as const;
    expect(selfContainedToolSchema(plain as never, 3)).toEqual(plain);
  });

  it("keeps keywords that sit beside a $ref", () => {
    const described = {
      type: "object",
      properties: { when: { $ref: "#/definitions/node", description: "keep me" } },
      definitions: { node: { type: "string" } },
    } as const;
    const out = selfContainedToolSchema(described, 2);
    const properties = out.properties as Record<string, { description?: string } | undefined>;
    expect(properties["when"]?.description).toBe("keep me");
  });
});

describe("the bounded advertisement cannot admit a form the kernel rejects", () => {
  const nested = (depth: number): unknown =>
    depth <= 1
      ? { op: "answered", questionId: "q_a" }
      : { op: "and", conditions: [{ op: "answered", questionId: "q_a" }, nested(depth - 1)] };

  const nestedOver = (leaf: unknown, depth: number): unknown =>
    depth <= 1 ? leaf : { op: "not", condition: nestedOver(leaf, depth - 1) };

  it("still accepts a condition deeper than the advertised bound", () => {
    // A provider that treats the schema as advice can send past the bound; the kernel's
    // own cap is higher, so it stands.
    const deep = nested(TOOL_SCHEMA_CONDITION_DEPTH + 2);
    expect(Condition.safeParse(deep).success).toBe(true);
  });

  it("advertises no shape the kernel's own schema would refuse", () => {
    const converted = selfContainedToolSchema(
      asSchema(z.object({ when: Condition })).jsonSchema as never,
      TOOL_SCHEMA_CONDITION_DEPTH,
    );
    const refs = collectRefs(converted);
    for (const { ref, resolves } of refs) expect(resolves, ref).toBe(true);
  });

  it("re-validates a whole draft with the full schema, not the advertised one", () => {
    const golden = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../../packages/core/golden/evaluator/forms/combinators.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as { rules: { ruleId: string; when: unknown; show: string[] }[] };

    const first = golden.rules[0];
    expect(first).toBeDefined();
    const deepened = {
      ...golden,
      rules: [{ ...first, when: nestedOver(first?.when, TOOL_SCHEMA_CONDITION_DEPTH + 2) }],
    };
    const parsed = FormDefinition.safeParse(deepened);
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  });
});
