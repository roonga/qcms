import {
  accessDelta,
  newlyUncovered,
  type AccessDelta,
  type UncoveredScope,
} from "./access-patterns.ts";
import { GROUP_ROLES, needsEnvironments, setOf, type ScopedRoles } from "./access-group-form.ts";
import { grantOf } from "./people.ts";
import type { AccessGroup } from "./types.ts";

export const RESPONSE_ROLES: readonly string[] = ["responses.viewer", "responses.eraser"];

export interface GroupDraft {
  readonly name: string;
  readonly roles: readonly string[];
  readonly environments: readonly string[];
}

export type GroupPayload = GroupDraft;

export const EMPTY_DRAFT: GroupDraft = { name: "", roles: [], environments: [] };

export function draftOf(group: AccessGroup): GroupDraft {
  return { name: group.name, roles: group.roles, environments: group.environments };
}

/**
 * What a save sends: the roles in their own order, and only environments the administrator ticked
 * and the site has. A group whose roles ignore the set sends none, whatever was ticked before.
 */
export function groupPayload(draft: GroupDraft, environments: readonly string[]): GroupPayload {
  const roles = GROUP_ROLES.filter((role) => draft.roles.includes(role));
  return {
    name: draft.name.trim(),
    roles,
    environments: needsEnvironments(roles) ? setOf(draft.environments, environments) : [],
  };
}

export type DraftProblem = "name" | "roles" | "environments";

export function draftProblem(payload: GroupPayload): DraftProblem | undefined {
  if (payload.name === "") return "name";
  if (payload.roles.length === 0) return "roles";
  if (needsEnvironments(payload.roles) && payload.environments.length === 0) return "environments";
  return undefined;
}

/** Whether the change gives a response role, or a new environment for one, that the group did not carry. */
export function addsResponseAccess(before: ScopedRoles | undefined, after: ScopedRoles): boolean {
  return after.roles
    .filter((role) => RESPONSE_ROLES.includes(role))
    .some((role) => {
      if (before === undefined || !before.roles.includes(role)) return true;
      return after.environments.some((environment) => !before.environments.includes(environment));
    });
}

/** With Second approval on, a change that gives its own maker response access waits for an Approver. */
export function holdsForApproval(input: {
  readonly requireSecondApprover: boolean;
  readonly actorInGroup: boolean;
  readonly before: ScopedRoles | undefined;
  readonly after: ScopedRoles;
}): boolean {
  return (
    input.requireSecondApprover &&
    input.actorInGroup &&
    addsResponseAccess(input.before, input.after)
  );
}

/** What the people in a group gain and lose when it changes from `before` to `after`. */
export function groupChange(
  before: AccessGroup,
  after: GroupPayload,
  environments: readonly string[],
): AccessDelta {
  return accessDelta(
    [grantOf(before)],
    [{ ...grantOf(before), roles: after.roles, environments: after.environments }],
    environments,
  );
}

/** What deleting one group leaves covered by no group that some group covered before. */
export function uncoveredAfterDelete(
  groups: readonly AccessGroup[],
  teamId: string,
  environments: readonly string[],
): UncoveredScope {
  return newlyUncovered(
    groups.map(grantOf),
    groups.filter((group) => group.teamId !== teamId).map(grantOf),
    environments,
  );
}
