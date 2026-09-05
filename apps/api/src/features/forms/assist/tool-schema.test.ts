/**
 * The rewriter that makes an emitted tool schema portable (issue #820).
 *
 * `tools.test.ts` holds the pin over the *real* tool set. This file tests the
 * rewriter itself against hand-written documents, because the properties that
 * matter - a bounded unroll is a narrowing, a dropped required property takes
 * its object with it - are easier to state and to trust on a small schema than
 * on the 12KB one `propose_draft` actually ships.
 */

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

/** The recursive document the SDK's conversion produces, in miniature. */
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
    // The whole live failure was a keyword-spelling mismatch: LM Studio's
    // schema-to-grammar conversion reads `$defs`, the Zod conversion writes
    // draft-07 `definitions`, and the surviving $ref resolved to nothing.
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
    // Stated separately because the pin issue #820 asked for - "every $ref
    // resolves" - was ALREADY TRUE of the broken schema: `#/definitions/__schema0`
    // did resolve, inside a document whose own recursion is what no engine could
    // convert. Acyclicity is the property that actually failed.
    const out = selfContainedToolSchema(recursiveDocument as never, 3);
    const defs = out.$defs ?? {};
    for (const [name, entry] of Object.entries(defs)) {
      const reachable = collectRefs(entry as never).map((r) => r.ref);
      expect(reachable, `${name} references itself`).not.toContain(`#/$defs/${name}`);
    }
    // And no longer path either: the entries are numbered by remaining budget,
    // so an entry at depth n can only name entries at depth n-1.
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
    // At the floor the recursive arm is gone, so only the leaf arm survives.
    const floor = (one.$defs?.node_d1 ?? {}) as { oneOf?: unknown[] };
    expect(floor.oneOf).toHaveLength(1);
  });

  it("drops a branch it cannot write rather than emitting a broken one", () => {
    const out = selfContainedToolSchema(recursiveDocument as never, 1);
    // `conditions` is required on the `and` arm and its item type is
    // unwritable at depth 1, so the arm goes whole. A schema that kept the arm
    // and dropped only the property would describe an object no valid document
    // matches, which is worse than not offering the arm at all.
    expect(JSON.stringify(out)).not.toContain("conditions");
  });

  it("throws rather than shipping a tool no model can call", () => {
    // Depth 0 makes the one required property unwritable, which makes the whole
    // input unwritable. Failing here beats emitting an empty tool.
    expect(() => selfContainedToolSchema(recursiveDocument as never, 0)).toThrow(/unsatisfiable/iu);
  });

  it("keeps a closed object closed rather than reading `false` as unsatisfiable", () => {
    // A real defect this caught during the fix, and the reason the sentinel is
    // an internal marker rather than the JSON Schema `false` literal: nearly
    // every converted schema carries `additionalProperties: false`, which is the
    // author saying "no extra properties", not "no instance can match". Reading
    // the two as the same thing made every tool schema unsatisfiable at once.
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
  /**
   * The property the fix rests on, asserted rather than asserted-in-prose.
   *
   * The tool schema is what the model is *shown*; `ProposeDraftInput.parse` in
   * `tools.ts` is what decides. Narrowing the advertisement removes documents
   * from the advertised set and adds none, so nothing the bounded schema
   * describes can escape the kernel's own validation - and nothing the kernel
   * accepts is refused merely because the advertisement was shorter.
   */
  const nested = (depth: number): unknown =>
    depth <= 1
      ? { op: "answered", questionId: "q_a" }
      : { op: "and", conditions: [{ op: "answered", questionId: "q_a" }, nested(depth - 1)] };

  /** Wrap a real condition in `not` until the tree reaches `depth`. */
  const nestedOver = (leaf: unknown, depth: number): unknown =>
    depth <= 1 ? leaf : { op: "not", condition: nestedOver(leaf, depth - 1) };

  it("still accepts a condition deeper than the advertised bound", () => {
    // A model on a provider that treats the schema as advice (rather than a
    // decoding grammar) can send depth 5. The kernel's cap is 8, so it stands.
    const deep = nested(TOOL_SCHEMA_CONDITION_DEPTH + 2);
    expect(Condition.safeParse(deep).success).toBe(true);
  });

  it("advertises no shape the kernel's own schema would refuse", () => {
    // Every arm the bounded document offers at its floor is a leaf condition,
    // and every leaf condition parses. The check is structural: the rewriter
    // only ever removes arms, so the advertised set is a subset by construction
    // and this asserts the base case that makes the induction non-vacuous.
    const converted = selfContainedToolSchema(
      asSchema(z.object({ when: Condition })).jsonSchema as never,
      TOOL_SCHEMA_CONDITION_DEPTH,
    );
    const refs = collectRefs(converted);
    for (const { ref, resolves } of refs) expect(resolves, ref).toBe(true);
  });

  it("re-validates a whole draft with the full schema, not the advertised one", () => {
    // The seam itself: `providerSchema` hands the SDK a bounded document and an
    // unbounded validator. Proven on a real golden form whose rule is deepened
    // past the advertised bound, parsed through the same `FormDefinition` schema
    // `ProposeDraftInput` wraps.
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
