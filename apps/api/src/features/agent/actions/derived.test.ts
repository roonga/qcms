import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ACTION_KINDS } from "./registry.js";
import type { ActionKindDef } from "./types.js";
import { buildApiDocuments, type OpenApiDocument } from "../../../openapi-document.js";

/**
 * The half the type system cannot state: that the schema a kind derived from really is the
 * one its route publishes, and that a route carrying a body has a kind deriving from it.
 * Read against the generated document, which is what the route tree itself agrees on.
 */

const document: OpenApiDocument = buildApiDocuments().admin;

type Operation = { readonly requestBody?: unknown };

function operationFor(def: ActionKindDef): Operation | undefined {
  const route = def.route;
  if (route === undefined) return undefined;
  const path = (document.paths ?? {})[route.path] as
    Readonly<Record<string, Operation>> | undefined;
  return path?.[route.method.toLowerCase()];
}

/** The request body's own property names, following the component reference the document uses. */
function bodyProperties(operation: Operation): readonly string[] | undefined {
  const content = (
    operation.requestBody as
      { readonly content?: Record<string, { readonly schema?: unknown }> } | undefined
  )?.content?.["application/json"];
  if (content?.schema === undefined) return undefined;
  let schema = content.schema as { readonly $ref?: string; readonly properties?: object };
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.slice(schema.$ref.lastIndexOf("/") + 1);
    const components = (document as { components?: { schemas?: Record<string, typeof schema> } })
      .components;
    const resolved = components?.schemas?.[name];
    if (resolved === undefined) return undefined;
    schema = resolved;
  }
  return Object.keys(schema.properties ?? {});
}

function memberNames(schema: z.ZodType): readonly string[] {
  return Object.keys((schema as unknown as { readonly shape: object }).shape);
}

const routed = Object.values(ACTION_KINDS).filter((def) => def.route !== undefined);

describe("every kind's arguments come from its route's request schema", () => {
  it("resolves every routed kind to an operation in the generated document", () => {
    expect(routed.length).toBeGreaterThan(0);
    for (const def of routed) {
      expect(
        operationFor(def),
        `${def.kind} names no operation the document carries`,
      ).toBeDefined();
    }
  });

  it("derives from a request body wherever the route carries one", () => {
    for (const def of routed) {
      const operation = operationFor(def);
      if (operation === undefined) throw new Error(def.kind);
      const properties = bodyProperties(operation);
      if (properties === undefined) {
        // Nothing to derive from: every argument of such a kind is the route path's own.
        expect(def.argsFrom, `${def.kind} derives from a body its route does not carry`).toBe(
          undefined,
        );
        continue;
      }
      expect(def.argsFrom, `${def.kind} has a request body it derives nothing from`).toBeDefined();
      expect([...memberNames(def.argsFrom?.body ?? z.strictObject({}))].sort(), def.kind).toEqual(
        [...properties].sort(),
      );
    }
  });

  it("names every body member either as an argument or as one no step names", () => {
    for (const def of routed) {
      const derivation = def.argsFrom;
      if (derivation === undefined) continue;
      const args = new Set(memberNames(def.args));
      for (const member of memberNames(derivation.body)) {
        if (derivation.unnamed.includes(member)) continue;
        expect(
          args,
          `${def.kind} leaves the body member "${member}" out of its arguments`,
        ).toContain(member);
      }
      for (const member of derivation.unnamed) {
        expect(
          memberNames(derivation.body),
          `${def.kind} leaves out "${member}", which the body does not carry`,
        ).toContain(member);
      }
    }
  });

  it("reaches no route for the kinds that carry no token", () => {
    for (const def of Object.values(ACTION_KINDS)) {
      if (def.route !== undefined) continue;
      expect(def.handOff === true || def.local === true, def.kind).toBe(true);
      expect(def.argsFrom, def.kind).toBeUndefined();
    }
  });
});
