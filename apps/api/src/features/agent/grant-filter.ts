/**
 * The grant filter (section 6.1): the kinds offered in the propose tool's schema, as
 * (kind, environment) pairs the route middleware's own evaluator allows. Every registered
 * kind is considered whatever screen the turn is on; execution remains the limit.
 */

import { decideAccess, isEnvironmentScoped, type HeldGrant } from "../membership/policy.js";
import { ACTION_KIND_NAMES, BUILDER_ACTION_KINDS, actionKind } from "./actions/registry.js";
import { BUILDER_SCREEN } from "./edit-token.js";
import type { ActionKindDef, ActionKindFlag } from "./actions/types.js";

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
   * The screen the turn is on. It decides two things: a `local` kind, which is run by the
   * screen's own client-side write path and so exists only where that screen is, and the agent
   * builder's narrower set. Every other kind is decided by the caller's grants alone.
   */
  readonly screen?: string | undefined;
  /**
   * The deployment flags that are on. A kind naming a flag absent here is offered to nobody,
   * so a deployment with the act turned off never has a card proposed for it. Nothing is on by
   * default: a caller that states no flags withholds every flagged kind.
   */
  readonly enabledFlags?: readonly ActionKindFlag[] | undefined;
}

/** The kind flags a deployment configuration turns on. */
export function enabledActionKindFlags(flags: {
  readonly themeDerive: "off" | "on";
}): readonly ActionKindFlag[] {
  return flags.themeDerive === "on" ? ["themeDerive"] : [];
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

function flagOffers(def: ActionKindDef, enabled: readonly ActionKindFlag[] | undefined): boolean {
  return def.flag === undefined || (enabled ?? []).includes(def.flag);
}

/**
 * A local kind reaches no route, so only its own screen may offer it. The agent builder edits
 * its draft without a card and publishes through the wizard, so it offers the library writes
 * alone.
 */
function screenOffers(def: ActionKindDef, screen: string | undefined): boolean {
  if (def.local === true && def.screen !== screen) return false;
  // A kind whose own screen is the builder exists only there: its card finishes in the
  // appearance drawer, which no other screen mounts.
  if (def.screen === BUILDER_SCREEN && screen !== BUILDER_SCREEN) return false;
  return screen !== BUILDER_SCREEN || BUILDER_ACTION_KINDS.includes(def.kind);
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
    if (def === undefined || !screenOffers(def, input.screen)) continue;
    if (!flagOffers(def, input.enabledFlags)) continue;
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

/**
 * The union across the caller's workspaces: a kind held in one of them is offered. The order is
 * the registry's and each kind's environments are sorted, because this list is what the propose
 * tools advertise, and a schema that reorders itself between turns is cached nowhere.
 */
export function mergeOffers(
  offers: readonly (readonly OfferedActionKind[])[],
): readonly OfferedActionKind[] {
  const byKind = new Map<string, Set<string>>();
  for (const offer of offers) {
    for (const entry of offer) {
      const environments = byKind.get(entry.kind) ?? new Set<string>();
      for (const environment of entry.environments) environments.add(environment);
      byKind.set(entry.kind, environments);
    }
  }
  return ACTION_KIND_NAMES.flatMap((kind) => {
    const environments = byKind.get(kind);
    return environments === undefined ? [] : [{ kind, environments: [...environments].sort() }];
  });
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
