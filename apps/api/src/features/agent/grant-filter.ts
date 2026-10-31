/**
 * The grant filter (section 6.1). Before a turn starts, the action kinds offered in the
 * propose tools' schemas are filtered on **(kind, environment)** pairs, through the same
 * evaluator the route middleware uses.
 *
 * It is a courtesy that keeps proposals honest; the API's authorisation at execution is
 * the limit, and a kind the filter missed fails at its own route.
 */

import { decideAccess, isEnvironmentScoped, isFormScoped, type HeldGrant } from "../membership/policy.js";
import { ACTION_KIND_NAMES, actionKind } from "./actions/registry.js";
import type { ActionKindDef } from "./actions/types.js";

export interface OfferedActionKind {
  readonly kind: string;
  /**
   * For a switcher kind, the one environment the turn is on. For an argument kind, the
   * environments the caller holds the cell in, which is what narrows the argument's enum.
   */
  readonly environments: readonly string[];
}

export interface GrantFilterInput {
  readonly memberRole: string | undefined;
  readonly grants: readonly HeldGrant[];
  /** The live set, from the deployment's own configuration. */
  readonly environments: readonly string[];
  /** The environment the switcher named for this turn. */
  readonly current: string;
  /** The kinds to consider: usually every registered kind. */
  readonly kinds?: readonly string[];
  readonly formId?: string | undefined;
}

function holds(input: GrantFilterInput, def: ActionKindDef, environment: string): boolean {
  for (const cell of [def.cell, ...(def.alsoCell === undefined ? [] : [def.alsoCell])]) {
    const decision = decideAccess({
      memberRole: input.memberRole,
      grants: input.grants,
      request: {
        resource: cell.resource,
        action: cell.action,
        ...(isEnvironmentScoped(cell.resource, cell.action) ? { environment } : {}),
        ...(isFormScoped(cell.resource, cell.action) && input.formId !== undefined
          ? { formId: input.formId }
          : {}),
      },
    });
    if (!decision.allowed) return false;
  }
  return true;
}

/**
 * The offered kinds, each with the environments it may be proposed in. A kind the caller
 * holds in no environment is absent entirely rather than present with an empty list, so a
 * read-only caller's list is empty and the system prompt can say so.
 */
export function offeredActionKinds(input: GrantFilterInput): readonly OfferedActionKind[] {
  const offered: OfferedActionKind[] = [];
  for (const name of input.kinds ?? ACTION_KIND_NAMES) {
    const def = actionKind(name);
    if (def === undefined) continue;
    if (def.environmentFrom === "switcher") {
      if (holds(input, def, input.current)) {
        offered.push({ kind: name, environments: [input.current] });
      }
      continue;
    }
    const allowed = input.environments.filter((environment) => holds(input, def, environment));
    if (allowed.length > 0) offered.push({ kind: name, environments: allowed });
  }
  return offered;
}

export function offersNoAction(offered: readonly OfferedActionKind[]): boolean {
  return offered.length === 0;
}

/** The environments one offered kind may be proposed in, or none if it is not offered. */
export function offeredEnvironments(
  offered: readonly OfferedActionKind[],
  kind: string,
): readonly string[] {
  return offered.find((entry) => entry.kind === kind)?.environments ?? [];
}
