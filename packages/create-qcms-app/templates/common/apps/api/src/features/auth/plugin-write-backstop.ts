/**
 * Backstop only: the QCMS membership endpoints are the sanctioned grant write path (Q45),
 * so these hooks refuse rather than repair anything that reaches the plugin anyway.
 */

import {
  EMPTY_MEMBER_ROLE,
  isAccessRole,
  isTeamRole,
  listEnvironmentNames,
  refuseAccessGroupName,
  refuseEnvironmentScope,
} from "@roonga/qcms-db";
import type { Executor } from "@roonga/qcms-db";
import { APIError } from "better-auth/api";

/** Refuse, as the vendor's own error type so the library reports it rather than a 500. */
function refuse(rule: string, detail: string): never {
  throw new APIError("FORBIDDEN", {
    code: "GRANT_WRITE_REFUSED",
    message:
      `${detail} Grants are written only through the QCMS membership endpoints ` +
      `(ADR-41, Q45), which carry the validation and the SEC-15 audit row. ` +
      `Refused by the ${rule} rule.`,
  });
}

function readScope(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string") ? value : undefined;
}

function refuseRole(role: unknown, where: "team" | "member"): void {
  if (typeof role !== "string") refuse("role", `A ${where} needs a role.`);
  if (where === "member") {
    // `forms.owner` is allowed because the plugin's own `createOrganization` writes it.
    if (role === EMPTY_MEMBER_ROLE || role === "forms.owner") return;
    refuse(
      "role",
      `"${role}" is not a role a member row carries: a member row is \`forms.owner\` or the empty \`${EMPTY_MEMBER_ROLE}\` role.`,
    );
  }
  if (!isAccessRole(role)) {
    refuse("role", `"${role}" is not one of the six roles ADR-41 declares.`);
  }
  if (!isTeamRole(role)) {
    // A team carrying a non-team role would be a grant nothing reads.
    refuse(
      "non-team target",
      `"${role}" is not carried by an access group: it is the member row's role.`,
    );
  }
}

interface TeamPayload {
  readonly name?: unknown;
  readonly organizationId?: unknown;
  readonly role?: unknown;
  readonly environments?: unknown;
  readonly forms?: unknown;
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

  refuseRole(team.role, "team");

  const environments = readScope(team.environments);
  if (environments === undefined) {
    refuse("scope", "An access group needs an environment scope: `all`, or a set of names.");
  }
  const forms = readScope(team.forms);
  if (forms === undefined) {
    refuse("scope", "An access group needs a form scope: `all`, or a list of form ids.");
  }

  // Read the live set from the table, not a constant: an operator can create environments.
  const live = await listEnvironmentNames(exec);
  const scopeRefusal = refuseEnvironmentScope(environments, live);
  if (scopeRefusal !== undefined) refuse("scope", `${scopeRefusal}.`);

  // The fields are authoritative and the name only labels them, so a mismatch is invalid
  // input rather than a permission question (Q37 rule 1).
  if (typeof team.name !== "string") refuse("name", "An access group needs a name.");
  const nameRefusal = refuseAccessGroupName(
    team.name,
    { role: team.role as string, environments, ...labelOf(team.name) },
    live,
  );
  if (nameRefusal !== undefined) refuse("name", `${nameRefusal}.`);
}

/** The only place a group name is parsed, and it is not on an authorisation path (Q37 rule 2). */
function labelOf(name: string): { readonly label?: string } {
  const segments = name.split(".");
  if (segments.length <= 3) return {};
  return { label: segments.slice(3).join(".") };
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
      refuseRole(member.role, "member");
      return Promise.resolve();
    },
  };
}
