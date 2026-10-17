/**
 * The organisation plugin's before-hooks, as a backstop (Q45, Q37, Q38, Q39; task 069).
 *
 * # Why these are a backstop and not the mechanism
 *
 * Q45 makes the QCMS endpoints the **only** grant write path, and the plugin's own team
 * and member write endpoints are unreachable over HTTP: `features/auth/route.ts`'s
 * allowlist answers 404 for every path it does not name, and it names none of this
 * plugin's. So nothing arriving from a browser or a BFF reaches a hook here.
 *
 * What these catch is a call that reaches the plugin **anyway** - through a configuration
 * slip that widened the allowlist, or a library change that published a route, or an
 * in-process `auth.api.*` call somebody adds later. The rules are the same rules the QCMS
 * write path enforces (`features/membership/handler.ts`), stated a second time against a
 * second entrance: **two write paths, one rule set**.
 *
 * # One correction worth carrying, because an earlier draft had it wrong
 *
 * It was recorded that the plugin "fires no hook on its removal cascades". That is not
 * accurate at the pinned version: the **delete endpoints do fire their hooks**, and what
 * fires nothing is the **internal cascade** a delete runs underneath them, so a team
 * removed through the endpoint is visible to a hook while the `teamMember` rows that go
 * with it are not. Under Q45 the distinction is moot for the write path, because no
 * removal originates at a plugin endpoint at all - which is exactly why a removal has to
 * be audited where it is performed rather than where it is observed.
 *
 * # What a hook may and may not do
 *
 * It may refuse, by throwing. It may not fix: a hook that quietly normalised a name or
 * narrowed a scope would make the plugin a second sanctioned write path with its own
 * behaviour, and the whole point of Q45 is that there is one. So every rule below is a
 * refusal, and the message names the rule rather than the fix, because the fix is to use
 * the QCMS endpoint.
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

/** A value that should be a `string[]` scope, read off an untyped hook payload. */
function readScope(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string") ? value : undefined;
}

/** The six role names plus the empty `member` name, which is the only other legal role. */
function refuseRole(role: unknown, where: "team" | "member"): void {
  if (typeof role !== "string") refuse("role", `A ${where} needs a role.`);
  if (where === "member") {
    // The member row carries `forms.owner` or the empty `member` name, and nothing else
    // (Q32, finding G). The plugin's own `createOrganization` writes `forms.owner` for a
    // creator, which is why this is a set rather than a refusal of everything.
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
    // The two non-team targets: `forms.owner` is the member row's role, and the
    // installation claim is `user.role`. A team carrying either would be a grant in a
    // place nothing reads it from.
    refuse(
      "non-team target",
      `"${role}" is not carried by an access group: it is the member row's role.`,
    );
  }
}

/** The payload shape each hook hands over, as much of it as these rules read. */
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

/**
 * Validate a team write: the name against the fields, the scope against the live
 * environment set, the role against the six, and `externalGroupId` against being set at
 * all.
 */
async function refuseTeamWrite(
  exec: Executor,
  team: TeamPayload,
  organization: OrganizationPayload,
): Promise<void> {
  // `externalGroupId` is written **only** by the task C3 sync path (Q39). It is
  // `input: false` on the plugin's side, which drops a falsy value and throws on a truthy
  // one, so this is the belt on that brace and the one criterion 14 asserts directly.
  if (team.externalGroupId !== undefined && team.externalGroupId !== null) {
    refuse(
      "externalGroupId",
      "`externalGroupId` is the directory mapping's key and is written only by the sync path.",
    );
  }

  // The workspace is not archived (Q15). An archive is terminal and a grant written into
  // an archived workspace would be a grant on a workspace nothing can author in.
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

  // Every environment in the scope exists, and a combined set is in the environments
  // table's order (Q42). Read from `control.environments` rather than from a constant,
  // because the live set is a table and an operator may have created a third environment.
  const live = await listEnvironmentNames(exec);
  const scopeRefusal = refuseEnvironmentScope(environments, live);
  if (scopeRefusal !== undefined) refuse("scope", `${scopeRefusal}.`);

  // The name is in step with the fields (Q37 rule 1). The fields are authoritative and
  // the name is a label, so a mismatch is a validation error rather than a permission.
  if (typeof team.name !== "string") refuse("name", "An access group needs a name.");
  const nameRefusal = refuseAccessGroupName(
    team.name,
    { role: team.role as string, environments, ...labelOf(team.name) },
    live,
  );
  if (nameRefusal !== undefined) refuse("name", `${nameRefusal}.`);
}

/**
 * The label a stored name carries, read back off the name itself.
 *
 * The one place a name is parsed, and it is **not** on an authorisation path (Q37 rule
 * 2): what it decides is whether the name a caller sent is the name their own fields
 * imply, which is a validation question. If every name in the installation were wrong, no
 * access would change.
 */
function labelOf(name: string): { readonly label?: string } {
  const segments = name.split(".");
  if (segments.length <= 3) return {};
  return { label: segments.slice(3).join(".") };
}

/**
 * The hooks, bound to the control executor they read the live environment set and the
 * workspace's archive stamp through.
 *
 * Typed loosely on purpose: the vendor's payloads are `Record<string, any>` and these
 * rules read a handful of fields off them, so a narrow local shape is more honest than a
 * cast to a type the library does not promise.
 */
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
      // The merged row is what has to be legal, not the patch: an update naming only a
      // name has to be in step with the scope already stored, which is the mismatch
      // criterion 13 is about.
      await refuseTeamWrite(exec, { ...team, ...updates }, organization);
    },
    beforeAddTeamMember: async ({ team, organization }) => {
      // Adding a holder is the grant (Q32), so the team it is a grant of has to be a
      // legal one and the workspace has to be open. The holder themself is checked by
      // the QCMS write path, which also writes the `member` row finding G requires - a
      // row this hook cannot write, which is one more reason the plugin's endpoint is
      // not a sanctioned path.
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
