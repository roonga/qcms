/**
 * The grant decision as it reaches a handler (ADR-41, SEC-3; task 069).
 *
 * Its own module so `openapi.ts` can type the request context without importing the
 * middleware that sets it, which would be a cycle: the middleware needs `ApiEnv` and
 * `ApiEnv` needs this.
 */

import type { RoutePolicy } from "./route-policy.js";

/**
 * What the middleware leaves on the request for the handler that runs after it.
 *
 * A handler reads this rather than resolving a workspace or a grant again: the act has
 * already been authorised, and a second resolution is a second chance to disagree.
 */
export interface GrantContext {
  /** The row the request matched. */
  readonly policy: RoutePolicy;
  /** The workspace the act is in, for the rows that have one. */
  readonly workspaceId?: string;
  /**
   * For a `caller` row, the workspaces the caller holds this act in. The handler narrows
   * its read to these, which is what keeps a library list from showing another group's
   * forms.
   */
  readonly workspaceIds?: readonly string[];
  /** The environment the act names, where it names one. */
  readonly environment?: string;
  /** The role that allowed the act, for the audit row's detail and for a log line. */
  readonly role?: string;
}

/**
 * The workspaces a library list narrows to, or nothing for a caller who reaches every
 * workspace (ADR-41, task 069).
 *
 * A `caller` row's middleware resolved the set before the handler ran, so the list cannot
 * show a row an act on that row would be refused for - which is the confidentiality
 * boundary ADR-41 draws between two groups sharing one installation. A row that is not a
 * `caller` row leaves `workspaceIds` unset, and the filter is then absent: the
 * installation-wide reads and the operator CLIs see the whole table, as they always have.
 */
export function workspaceFilterFor(grant: GrantContext | undefined): {
  workspaceIds?: readonly string[];
} {
  if (grant?.workspaceIds === undefined) return {};
  return { workspaceIds: grant.workspaceIds };
}
