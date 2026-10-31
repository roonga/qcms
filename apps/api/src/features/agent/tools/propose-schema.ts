/**
 * The propose tools' advertised schemas, built per caller from what the grant filter
 * offered (section 6.1). An argument kind's environment member is narrowed to the
 * environments the caller holds the cell in, so an editor without `prod` in scope is shown
 * a release kind whose environment enum has no `prod`. The narrowing is a courtesy that
 * keeps proposals honest; the API's authorisation at execution is the limit.
 */

import { z } from "zod";

import { actionKind } from "../actions/registry.js";
import type { ActionKindDef } from "../actions/types.js";
import type { OfferedActionKind } from "../grant-filter.js";
import { MAX_PLAN_STEPS } from "./propose.js";

const StepReferenceSchema = z
  .strictObject({
    fromStep: z.number().int().min(0).describe("The zero-based index of an earlier step."),
    field: z.string().min(1).max(100).describe("A result field that step returns."),
  })
  .describe("A reference to an earlier step's result, resolved when the plan runs.");

function isOptional(member: z.ZodType): boolean {
  return member.safeParse(undefined).success;
}

function environmentMember(
  def: ActionKindDef,
  name: string,
  environments: readonly string[],
): z.ZodType | undefined {
  if (def.environmentFrom !== "argument") return undefined;
  if (name !== (def.environmentArgument ?? "environment")) return undefined;
  if (environments.length === 0) return undefined;
  return z.enum([...environments] as [string, ...string[]]);
}

/**
 * One kind's arguments as the model is shown them: every member may instead be a symbolic
 * reference, because the propose tool lifts a reference out before the kind's own schema
 * runs.
 */
function advertisedArgs(def: ActionKindDef, environments: readonly string[]): z.ZodType {
  const shape = (def.args as unknown as { readonly shape: Record<string, z.ZodType> }).shape;
  const members: Record<string, z.ZodType> = {};
  for (const [name, member] of Object.entries(shape)) {
    const narrowed = environmentMember(def, name, environments) ?? member;
    const union = z.union([narrowed, StepReferenceSchema]);
    members[name] = isOptional(member) ? union.optional() : union;
  }
  return z.strictObject(members);
}

/** One offered kind as a step the model may name, or nothing when it is not offered. */
function stepMember(entry: OfferedActionKind): z.ZodType | undefined {
  const def = actionKind(entry.kind);
  if (def === undefined) return undefined;
  return z
    .strictObject({
      kind: z.literal(def.kind),
      args: advertisedArgs(def, entry.environments),
    })
    .describe(def.description);
}

/**
 * The step union for this caller. `undefined` means nothing is offered, which is what
 * leaves the propose tools out of the turn's tool set entirely.
 */
export function proposedStepSchema(
  offered: readonly OfferedActionKind[],
): z.ZodType | undefined {
  const members = offered
    .map((entry) => stepMember(entry))
    .filter((member): member is z.ZodType => member !== undefined);
  const [first, ...rest] = members;
  if (first === undefined) return undefined;
  return rest.length === 0 ? first : z.union([first, ...rest]);
}

export function proposeActionSchema(offered: readonly OfferedActionKind[]): z.ZodType {
  const step = proposedStepSchema(offered);
  // An empty object, so a screen that offers nothing still has a parseable schema; the
  // tool is not in the turn's tool set, so no call reaches it.
  if (step === undefined) return z.strictObject({});
  return z.strictObject({ action: step });
}

export function proposePlanSchema(offered: readonly OfferedActionKind[]): z.ZodType {
  const step = proposedStepSchema(offered);
  if (step === undefined) return z.strictObject({});
  return z.strictObject({
    steps: z
      .array(step)
      .min(1)
      .max(MAX_PLAN_STEPS)
      .describe("The steps in the order they run. One plan, one Confirm."),
  });
}
