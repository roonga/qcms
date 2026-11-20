import type { RouteHandler } from "@hono/zod-openapi";
import {
  archiveWorkspace,
  countWorkspaceContents,
  findArchiveBlockers,
  findUserByEmail,
  getForm,
  getWorkspace,
  getWorkspaceBySlug,
  isAccountActive,
  listWorkspaces,
  lockWorkspaceMembership,
  renameWorkspace,
  setWorkspaceShared,
  writeAccessAuditRow,
  writeSiteAuditWithMirror,
} from "@roonga/qcms-db";
import type { ArchiveBlockers, Executor, WorkspaceRow } from "@roonga/qcms-db";

import { parseFormId, type FormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { holdsStatement } from "../membership/policy.js";
import { decideInWorkspace, holdsInstallationClaim } from "../membership/resolver.js";
import { holdWorkspaceRequest } from "../membership/two-person.js";
import { requestView } from "../site-admins/schema.js";
import { createWorkspaceWithStarterGroups } from "./create.js";
import {
  applyFormMove,
  lockFormInSource,
  moveAccessPreview,
  moveFail,
  moveHoldReason,
  type MoveHoldReason,
  type MovePreviewPerson,
} from "./move.js";
import { requireOpenWorkspace, requireWorkspace, workspaceFail } from "./resolve.js";
import type {
  archiveWorkspaceRoute,
  createWorkspaceRoute,
  listWorkspacesRoute,
  moveFormPreviewRoute,
  moveFormRoute,
  renameWorkspaceRoute,
  setSharedWorkspaceRoute,
} from "./route.js";

function archiveRefusal(blockers: ArchiveBlockers): string {
  const reassign = "reassign these forms to another workspace";
  const handOn =
    "unmark this workspace as the shared question library, or hand the library on to another workspace";
  if (blockers.shared && blockers.forms.length > 0) {
    return `Archiving is the last step: ${reassign}, and ${handOn}, first`;
  }
  if (blockers.shared) return `Archiving is the last step: ${handOn}, first`;
  return `Archiving is the last step: ${reassign} first`;
}

const fail = {
  slugTaken: (slug: string): ApiError =>
    new ApiError("WORKSPACE_SLUG_TAKEN", 409, `A workspace already uses the slug "${slug}"`),
  firstAdministratorUnknown: (): ApiError =>
    new ApiError(
      "FIRST_ADMINISTRATOR_NOT_FOUND",
      422,
      "No account has that address. The first Workspace administrator must be an existing account.",
    ),
  /**
   * One answer for disabled and for unclaimed: an account that has not set a password and
   * enrolled a factor cannot administer a workspace, and neither can a disabled one.
   */
  firstAdministratorNotClaimed: (): ApiError =>
    new ApiError(
      "FIRST_ADMINISTRATOR_NOT_CLAIMED",
      422,
      "The first Workspace administrator must be an account that is active and has been claimed.",
    ),
  noPrincipal: (): ApiError =>
    new ApiError(
      "ADMIN_REQUIRED",
      401,
      "A workspace is attributed to the account that created it, so this needs an admin session",
    ),
  /**
   * At most one workspace is shared (ADR-41), so the second request names the holder
   * rather than moving the library quietly: that would change what everybody else may pin.
   */
  alreadyShared: (holder: WorkspaceRow): ApiError =>
    new ApiError(
      "SHARED_WORKSPACE_EXISTS",
      409,
      `The workspace "${holder.slug}" is already the installation's shared question library; unmark it first`,
      { workspaceId: holder.id, slug: holder.slug },
    ),
  /**
   * Every form the workspace owns is a blocker, a closed and never-released one included:
   * `reopen` checks no workspace state, so a closed form left behind could be reopened
   * and the archived workspace would then own an open form.
   */
  archiveBlocked: (blockers: ArchiveBlockers): ApiError =>
    new ApiError("WORKSPACE_NOT_EMPTY", 409, archiveRefusal(blockers), {
      forms: [...blockers.forms],
      openForms: [...blockers.openForms],
      releasedForms: [...blockers.releasedForms],
      shared: blockers.shared,
    }),
  alreadyArchived: (): ApiError =>
    new ApiError("WORKSPACE_ARCHIVED", 409, "That workspace is already archived"),
  invalidFormId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
} as const;

function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

interface WorkspaceViewRow {
  workspaceId: string;
  name: string;
  slug: string;
  archivedAt: string | null;
  isShared?: boolean;
  requireSecondApprover?: boolean;
  forms?: number;
  questions?: number;
}

/** Identity alone, which is what a caller holding no `workspace: read` there is shown. */
function workspaceIdentity(row: WorkspaceRow): WorkspaceViewRow {
  return {
    workspaceId: row.id,
    name: row.name,
    slug: row.slug,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
  };
}

async function workspaceView(deps: Deps, row: WorkspaceRow): Promise<WorkspaceViewRow> {
  const contents = await countWorkspaceContents(deps.databases.control, row.id);
  return {
    ...workspaceIdentity(row),
    isShared: row.isShared,
    requireSecondApprover: row.requireSecondApprover,
    forms: contents.forms,
    questions: contents.questions,
  };
}

export function makeListWorkspacesHandler(
  deps: Deps,
): RouteHandler<typeof listWorkspacesRoute, ApiEnv> {
  return async (c) => {
    // Archived workspaces are in the list: one is archived and never deleted (Q15), and
    // one that still owns questions is what a reader needs to see.
    const grant = c.get("grantContext");
    const held = grant?.workspaceIds ?? [];
    const administers = new Set(
      (grant?.memberships ?? [])
        .filter((membership) =>
          holdsStatement(
            { memberRole: membership.memberRole, grants: membership.grants },
            "workspace",
            "read",
          ),
        )
        .map((membership) => membership.workspaceId),
    );
    const rows = (await listWorkspaces(deps.databases.control)).filter((row) =>
      held.includes(row.id),
    );
    const workspaces = [];
    for (const row of rows) {
      workspaces.push(
        administers.has(row.id) ? await workspaceView(deps, row) : workspaceIdentity(row),
      );
    }
    return c.json({ workspaces }, 200);
  };
}

export function makeRenameWorkspaceHandler(
  deps: Deps,
): RouteHandler<typeof renameWorkspaceRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const { name } = c.req.valid("json");
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    await requireOpenWorkspace(deps.databases.control, workspaceId);

    const renamed = await deps.databases.control.transaction(async (tx) => {
      const result = await renameWorkspace(tx, workspaceId, name);
      // `renameWorkspace` matches only an unarchived row, so this is an archive that
      // landed after the pre-read.
      if (result === undefined) throw workspaceFail.archived();
      if (result.previousName !== name) {
        await writeAccessAuditRow(tx, {
          actor: principal.userId,
          workspaceId,
          kind: "setting",
          detail: `setting=name from=${JSON.stringify(result.previousName)} to=${JSON.stringify(name)}`,
          occurredAt: deps.clock.now(),
        });
      }
      return result.workspace;
    });
    return c.json({ workspace: await workspaceView(deps, renamed) }, 200);
  };
}

/**
 * The route row admits a Site administrator only. The workspace, its first Workspace
 * administrator, the four starter groups and the audit row are one transaction.
 */
export function makeCreateWorkspaceHandler(
  deps: Deps,
): RouteHandler<typeof createWorkspaceRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    const exec = deps.databases.control;

    const existing = await getWorkspaceBySlug(exec, body.slug);
    if (existing !== undefined) throw fail.slugTaken(body.slug);

    let firstAdministratorId = principal.userId;
    if (body.firstAdministratorEmail !== undefined) {
      const named = await findUserByEmail(exec, body.firstAdministratorEmail);
      if (named === undefined) throw fail.firstAdministratorUnknown();
      firstAdministratorId = named.userId;
    }
    if (!(await isAccountActive(exec, firstAdministratorId))) {
      throw fail.firstAdministratorNotClaimed();
    }

    let created: WorkspaceRow;
    try {
      created = await exec.transaction(
        async (tx) =>
          (
            await createWorkspaceWithStarterGroups(tx, {
              name: body.name,
              slug: body.slug,
              firstAdministratorId,
              actor: principal.userId,
              occurredAt: deps.clock.now(),
            })
          ).workspace,
      );
    } catch (err: unknown) {
      // The pre-read cannot close the race for the slug; the unique index does.
      if (isUniqueViolation(err)) throw fail.slugTaken(body.slug);
      throw err;
    }
    return c.json({ workspace: await workspaceView(deps, created) }, 201);
  };
}

export function makeSetSharedWorkspaceHandler(
  deps: Deps,
): RouteHandler<typeof setSharedWorkspaceRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const { shared, handOn = false } = c.req.valid("json");
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    // Unmarking does not require an open workspace: one archived while it held the
    // library would otherwise keep it with no way to hand it on.
    const workspace = shared
      ? await requireOpenWorkspace(deps.databases.control, workspaceId)
      : await requireWorkspace(deps.databases.control, workspaceId);

    const holderOf = async (exec: Executor): Promise<WorkspaceRow | undefined> =>
      (await listWorkspaces(exec)).find((row) => row.isShared && row.id !== workspaceId);

    if (shared && !workspace.isShared && !handOn) {
      // Read for the refusal's sake: the unique index would refuse the write anyway, and
      // would name no workspace in doing so.
      const holder = await holderOf(deps.databases.control);
      if (holder !== undefined) throw fail.alreadyShared(holder);
    }

    const audit = async (tx: Executor, subject: string, marked: boolean): Promise<void> => {
      await writeSiteAuditWithMirror(
        tx,
        {
          actor: principal.userId,
          subject,
          workspaceId: subject,
          kind: "library",
          detail: `library=${marked ? "marked" : "unmarked"}`,
          occurredAt: deps.clock.now(),
        },
        [subject],
      );
    };

    let updated: WorkspaceRow;
    try {
      updated = await deps.databases.control.transaction(async (tx) => {
        const holder = shared && handOn ? await holderOf(tx) : undefined;
        if (holder !== undefined) {
          await setWorkspaceShared(tx, holder.id, false);
          await audit(tx, holder.id, false);
        }
        const row = await setWorkspaceShared(tx, workspaceId, shared);
        if (row === undefined) throw workspaceFail.notFound();
        if (row.isShared !== workspace.isShared) await audit(tx, workspaceId, shared);
        return row;
      });
    } catch (err: unknown) {
      // Another marking committed between the read and the write.
      if (!isUniqueViolation(err)) throw err;
      const holder = await holderOf(deps.databases.control);
      if (holder === undefined) throw err;
      throw fail.alreadyShared(holder);
    }
    return c.json({ workspace: await workspaceView(deps, updated) }, 200);
  };
}

/**
 * It refuses rather than tidying up: nothing is closed, reassigned or unmarked on the
 * operator's behalf, because each of those acts has consequences of its own (Q15). An
 * archive is terminal and there is no unarchive.
 */
export function makeArchiveWorkspaceHandler(
  deps: Deps,
): RouteHandler<typeof archiveWorkspaceRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    const workspace = await getWorkspace(deps.databases.control, workspaceId);
    if (workspace === undefined)
      throw new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace");
    if (workspace.archivedAt !== null) throw fail.alreadyArchived();

    const blockers = await findArchiveBlockers(deps.databases.control, workspaceId);
    if (blockers.forms.length > 0 || blockers.shared) {
      throw fail.archiveBlocked(blockers);
    }

    const archived = await deps.databases.control.transaction(async (tx) => {
      const row = await archiveWorkspace(tx, workspaceId, deps.clock.now());
      // `archiveWorkspace` matches only an unarchived row, so `undefined` here is the
      // concurrent-archive race the pre-read cannot close.
      if (row === undefined) throw fail.alreadyArchived();
      await writeAccessAuditRow(tx, {
        actor: principal.userId,
        workspaceId,
        kind: "setting",
        detail: "setting=archived",
        occurredAt: deps.clock.now(),
      });
      return row;
    });
    return c.json({ workspace: await workspaceView(deps, archived) }, 200);
  };
}

interface MoveContext {
  readonly formId: FormId;
  readonly moverId: string;
  readonly source: WorkspaceRow;
  readonly destination: WorkspaceRow;
  readonly hold: MoveHoldReason | undefined;
}

/**
 * The whole move act's authority: the route row carries the source's Edit forms cell, the
 * destination's own is checked here because one row names one workspace, and the hold is
 * read from the source's rule and the mover's standing in it.
 */
async function moveContext(
  deps: Deps,
  input: {
    readonly formId: string;
    readonly principal: { readonly userId: string; readonly role?: string | null } | undefined;
    readonly destinationWorkspaceId: string;
  },
): Promise<MoveContext> {
  const parsed = parseFormId(input.formId);
  if (!parsed.ok) throw fail.invalidFormId();
  const principal = input.principal;
  if (principal === undefined) throw fail.noPrincipal();
  const exec = deps.databases.control;
  const destination = await requireOpenWorkspace(exec, input.destinationWorkspaceId);

  const form = await getForm(exec, parsed.value);
  if (form === undefined) throw moveFail.formNotFound();
  if (form.workspaceId === destination.id) throw moveFail.sameWorkspace();
  const source = await requireWorkspace(exec, form.workspaceId);

  const inDestination = await decideInWorkspace(exec, {
    userId: principal.userId,
    workspaceId: destination.id,
    claim: holdsInstallationClaim(principal.role),
    request: { resource: "form", action: "write" },
  });
  if (!inDestination.allowed) throw moveFail.notInDestination();

  return {
    formId: parsed.value,
    moverId: principal.userId,
    source,
    destination,
    hold: await moveHoldReason(exec, { source, moverId: principal.userId }),
  };
}

/**
 * One `UPDATE` on the identity row, so no public address moves; a held move moves nothing
 * until approved. Hold and apply run under the source's membership lock with the form row
 * locked, as an approval does, so a switch, role change or other move in between is seen.
 */
export function makeMoveFormHandler(deps: Deps): RouteHandler<typeof moveFormRoute, ApiEnv> {
  return async (c) => {
    const move = await moveContext(deps, {
      formId: c.req.valid("param").id,
      principal: c.get("adminPrincipal"),
      destinationWorkspaceId: c.req.valid("json").workspaceId,
    });

    const outcome = await deps.databases.control.transaction(async (tx) => {
      await lockWorkspaceMembership(tx, move.source.id);
      const leftSource = await lockFormInSource(tx, {
        formId: move.formId,
        sourceWorkspaceId: move.source.id,
      });
      if (leftSource !== undefined) throw leftSource;
      const destination = await requireOpenWorkspace(tx, move.destination.id);
      const source = await requireWorkspace(tx, move.source.id);
      const hold = await moveHoldReason(tx, { source, moverId: move.moverId });

      if (hold !== undefined) {
        const held = await holdWorkspaceRequest(tx, deps.clock.now(), {
          kind: "move-form",
          workspaceId: source.id,
          target: move.formId,
          requester: move.moverId,
          payload: { destinationWorkspaceId: destination.id },
          formId: move.formId,
        });
        return { held } as const;
      }
      const workspaceId = await applyFormMove(tx, deps, {
        formId: move.formId,
        sourceWorkspaceId: source.id,
        destinationWorkspaceId: destination.id,
        actorId: move.moverId,
      });
      return { workspaceId } as const;
    });

    if ("held" in outcome) return c.json({ request: requestView(outcome.held) }, 202);
    return c.json({ id: move.formId, workspaceId: outcome.workspaceId }, 200);
  };
}

function previewPeople(people: readonly MovePreviewPerson[]): {
  name: string;
  acts: { act: string; environments: string[] }[];
}[] {
  return people.map((person) => ({
    name: person.name,
    acts: person.acts.map((entry) => ({
      act: entry.act,
      environments: [...entry.environments],
    })),
  }));
}

export function makeMoveFormPreviewHandler(
  deps: Deps,
): RouteHandler<typeof moveFormPreviewRoute, ApiEnv> {
  return async (c) => {
    const move = await moveContext(deps, {
      formId: c.req.valid("param").id,
      principal: c.get("adminPrincipal"),
      destinationWorkspaceId: c.req.valid("query").workspaceId,
    });
    const preview = await moveAccessPreview(deps.databases.control, {
      sourceWorkspaceId: move.source.id,
      destinationWorkspaceId: move.destination.id,
    });
    return c.json(
      {
        formId: String(move.formId),
        sourceWorkspaceId: move.source.id,
        destinationWorkspaceId: move.destination.id,
        requiresApproval: move.hold !== undefined,
        holdReason: move.hold ?? null,
        gains: previewPeople(preview.gains),
        losses: previewPeople(preview.losses),
      },
      200,
    );
  };
}
