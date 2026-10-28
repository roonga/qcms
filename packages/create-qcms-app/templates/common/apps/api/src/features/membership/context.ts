/**
 * The grant decision as it reaches a handler (ADR-41, SEC-3; task 069).
 *
 * Its own module so `openapi.ts` can type the request context without importing the
 * middleware that sets it, which would be a cycle: the middleware needs `ApiEnv` and
 * `ApiEnv` needs this.
 */

import type { HeldGrant } from "./policy.js";
import type { RoutePolicy } from "./route-policy.js";

/**
 * What a caller holds in one workspace, as the context carries it.
 *
 * Structurally the resolver's own `ResolvedMembership`, restated here for the reason this
 * module exists at all: `openapi.ts` types the request context from it and the resolver
 * imports the database package, so importing that type would put a database import in
 * every module that reads a request.
 */
export interface ResolvedMembership {
  readonly workspaceId: string;
  readonly memberRole: string | undefined;
  readonly grants: readonly HeldGrant[];
}

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
  /**
   * For an `anyOf` row, what the caller holds in each of those workspaces (Q87).
   *
   * The handler asks {@link decideAccess} per (form, cell, environment) against these,
   * because an `anyOf` row's cells carry scopes the middleware cannot judge without a row
   * in hand: `response: read` is form-scoped and the route names no form. Carried here
   * rather than re-read, so one resolution decides the route and its projection - a
   * second read is a second chance to disagree with the first.
   */
  readonly memberships?: readonly ResolvedMembership[];
  /** The environment the act names, where it names one. */
  readonly environment?: string;
  /** The role that allowed the act, for the audit row's detail and for a log line. */
  readonly role?: string;
  /**
   * How much of a webhook endpoint's URL this caller is shown (Q58, task 067): `"whole"`
   * for a `forms.editor` and above, `"masked"` for a `forms.viewer`.
   *
   * # Why it is decided here and applied in the handler
   *
   * Q58 says **the API does the masking, in the response**, never the admin's rendering,
   * so a second client of the same route cannot see round it. That splits the work in the
   * one way this codebase already splits every other authorisation question: the
   * **middleware** decides, because it is the layer that has the caller's grants in hand
   * and the layer a handler cannot skip, and the **handler** applies it, because it is
   * what builds the response body. A handler that resolved the caller's grants a second
   * time would be a second chance to disagree, which is the thing this context exists to
   * prevent.
   *
   * Set only on the rows where there is a URL to show, so an absent value is not a
   * default meaning "whole": the one handler that reads it treats anything other than
   * `"whole"` as masked, which is the fail-closed direction.
   */
  readonly endpointUrl?: "whole" | "masked";
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
