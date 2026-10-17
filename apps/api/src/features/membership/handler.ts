import type { RouteHandler } from "@hono/zod-openapi";
import {
  accessGroupDirectoryName,
  accessGroupFullName,
  addAccessGroupHolder,
  countWorkspaceOwners,
  createAccessGroup,
  deleteAccessGroup,
  EDITOR_ALL_SCOPE_NOTE,
  ensureWorkspaceMember,
  findUserByEmail,
  findUsersByIds,
  getAccessGroup,
  getWorkspace,
  holdsAccessGroup,
  isAccessGroupNameTaken,
  isResponsesRole,
  isScopeAll,
  listAccessAudit,
  listAccessGroupHolders,
  listAccessGroups,
  listEnvironmentNames,
  listGrantsForUser,
  listMemberWorkspacesForUser,
  listWorkspaceMembers,
  normaliseEnvironmentScope,
  readSeedNewEditorsWithTestData,
  refuseAccessGroupName,
  refuseEnvironmentScope,
  removeAccessGroupHolder,
  setMemberRole,
  setRequireSecondApprover,
  setSeedNewEditorsWithTestData,
  updateAccessGroupScope,
  writeAccessAuditRow,
  type AccessGroupRow,
  type Executor,
  type WorkspaceRow,
} from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { holdsInstallationClaim } from "./resolver.js";
import type {
  addHolderRoute,
  auditRoute,
  createAccessGroupRoute,
  deleteAccessGroupRoute,
  listAccessGroupsRoute,
  listMembersRoute,
  myAccessRoute,
  removeHolderRoute,
  setMemberRoleRoute,
  updateAccessGroupRoute,
  workspaceSettingsRoute,
} from "./route.js";

/**
 * The membership write path, and the only one there is (Q45; task 069).
 *
 * # Why these endpoints and not the plugin's
 *
 * The plugin's own team and member write endpoints are unreachable over HTTP (the auth
 * mount's allowlist names none of them) and are **not an owner path**. Two reasons the
 * earlier two-path shape could not answer:
 *
 *   - the QCMS endpoints are where the validation and the **SEC-15 rows** live, so a
 *     second path is a path on which a grant changes without an audit row; and
 *   - the plugin's **removal cascades** run inside the library, below any endpoint QCMS
 *     could gate, so the only way to be sure a removal is audited is for no removal to
 *     originate there.
 *
 * Every write below therefore writes its grant rows and its audit row **in one
 * transaction** on the control pool. A grant that changed while its audit row failed is
 * the one failure this control may not have, which is the same reasoning Q40 uses for a
 * response read one plane over.
 *
 * # The self-grant rule, and how "a second owner confirms" is spelled
 *
 * Q56: a self-grant of a `responses.*` role is **refused only while the workspace's
 * `requireSecondApprover` switch is on**, and then needs a second `forms.owner`, or the
 * installation administrator, to confirm; the installation administrator follows the same
 * rule; and with the switch **off** it is allowed and audited, which is what keeps a
 * one-account installation able to read its own responses.
 *
 * The confirmation is **one act by the other account**, which is the shape Q51 gives the
 * `prod` release rather than the shape it gives a `prod` endpoint change. So there is no
 * pending row and no second table: the self-grant is refused, the refusal says a
 * different owner has to make it, and that owner making it **is** the confirmation. A
 * stored-pending mechanism would be task 070's shape, and 070 is where the pending
 * mechanism belongs.
 */

const fail = {
  notFound: (): ApiError => new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace"),
  archived: (): ApiError =>
    new ApiError(
      "WORKSPACE_ARCHIVED",
      409,
      "That workspace is archived, so no grant is written in it",
    ),
  groupNotFound: (): ApiError =>
    new ApiError("ACCESS_GROUP_NOT_FOUND", 404, "No such access group in this workspace"),
  nameTaken: (name: string): ApiError =>
    new ApiError(
      "ACCESS_GROUP_NAME_TAKEN",
      409,
      `This workspace already has an access group called "${name}". Names are unique within a workspace; the same name in another workspace is fine.`,
    ),
  invalidName: (reason: string): ApiError => new ApiError("ACCESS_GROUP_NAME_INVALID", 400, reason),
  invalidScope: (reason: string): ApiError =>
    new ApiError("ACCESS_GROUP_SCOPE_INVALID", 400, reason),
  userNotFound: (): ApiError => new ApiError("USER_NOT_FOUND", 404, "No such account"),
  notAMember: (): ApiError =>
    new ApiError(
      "NOT_A_MEMBER",
      404,
      "That account has no member row in this workspace, so there is no role to set. Granting them an access group makes them a member.",
    ),
  alreadyHolds: (): ApiError =>
    new ApiError("ALREADY_GRANTED", 409, "That account already holds this access group"),
  notAHolder: (): ApiError =>
    new ApiError("NOT_GRANTED", 404, "That account does not hold this access group"),
  lastOwner: (): ApiError =>
    new ApiError(
      "LAST_OWNER",
      409,
      "This is the workspace's last `forms.owner`, and a workspace without one is a workspace nobody can administer. Make somebody else an owner first.",
    ),
  selfGrant: (): ApiError =>
    new ApiError(
      "SELF_GRANT_REFUSED",
      409,
      "This workspace requires a second approver, so you cannot grant yourself a " +
        "responses role: a second `forms.owner`, or the installation administrator, has " +
        "to make this grant. That is the same switch that governs the two-person rule " +
        "for a production release, and a grant on response data is a grant on personal " +
        "data.",
    ),
  noPrincipal: (): ApiError => new ApiError("unauthorized", 401, "Admin authentication required"),
} as const;

/** The caller, or a refusal. The admin-session gate guarantees one; this is the narrowing. */
function principalOf(c: { get: (key: "adminPrincipal") => unknown }): {
  readonly userId: string;
  readonly role: string;
} {
  const principal = c.get("adminPrincipal") as
    { readonly userId: string; readonly role: string } | undefined;
  if (principal === undefined) throw fail.noPrincipal();
  return principal;
}

/** The workspace the grant middleware already authorised the act in. */
async function workspaceOf(deps: Deps, id: string): Promise<WorkspaceRow> {
  const workspace = await getWorkspace(deps.databases.control, id);
  if (workspace === undefined) throw fail.notFound();
  return workspace;
}

/**
 * The audit row's `environment` and `form` on a grant, a revoke or a setting (Q61).
 *
 * **Empty unless the act names one.** A grant scoped to `prod` names an environment; one
 * scoped to `all`, or to two environments, names none that a single column could carry.
 * The scope itself is not lost - it moves to the row's `detail`.
 */
function scopeColumns(group: {
  readonly environments: readonly string[];
  readonly forms: readonly string[];
}): { environment?: string; formId?: string } {
  const environment =
    group.environments.length === 1 && !isScopeAll(group.environments)
      ? group.environments[0]
      : undefined;
  const formId = group.forms.length === 1 && !isScopeAll(group.forms) ? group.forms[0] : undefined;
  return {
    ...(environment === undefined ? {} : { environment }),
    ...(formId === undefined ? {} : { formId }),
  };
}

/** The scope, as the row's `detail` carries it: `all` or the list, for both dimensions. */
function scopeDetail(
  group: {
    readonly role: string;
    readonly environments: readonly string[];
    readonly forms: readonly string[];
  },
  extra?: string,
): string {
  const parts = [
    `role=${group.role}`,
    `environments=${group.environments.join(",")}`,
    `forms=${group.forms.join(",")}`,
  ];
  if (extra !== undefined) parts.push(extra);
  return parts.join(" ");
}

/** One access group as the API reports it, with its two derived names and its holders. */
async function groupView(
  exec: Executor,
  workspace: WorkspaceRow,
  group: AccessGroupRow,
): Promise<{
  teamId: string;
  name: string;
  fullName: string;
  directoryName: string;
  role: string;
  environments: string[];
  forms: string[];
  externalGroupId: string | null;
  holders: { userId: string; email: string }[];
}> {
  const holders = await listAccessGroupHolders(exec, group.teamId);
  return {
    teamId: group.teamId,
    name: group.name,
    // Derived on every read and stored nowhere, so a slug rename changes display only.
    fullName: accessGroupFullName(workspace.slug, group.name),
    directoryName: accessGroupDirectoryName(workspace.slug, group.name),
    role: group.role,
    environments: [...group.environments],
    forms: [...group.forms],
    externalGroupId: group.externalGroupId,
    holders: holders.map((holder) => ({ userId: holder.userId, email: holder.email })),
  };
}

/** Validate a name and a scope against the live environment set, or refuse. */
async function validateGroup(
  exec: Executor,
  input: {
    readonly name: string;
    readonly role: string;
    readonly environments: readonly string[];
    readonly forms: readonly string[];
    readonly label?: string | undefined;
  },
): Promise<{ readonly environments: readonly string[]; readonly forms: readonly string[] }> {
  const live = await listEnvironmentNames(exec);

  const scopeRefusal = refuseEnvironmentScope(input.environments, live);
  if (scopeRefusal !== undefined) throw fail.invalidScope(scopeRefusal);

  if (input.forms.includes("all") && input.forms.length > 1) {
    throw fail.invalidScope("`all` is the whole set, so it cannot be combined with a form id");
  }

  // Q42's ordering, both halves: the stored scope is normalised, and a NAME whose own
  // segment is out of order is refused by `refuseAccessGroupName` below. So `dev-test` is
  // the one spelling and `test-dev` is never a second grant.
  const environments = normaliseEnvironmentScope(input.environments, live);

  const nameRefusal = refuseAccessGroupName(
    input.name,
    {
      role: input.role,
      environments: input.environments,
      ...(input.label === undefined ? {} : { label: input.label }),
    },
    live,
  );
  if (nameRefusal !== undefined) throw fail.invalidName(nameRefusal);

  return { environments, forms: input.forms };
}

// --- GET /admin/me/access ---------------------------------------------------

/**
 * Every grant the caller holds, and nobody else's (Q35).
 *
 * The one admin route that needs no grant, because it **is** the answer to "what do I
 * hold": a check in front of it would be a check on the thing it exists to tell you. It
 * names no person, so there is no shape of this request that asks about somebody else.
 *
 * `environments` per workspace is what the Q6 switcher offers: **only the environments
 * the caller holds in some grant** (Q25), with `all` expanded against the live set so the
 * switcher has names to show rather than a token.
 */
export function makeMyAccessHandler(deps: Deps): RouteHandler<typeof myAccessRoute, ApiEnv> {
  return async (c) => {
    const principal = principalOf(c);
    const exec = deps.databases.control;
    const [memberships, grants, live] = await Promise.all([
      listMemberWorkspacesForUser(exec, principal.userId),
      listGrantsForUser(exec, principal.userId),
      listEnvironmentNames(exec),
    ]);

    const byWorkspace = new Map<
      string,
      {
        workspaceId: string;
        slug: string;
        name: string;
        archived: boolean;
        memberRole: string | null;
        grants: { name: string; role: string; environments: string[]; forms: string[] }[];
      }
    >();

    for (const membership of memberships) {
      byWorkspace.set(membership.workspaceId, {
        workspaceId: membership.workspaceId,
        slug: membership.slug,
        name: membership.name,
        archived: membership.archived,
        memberRole: membership.role,
        grants: [],
      });
    }
    for (const grant of grants) {
      const slot = byWorkspace.get(grant.workspaceId) ?? {
        workspaceId: grant.workspaceId,
        slug: grant.workspaceSlug,
        name: grant.workspaceName,
        archived: grant.workspaceArchived,
        memberRole: null,
        grants: [],
      };
      slot.grants.push({
        name: grant.name,
        role: grant.role,
        environments: [...grant.environments],
        forms: [...grant.forms],
      });
      byWorkspace.set(grant.workspaceId, slot);
    }

    return c.json(
      {
        userId: principal.userId,
        installationAdmin: holdsInstallationClaim(principal.role),
        workspaces: [...byWorkspace.values()].map((workspace) => ({
          ...workspace,
          environments: environmentsHeld(workspace.grants, live),
        })),
      },
      200,
    );
  };
}

/**
 * The environments a caller holds in some grant, which is what the Q6 switcher offers.
 *
 * `all` expands against the live set rather than being returned as a token, because the
 * switcher is a list of names and a client that had to expand `all` itself would be a
 * second place the live set is read.
 */
function environmentsHeld(
  grants: readonly { readonly environments: readonly string[] }[],
  live: readonly string[],
): string[] {
  const held = new Set<string>();
  for (const grant of grants) {
    if (isScopeAll(grant.environments)) {
      for (const name of live) held.add(name);
    } else {
      for (const name of grant.environments) held.add(name);
    }
  }
  return live.filter((name) => held.has(name));
}

// --- GET /admin/workspaces/:id/members --------------------------------------

/** The membership list: owners and the installation admin only (Q35). */
export function makeListMembersHandler(deps: Deps): RouteHandler<typeof listMembersRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const exec = deps.databases.control;
    await workspaceOf(deps, workspaceId);

    const [members, groups] = await Promise.all([
      listWorkspaceMembers(exec, workspaceId),
      listAccessGroups(exec, workspaceId),
    ]);

    // Which groups each member holds, so a reader sees the grants rather than only the
    // member rows: finding 17's point is that access is visible rather than inferred, and
    // a list of member rows alone would say nothing about what anybody may do.
    const byUser = new Map<string, string[]>();
    for (const group of groups) {
      for (const holder of await listAccessGroupHolders(exec, group.teamId)) {
        const held = byUser.get(holder.userId) ?? [];
        held.push(group.name);
        byUser.set(holder.userId, held);
      }
    }

    return c.json(
      {
        workspaceId,
        members: members.map((member) => ({
          userId: member.userId,
          email: member.email,
          name: member.name,
          role: member.role,
          groups: byUser.get(member.userId) ?? [],
        })),
      },
      200,
    );
  };
}

// --- PUT /admin/workspaces/:id/members/:userId ------------------------------

/**
 * Set a member row's role: `forms.owner`, or back to the empty role.
 *
 * The one grant that is not a team (Q32), so it is the one grant written here rather than
 * through an access group. Both directions write a SEC-15 row, because both change what
 * somebody may do: `forms.owner` is a grant and taking it away is a revoke.
 *
 * **It refuses the removal of a workspace's last owner.** A workspace with no
 * `forms.owner` is a workspace nobody can administer, and the repair would need the
 * installation claim - so the refusal names what to do instead rather than creating a
 * state only an operator can get out of.
 */
export function makeSetMemberRoleHandler(
  deps: Deps,
): RouteHandler<typeof setMemberRoleRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, userId } = c.req.valid("param");
    const { role } = c.req.valid("json");
    const actor = principalOf(c);
    const workspace = await workspaceOf(deps, workspaceId);
    if (workspace.archivedAt !== null) throw fail.archived();

    await deps.databases.control.transaction(async (tx) => {
      if (role === "member") {
        const owners = await countWorkspaceOwners(tx, workspaceId);
        const current = await listWorkspaceMembers(tx, workspaceId);
        const isOwner = current.some(
          (member) => member.userId === userId && member.role === "forms.owner",
        );
        if (isOwner && owners <= 1) throw fail.lastOwner();
      }

      const updated = await setMemberRole(tx, workspaceId, userId, role);
      if (updated === undefined) throw fail.notAMember();

      // Both directions are audited (Q56). `forms.owner` names no environment and no
      // form, so both columns are empty and the detail carries what changed (Q61).
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: role === "forms.owner" ? "grant" : "revoke",
        detail: `role=${role} subject=${userId} environments=all forms=all`,
        occurredAt: deps.clock.now(),
      });
    });

    return c.json({ userId, role }, 200);
  };
}

// --- GET /admin/workspaces/:id/access-groups --------------------------------

export function makeListAccessGroupsHandler(
  deps: Deps,
): RouteHandler<typeof listAccessGroupsRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const workspace = await workspaceOf(deps, workspaceId);
    const groups = await listAccessGroups(deps.databases.control, workspaceId);
    const views = [];
    for (const group of groups) {
      views.push(await groupView(deps.databases.control, workspace, group));
    }
    return c.json({ workspaceId, groups: views, scopeNote: EDITOR_ALL_SCOPE_NOTE }, 200);
  };
}

// --- POST /admin/workspaces/:id/access-groups -------------------------------

/**
 * Create an access group.
 *
 * **It writes no audit row**, and that is the right answer rather than an omission: a
 * group with no holders carries no grant, so there is nothing for a `grant` row to
 * record. The audit row is written when a holder is added, which is when team membership
 * becomes the grant (Q32).
 */
export function makeCreateAccessGroupHandler(
  deps: Deps,
): RouteHandler<typeof createAccessGroupRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const body = c.req.valid("json");
    const workspace = await workspaceOf(deps, workspaceId);
    if (workspace.archivedAt !== null) throw fail.archived();

    const exec = deps.databases.control;
    const scope = await validateGroup(exec, body);

    // Uniqueness within the workspace is the QCMS write path's, because the plugin does
    // not enforce it on team names (Q37 rule 4). The same name in another workspace is
    // accepted, which is what criterion 12 asserts on both halves.
    if (await isAccessGroupNameTaken(exec, workspaceId, body.name)) {
      throw fail.nameTaken(body.name);
    }

    const group = await createAccessGroup(exec, {
      workspaceId,
      name: body.name,
      role: body.role,
      environments: scope.environments,
      forms: scope.forms,
    });
    return c.json({ group: await groupView(exec, workspace, group) }, 201);
  };
}

// --- PUT /admin/workspaces/:id/access-groups/:teamId ------------------------

/**
 * Re-scope or rename an access group.
 *
 * The role is not changeable (see `queries/grants.ts`), so the body carries none. A
 * re-scope **does** change what every holder may do, so it writes one `grant` row per
 * holder: the act is a grant of the new scope, and a row per holder is what makes "who
 * made it possible" answerable per person rather than per group.
 */
export function makeUpdateAccessGroupHandler(
  deps: Deps,
): RouteHandler<typeof updateAccessGroupRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = principalOf(c);
    const workspace = await workspaceOf(deps, workspaceId);
    if (workspace.archivedAt !== null) throw fail.archived();

    const exec = deps.databases.control;
    const existing = await getAccessGroup(exec, teamId);
    if (existing === undefined || existing.workspaceId !== workspaceId) throw fail.groupNotFound();

    const scope = await validateGroup(exec, { ...body, role: existing.role });
    if (await isAccessGroupNameTaken(exec, workspaceId, body.name, teamId)) {
      throw fail.nameTaken(body.name);
    }

    const updated = await exec.transaction(async (tx) => {
      const row = await updateAccessGroupScope(tx, teamId, {
        name: body.name,
        environments: scope.environments,
        forms: scope.forms,
        updatedAt: deps.clock.now(),
      });
      if (row === undefined) throw fail.groupNotFound();

      for (const holder of await listAccessGroupHolders(tx, teamId)) {
        await writeAccessAuditRow(tx, {
          actor: actor.userId,
          workspaceId,
          kind: "grant",
          ...scopeColumns(row),
          detail: scopeDetail(row, `subject=${holder.userId} rescoped=${existing.name}`),
          occurredAt: deps.clock.now(),
        });
      }
      return row;
    });

    return c.json({ group: await groupView(exec, workspace, updated) }, 200);
  };
}

// --- DELETE /admin/workspaces/:id/access-groups/:teamId ---------------------

/**
 * Remove an access group, and with it every grant it carried.
 *
 * **This is the cascade Q45 is about.** `teamMember` references `team` with
 * `ON DELETE cascade`, so the holders' rows go with it - and the plugin's own delete
 * endpoint would run that cascade below any hook, leaving the removals invisible. Here
 * the cascade originates at a QCMS endpoint, so the holders are read **first** and one
 * `revoke` row is written per holder, in the same transaction as the delete.
 */
export function makeDeleteAccessGroupHandler(
  deps: Deps,
): RouteHandler<typeof deleteAccessGroupRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId } = c.req.valid("param");
    const actor = principalOf(c);
    await workspaceOf(deps, workspaceId);

    await deps.databases.control.transaction(async (tx) => {
      const group = await getAccessGroup(tx, teamId);
      if (group === undefined || group.workspaceId !== workspaceId) throw fail.groupNotFound();

      for (const holder of await listAccessGroupHolders(tx, teamId)) {
        await writeAccessAuditRow(tx, {
          actor: actor.userId,
          workspaceId,
          kind: "revoke",
          ...scopeColumns(group),
          detail: scopeDetail(group, `subject=${holder.userId} group=${group.name}`),
          occurredAt: deps.clock.now(),
        });
      }
      const removed = await deleteAccessGroup(tx, teamId);
      if (!removed) throw fail.groupNotFound();
    });

    return c.body(null, 204);
  };
}

// --- POST /admin/workspaces/:id/access-groups/:teamId/holders ---------------

/**
 * Grant an access group to somebody. **Team membership is the grant** (Q32).
 *
 * Three things happen in one transaction, and the order is the reasoning:
 *
 *   1. the self-grant rule (Q56) is applied, before anything is written;
 *   2. the holder gets a `member` row with the **empty** role if they have none (finding
 *      G), because the plugin's own team queries assume a team member is a member of the
 *      organisation the team belongs to;
 *   3. the `teamMember` row and its SEC-15 `grant` row are written together.
 */
export function makeAddHolderHandler(deps: Deps): RouteHandler<typeof addHolderRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = principalOf(c);
    const workspace = await workspaceOf(deps, workspaceId);
    if (workspace.archivedAt !== null) throw fail.archived();

    const exec = deps.databases.control;
    const group = await getAccessGroup(exec, teamId);
    if (group === undefined || group.workspaceId !== workspaceId) throw fail.groupNotFound();

    const subject =
      body.userId !== undefined
        ? (await findUsersByIds(exec, [body.userId]))[0]
        : await findUserByEmail(exec, body.email as string);
    if (subject === undefined) throw fail.userNotFound();

    // Q56. The rule reaches the installation administrator on the same terms, so the
    // claim is not a way around it: the test is "is this account granting itself a
    // responses role", not "is this account an owner".
    if (
      subject.userId === actor.userId &&
      isResponsesRole(group.role) &&
      workspace.requireSecondApprover
    ) {
      throw fail.selfGrant();
    }

    await exec.transaction(async (tx) => {
      if (await holdsAccessGroup(tx, teamId, subject.userId)) throw fail.alreadyHolds();
      await ensureWorkspaceMember(tx, workspaceId, subject.userId);
      await addAccessGroupHolder(tx, teamId, subject.userId);
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "grant",
        ...scopeColumns(group),
        detail: scopeDetail(group, `subject=${subject.userId} group=${group.name}`),
        occurredAt: deps.clock.now(),
      });
    });

    return c.json({ group: await groupView(exec, workspace, group) }, 201);
  };
}

// --- DELETE /admin/workspaces/:id/access-groups/:teamId/holders/:userId -----

/** Revoke one grant. One `teamMember` row and one SEC-15 `revoke` row, together (Q56). */
export function makeRemoveHolderHandler(
  deps: Deps,
): RouteHandler<typeof removeHolderRoute, ApiEnv> {
  return async (c) => {
    const { id: workspaceId, teamId, userId } = c.req.valid("param");
    const actor = principalOf(c);
    await workspaceOf(deps, workspaceId);

    await deps.databases.control.transaction(async (tx) => {
      const group = await getAccessGroup(tx, teamId);
      if (group === undefined || group.workspaceId !== workspaceId) throw fail.groupNotFound();
      const removed = await removeAccessGroupHolder(tx, teamId, userId);
      if (!removed) throw fail.notAHolder();
      await writeAccessAuditRow(tx, {
        actor: actor.userId,
        workspaceId,
        kind: "revoke",
        ...scopeColumns(group),
        detail: scopeDetail(group, `subject=${userId} group=${group.name}`),
        occurredAt: deps.clock.now(),
      });
    });

    return c.body(null, 204);
  };
}

// --- PUT /admin/workspaces/:id/settings -------------------------------------

/**
 * The two per-workspace switches, and the `setting` audit row turning one on writes.
 *
 * Q57 with Q61: turning `seedNewEditorsWithTestData` on is an owner's **deliberate act**
 * on personal data, and it writes a row of kind `setting` with `environment` and `form`
 * empty and the setting's name and its new value in the detail. The two-person switch is
 * audited the same way, because it governs both the self-grant rule here and task 070's
 * two-person rule at a `prod` release: turning it off is the act somebody would want to
 * find afterwards.
 *
 * **A write that changes nothing writes no row.** An audit full of rows recording that
 * somebody set a setting to the value it already had is an audit nobody reads.
 */
export function makeWorkspaceSettingsHandler(
  deps: Deps,
): RouteHandler<typeof workspaceSettingsRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const body = c.req.valid("json");
    const actor = principalOf(c);
    const workspace = await workspaceOf(deps, workspaceId);

    const result = await deps.databases.control.transaction(async (tx) => {
      let requireSecondApprover = workspace.requireSecondApprover;
      let seedNewEditors = (await readSeedNewEditorsWithTestData(tx, workspaceId)) ?? false;

      if (
        body.seedNewEditorsWithTestData !== undefined &&
        body.seedNewEditorsWithTestData !== seedNewEditors
      ) {
        const value = await setSeedNewEditorsWithTestData(
          tx,
          workspaceId,
          body.seedNewEditorsWithTestData,
        );
        if (value === undefined) throw fail.notFound();
        seedNewEditors = value;
        await writeAccessAuditRow(tx, {
          actor: actor.userId,
          workspaceId,
          kind: "setting",
          detail: `setting=seedNewEditorsWithTestData value=${String(value)}`,
          occurredAt: deps.clock.now(),
        });
      }

      if (
        body.requireSecondApprover !== undefined &&
        body.requireSecondApprover !== requireSecondApprover
      ) {
        const value = await setRequireSecondApprover(tx, workspaceId, body.requireSecondApprover);
        if (value === undefined) throw fail.notFound();
        requireSecondApprover = value;
        await writeAccessAuditRow(tx, {
          actor: actor.userId,
          workspaceId,
          kind: "setting",
          detail: `setting=requireSecondApprover value=${String(value)}`,
          occurredAt: deps.clock.now(),
        });
      }

      return { requireSecondApprover, seedNewEditorsWithTestData: seedNewEditors };
    });

    return c.json({ workspaceId, ...result }, 200);
  };
}

// --- GET /admin/workspaces/:id/audit ----------------------------------------

/**
 * The access audit, for this workspace (SEC-15).
 *
 * Readable by the workspace's **owners** and by the **installation administrator**, and
 * by nobody else - that readership is the point, because an audit only the operator can
 * see does not answer a department's own question about its own data. The grant
 * middleware is what enforces it (`audit: read` is on `forms.owner` alone).
 *
 * The actor's address is resolved for display and is **not** a foreign key: the row
 * carries an account id it deliberately does not reference, so an account that has since
 * been removed shows as an id with no address rather than making the row disappear.
 */
export function makeAuditHandler(deps: Deps): RouteHandler<typeof auditRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const query = c.req.valid("query");
    await workspaceOf(deps, workspaceId);

    const page = query.page === undefined ? 1 : Number(query.page);
    const pageSize = query.pageSize === undefined ? 50 : Math.min(Number(query.pageSize), 200);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
      throw new ApiError("INVALID_QUERY", 400, "page and pageSize must be positive integers");
    }

    const exec = deps.databases.control;
    const { rows, total } = await listAccessAudit(exec, workspaceId, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...(query.kind === undefined ? {} : { kind: query.kind }),
    });

    const actors = await findUsersByIds(exec, [...new Set(rows.map((row) => row.actor))]);
    const addresses = new Map(actors.map((actor) => [actor.userId, actor.email]));

    return c.json(
      {
        workspaceId,
        rows: rows.map((row) => ({
          id: row.id,
          actor: row.actor,
          actorEmail: addresses.get(row.actor) ?? null,
          environment: row.environment,
          formId: row.formId,
          kind: row.kind,
          occurredAt: row.occurredAt.toISOString(),
          detail: row.detail,
        })),
        page,
        pageSize,
        total,
      },
      200,
    );
  };
}
