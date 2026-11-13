/**
 * Backstop only: the QCMS membership endpoints are the sanctioned grant write path (Q45),
 * so these hooks refuse rather than repair anything that reaches the plugin anyway.
 */

import {
  EMPTY_MEMBER_ROLE,
  OWNER_MEMBER_ROLE,
  listEnvironmentNames,
  refuseAccessGroupName,
  refuseAccessGroupRoles,
  refuseEnvironmentSet,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { APIError } from "better-auth/api";

/** Refuse, as the vendor's own error type so the library reports it rather than a 500. */
function refuse(rule: string, detail: string): never {
  throw new APIError("FORBIDDEN", {
    code: "GRANT_WRITE_REFUSED",
    message:
      `${detail} Grants are written only through the QCMS membership endpoints, ` +
      `which carry the validation and the SEC-15 audit row. ` +
      `Refused by the ${rule} rule.`,
  });
}

function readScope(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string") ? value : undefined;
}

function refuseMemberRole(role: unknown): void {
  if (typeof role !== "string") refuse("role", "A member needs a role.");
  // The Workspace administrator flag is allowed because the plugin's own
  // `createOrganization` writes it.
  if (role === EMPTY_MEMBER_ROLE || role === OWNER_MEMBER_ROLE) return;
  refuse(
    "role",
    `"${role}" is not a role a member row carries: a member row is \`${OWNER_MEMBER_ROLE}\` or the empty \`${EMPTY_MEMBER_ROLE}\` role.`,
  );
}

interface TeamPayload {
  readonly name?: unknown;
  readonly organizationId?: unknown;
  readonly roles?: unknown;
  readonly environments?: unknown;
  readonly externalGroupId?: unknown;
}

interface OrganizationPayload {
  readonly id?: unknown;
  readonly archivedAt?: unknown;
}

async function refuseTeamWrite(
  exec: Executor,
  team: TeamPayload,
  organization: OrganizationPayload,
): Promise<void> {
  // `externalGroupId` is the directory sync path's alone (Q39); the plugin's `input: false`
  // drops a falsy value silently, so refuse it here too.
  if (team.externalGroupId !== undefined && team.externalGroupId !== null) {
    refuse(
      "externalGroupId",
      "`externalGroupId` is the directory mapping's key and is written only by the sync path.",
    );
  }

  // An archive is terminal, so a grant written into one would be unusable (Q15).
  if (organization.archivedAt !== undefined && organization.archivedAt !== null) {
    refuse("archived workspace", "That workspace is archived, so nothing new is created in it.");
  }

  const groupRoles = readScope(team.roles);
  if (groupRoles === undefined) {
    refuse("role", "An access group needs a set of roles.");
  }
  const rolesRefusal = refuseAccessGroupRoles(groupRoles);
  if (rolesRefusal !== undefined) refuse("role", `${rolesRefusal}.`);

  const environments = readScope(team.environments);
  if (environments === undefined) {
    refuse("scope", "An access group needs an environment set, empty or a set of names.");
  }

  // Read the live set from the table, not a constant: an operator can create environments.
  const live = await listEnvironmentNames(exec);
  const setRefusal = refuseEnvironmentSet(environments, groupRoles, live);
  if (setRefusal !== undefined) refuse("scope", `${setRefusal}.`);

  if (typeof team.name !== "string") refuse("name", "An access group needs a name.");
  const nameRefusal = refuseAccessGroupName(team.name);
  if (nameRefusal !== undefined) refuse("name", `${nameRefusal}.`);
}

/** Loose payload types: the vendor's hook payloads are `Record<string, any>`. */
export function pluginWriteBackstop(exec: Executor): {
  beforeCreateTeam: (data: {
    team: Record<string, unknown>;
    organization: Record<string, unknown>;
  }) => Promise<void>;
  beforeUpdateTeam: (data: {
    team: Record<string, unknown>;
    updates: Record<string, unknown>;
    organization: Record<string, unknown>;
  }) => Promise<void>;
  beforeAddTeamMember: (data: {
    team: Record<string, unknown>;
    organization: Record<string, unknown>;
  }) => Promise<void>;
  beforeAddMember: (data: {
    member: Record<string, unknown>;
    organization: Record<string, unknown>;
  }) => Promise<void>;
} {
  return {
    beforeCreateTeam: async ({ team, organization }) => {
      await refuseTeamWrite(exec, team, organization);
    },
    beforeUpdateTeam: async ({ team, updates, organization }) => {
      // The merged row has to be legal, not the patch: a rename must match the stored scope.
      await refuseTeamWrite(exec, { ...team, ...updates }, organization);
    },
    beforeAddTeamMember: async ({ team, organization }) => {
      // Adding a holder is itself the grant (Q32), so the team must be a legal one.
      await refuseTeamWrite(exec, team, organization);
    },
    beforeAddMember: ({ member, organization }) => {
      if (organization.archivedAt !== undefined && organization.archivedAt !== null) {
        refuse("archived workspace", "That workspace is archived, so nobody is added to it.");
      }
      refuseMemberRole(member.role);
      return Promise.resolve();
    },
  };
}
