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

// The only membership write path: the auth plugin's own team and member endpoints are
// kept off the HTTP allowlist, because its removal cascades run below any endpoint QCMS
// could gate and would change grants with no audit row. Every write here therefore writes
// its grant rows and its SEC-15 audit row in one transaction on the control pool.

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

function principalOf(c: { get: (key: "adminPrincipal") => unknown }): {
  readonly userId: string;
  readonly role: string;
} {
  const principal = c.get("adminPrincipal") as
    { readonly userId: string; readonly role: string } | undefined;
  if (principal === undefined) throw fail.noPrincipal();
  return principal;
}

async function workspaceOf(deps: Deps, id: string): Promise<WorkspaceRow> {
  const workspace = await getWorkspace(deps.databases.control, id);
  if (workspace === undefined) throw fail.notFound();
  return workspace;
}

// Empty unless the act names exactly one; a wider scope is not lost, it moves to the
// audit row's `detail`.
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

  // Normalised here and the name's own ordering refused below, so `dev-test` is the one
  // spelling and `test-dev` is never a second grant.
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

// Grant-exempt, and safe to be: it names no person, so no shape of this request asks
// about anybody but the caller.
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

// `all` is expanded here rather than returned as a token, so a client is not a second
// place the live environment set is read.
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

export function makeListMembersHandler(deps: Deps): RouteHandler<typeof listMembersRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const exec = deps.databases.control;
    await workspaceOf(deps, workspaceId);

    const [members, groups] = await Promise.all([
      listWorkspaceMembers(exec, workspaceId),
      listAccessGroups(exec, workspaceId),
    ]);

    // The groups each member holds, so access is visible in the list rather than
    // inferred from a member row.
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

// Refuses removal of a workspace's last owner: nobody could then administer it, and the
// repair would need the installation claim.
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

      // Both directions are audited: granting ownership and taking it away each change
      // what somebody may do.
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

// No audit row: a group with no holders carries no grant. The row is written when a
// holder is added, which is when the grant exists.
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

    // Enforced here because the auth plugin does not enforce uniqueness on team names.
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

// The role is not changeable, so the body carries none. A re-scope writes one `grant` row
// per holder, so "who made this possible" stays answerable per person.
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

// `teamMember` cascades on `team` delete, so the holders must be read before the delete
// and one `revoke` row written per holder in the same transaction, or the removals are
// invisible.
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

// Team membership is the grant. The holder also needs a `member` row with the empty role,
// because the auth plugin's team queries assume a team member belongs to the
// organisation.
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

    // The test is "is this account granting itself a responses role", so the installation
    // claim is not a way around the rule.
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
      await seedTestDataGrant(tx, {
        workspaceId,
        role: group.role,
        subjectId: subject.userId,
        actorId: actor.userId,
        at: deps.clock.now(),
      });
    });

    return c.json({ group: await groupView(exec, workspace, group) }, 201);
  };
}

// Driven by the workspace's `seedNewEditorsWithTestData` setting, off by default. It
// creates an ordinary visible access group, so an editor still sees dev and test
// responses only through an explicit, revocable grant, never by implication from an
// authoring role. Test runs can involve real respondents, so it audits like any other
// grant on personal data. Scoped to whichever of `dev` and `test` actually exist, since a
// grant naming an absent environment is refused.
async function seedTestDataGrant(
  exec: Executor,
  input: {
    readonly workspaceId: string;
    readonly role: string;
    readonly subjectId: string;
    readonly actorId: string;
    readonly at: Date;
  },
): Promise<void> {
  if (input.role !== "forms.editor") return;
  if ((await readSeedNewEditorsWithTestData(exec, input.workspaceId)) !== true) return;

  const live = await listEnvironmentNames(exec);
  const scope = normaliseEnvironmentScope(
    live.filter((name) => name === "dev" || name === "test"),
    live,
  );
  if (scope.length === 0) return;

  const name = `${scope.join("-")}.responses.viewer`;
  const existing = (await listAccessGroups(exec, input.workspaceId)).find(
    (group) => group.name === name,
  );
  const group =
    existing ??
    (await createAccessGroup(exec, {
      workspaceId: input.workspaceId,
      name,
      role: "responses.viewer",
      environments: scope,
      forms: ["all"],
    }));

  if (await holdsAccessGroup(exec, group.teamId, input.subjectId)) return;
  await addAccessGroupHolder(exec, group.teamId, input.subjectId);
  await writeAccessAuditRow(exec, {
    actor: input.actorId,
    workspaceId: input.workspaceId,
    kind: "grant",
    ...scopeColumns(group),
    detail: scopeDetail(
      group,
      `subject=${input.subjectId} group=${group.name} seeded=seedNewEditorsWithTestData`,
    ),
    occurredAt: input.at,
  });
}

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

// Both switches are audited, because turning either off is the act somebody would want
// to find afterwards. A write that changes nothing writes no row.
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

// The actor id is deliberately not a foreign key, so a removed account shows as an id
// with no address rather than making the audit row disappear.
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
