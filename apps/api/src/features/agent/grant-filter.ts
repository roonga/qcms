/**
 * The grant filter (section 6.1): the kinds offered in the propose tools' schemas, as
 * (kind, environment) pairs the route middleware's own evaluator allows. Every registered
 * kind is considered whatever screen the turn is on; execution remains the limit.
 */

import {
  decideAccess,
  isEnvironmentScoped,
  isFormScoped,
  type HeldGrant,
} from "../membership/policy.js";
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
  /** The form the screen names, which narrows a form-scoped cell to that subject. */
  readonly formId?: string | undefined;
}

/**
 * The form ids a form-scoped cell can be asked about when the screen names none: whatever
 * the caller's grants name, plus the wildcard. Such a cell asked with no form id is refused
 * outright, so the offer would otherwise be empty away from one form's own screen.
 */
function candidateForms(input: GrantFilterInput): readonly (string | undefined)[] {
  if (input.formId !== undefined) return [input.formId];
  const ids = new Set<string>(["all"]);
  for (const grant of input.grants) for (const id of grant.forms) ids.add(id);
  return [...ids];
}

function holds(input: GrantFilterInput, def: ActionKindDef, environment: string): boolean {
  for (const cell of [def.cell, ...(def.alsoCell === undefined ? [] : [def.alsoCell])]) {
    const formScoped = isFormScoped(cell.resource, cell.action);
    const subjects = formScoped ? candidateForms(input) : [undefined];
    const allowed = subjects.some(
      (formId) =>
        decideAccess({
          memberRole: input.memberRole,
          grants: input.grants,
          request: {
            resource: cell.resource,
            action: cell.action,
            ...(isEnvironmentScoped(cell.resource, cell.action) ? { environment } : {}),
            ...(formScoped && formId !== undefined ? { formId } : {}),
          },
        }).allowed,
    );
    if (!allowed) return false;
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
  for (const name of ACTION_KIND_NAMES) {
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

export function offeredEnvironments(
  offered: readonly OfferedActionKind[],
  kind: string,
): readonly string[] {
  return offered.find((entry) => entry.kind === kind)?.environments ?? [];
}
