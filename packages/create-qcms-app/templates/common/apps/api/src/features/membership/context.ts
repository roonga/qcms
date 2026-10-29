// Its own module so `openapi.ts` can type the request context without importing the
// middleware that sets it, which would be a cycle.

import type { HeldGrant } from "./policy.js";
import type { RoutePolicy } from "./route-policy.js";

/**
 * What a caller holds in one workspace. Declared here rather than in the resolver so the
 * request context can carry it without pulling a database import into every reader.
 */
export interface ResolvedMembership {
  readonly workspaceId: string;
  readonly memberRole: string | undefined;
  readonly grants: readonly HeldGrant[];
}

// The authorisation decision the middleware already made. A handler reads this rather
// than resolving a workspace or grant again, which would be a second chance to disagree.
export interface GrantContext {
  readonly policy: RoutePolicy;
  readonly workspaceId?: string;
  // For a `caller` row, the workspaces the caller holds this act in; narrowing a list
  // read to these is what keeps it from showing another group's forms.
  readonly workspaceIds?: readonly string[];
  // For an `anyOf` row, what the caller holds in each of those workspaces, so the handler
  // can decide per form and cell without a second resolution.
  readonly memberships?: readonly ResolvedMembership[];
  readonly environment?: string;
  // For an `environmentFrom: "targets"` row, the destinations the gate authorised, in the
  // order the body listed them.
  readonly environments?: readonly string[];
  readonly role?: string;
  // Absent is not a default meaning `"whole"`: the handler treats anything but `"whole"`
  // as masked, which is the fail-closed direction.
  readonly endpointUrl?: "whole" | "masked";
}

// An unset `workspaceIds` means no filter, so installation-wide reads and operator CLIs
// still see the whole table.
export function workspaceFilterFor(grant: GrantContext | undefined): {
  workspaceIds?: readonly string[];
} {
  if (grant?.workspaceIds === undefined) return {};
  return { workspaceIds: grant.workspaceIds };
}
