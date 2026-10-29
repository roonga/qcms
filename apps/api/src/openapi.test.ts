import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import { jsonBody } from "./openapi.js";

const HONEYPOT_REASON = "the honeypot field name is deployment-configured";

describe("jsonBody accepts a closed request body", () => {
  it("returns the required application/json fragment carrying the schema", () => {
    const schema = z.strictObject({ formSlug: z.string() });

    expect(jsonBody(schema)).toEqual({
      required: true,
      content: { "application/json": { schema } },
    });
  });

  it("accepts a closed object that also carries a refinement and a component name", () => {
    const schema = z
      .strictObject({ a: z.boolean().optional(), b: z.number().optional() })
      .refine((v) => v.a !== undefined || v.b !== undefined, "at least one")
      .openapi("Patch", { minProperties: 1 });

    expect(jsonBody(schema).required).toBe(true);
  });
});

describe("jsonBody refuses a body that would strip or keep unknown keys", () => {
  it("refuses a plain z.object, naming strictObject as the fix", () => {
    expect(() => jsonBody(z.object({ a: z.string() }))).toThrow(/z\.strictObject/);
  });

  it("refuses an open object that gives no reason for being open", () => {
    expect(() => jsonBody(z.looseObject({ a: z.string() }))).toThrow(/openBecause/);
  });

  it("refuses a body that is not an object at all", () => {
    expect(() => jsonBody(z.array(z.string()))).toThrow(/not-an-object/);
  });
});

describe("jsonBody keeps an openBecause reason honest", () => {
  it("accepts an open body with a stated reason", () => {
    const schema = z.looseObject({ website: z.string().optional() });

    expect(jsonBody(schema, { openBecause: HONEYPOT_REASON }).required).toBe(true);
  });

  it("refuses a reason left on a body that has since been closed", () => {
    expect(() =>
      jsonBody(z.strictObject({ a: z.string() }), { openBecause: HONEYPOT_REASON }),
    ).toThrow(/no longer describes it/);
  });
});

// `catchall` is not Zod's public surface: an upgrade that renamed or dropped it would
// make `jsonBody` approve everything silently.
describe("the Zod internals the policy check reads (upgrade guard)", () => {
  function catchallType(schema: z.ZodType): string {
    const def = (schema as { _zod?: { def?: { catchall?: unknown } } })._zod?.def;
    const catchall = def?.catchall as { _zod?: { def?: { type?: string } } } | undefined;
    return catchall === undefined ? "absent" : (catchall._zod?.def?.type ?? "unreadable");
  }

  it.each([
    ["z.strictObject", z.strictObject({ a: z.string() }), "never"],
    ["z.looseObject", z.looseObject({ a: z.string() }), "unknown"],
    ["z.object", z.object({ a: z.string() }), "absent"],
  ])("%s records catchall %s", (_label, schema, expected) => {
    expect(catchallType(schema)).toBe(expected);
  });

  it("still reports the object type through .refine() and .openapi()", () => {
    const schema = z
      .strictObject({ a: z.string() })
      .refine(() => true)
      .openapi("Chained");
    const def = (schema as { _zod?: { def?: { type?: string } } })._zod?.def;

    expect(def?.type).toBe("object");
  });
});
