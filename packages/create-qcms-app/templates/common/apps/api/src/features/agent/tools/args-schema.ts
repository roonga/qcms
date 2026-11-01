import { z } from "zod";

import type { ActionKindDef } from "../actions/types.js";

/** The shape a symbolic reference to an earlier step's result takes in a proposed step. */
export const StepReferenceSchema = z
  .strictObject({
    fromStep: z.number().int().min(0).describe("The zero-based index of an earlier step."),
    field: z.string().min(1).max(100).describe("A result field that step returns."),
  })
  .describe("A reference to an earlier step's result, resolved when the plan runs.");

export function argumentMembers(def: ActionKindDef): Readonly<Record<string, z.ZodType>> {
  return (def.args as unknown as { readonly shape: Record<string, z.ZodType> }).shape;
}

/**
 * The kind's own schema with each named member replaced by the reference shape, so a step
 * that defers one argument to an earlier step's result still has every other argument
 * checked against the kind's schema.
 */
export function argsSchemaWithReferences(
  def: ActionKindDef,
  referenced: ReadonlySet<string>,
): z.ZodType {
  if (referenced.size === 0) return def.args;
  const members: Record<string, z.ZodType> = {};
  for (const [name, member] of Object.entries(argumentMembers(def))) {
    members[name] = referenced.has(name) ? StepReferenceSchema : member;
  }
  return z.strictObject(members);
}
