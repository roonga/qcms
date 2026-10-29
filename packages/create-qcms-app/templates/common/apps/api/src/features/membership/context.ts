// Its own module so `openapi.ts` can type the request context without importing the
// middleware that sets it, which would be a cycle.

import type { RoutePolicy } from "./route-policy.js";

// The authorisation decision the middleware already made. A handler reads this rather
// than resolving a workspace or grant again, which would be a second chance to disagree.
export interface GrantContext {
  readonly policy: RoutePolicy;
  readonly workspaceId?: string;
  // For a `caller` row, the workspaces the caller holds this act in; narrowing a list
  // read to these is what keeps it from showing another group's forms.
  readonly workspaceIds?: readonly string[];
  readonly environment?: string;
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
