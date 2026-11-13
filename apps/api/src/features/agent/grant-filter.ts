/**
 * The grant filter (section 6.1): the kinds offered in the propose tools' schemas, as
 * (kind, environment) pairs the route middleware's own evaluator allows. Every registered
 * kind is considered whatever screen the turn is on; execution remains the limit.
 */

import { decideAccess, isEnvironmentScoped, type HeldGrant } from "../membership/policy.js";
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
  /**
   * The screen the turn is on. The one thing it decides is a `local` kind: that step is run
   * by the screen's own client-side write path, so it exists only where that screen is.
   * Every other kind is decided by the caller's grants alone.
   */
  readonly screen?: string | undefined;
}

function holds(input: GrantFilterInput, def: ActionKindDef, environment: string): boolean {
  for (const cell of [def.cell, ...(def.alsoCells ?? [])]) {
    const allowed = decideAccess({
      memberRole: input.memberRole,
      grants: input.grants,
      request: {
        resource: cell.resource,
        action: cell.action,
        ...(isEnvironmentScoped(cell.resource, cell.action) ? { environment } : {}),
      },
    }).allowed;
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
    // A local kind reaches no route: only its own screen can run it, so only its own
    // screen may offer it.
    if (def.local === true && def.screen !== input.screen) continue;
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
