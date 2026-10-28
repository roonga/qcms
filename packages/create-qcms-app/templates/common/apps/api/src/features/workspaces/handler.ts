import type { RouteHandler } from "@hono/zod-openapi";
import {
  archiveWorkspace,
  countWorkspaceContents,
  findArchiveBlockers,
  getForm,
  getQuestion,
  getWorkspace,
  getWorkspaceBySlug,
  listWorkspaces,
  moveFormToWorkspace,
  moveQuestionToWorkspace,
  readSeedNewEditorsWithTestData,
  setWorkspaceShared,
} from "@roonga/qcms-db";
import type { ArchiveBlockers, WorkspaceRow } from "@roonga/qcms-db";

import { parseFormId, parseQuestionId } from "@roonga/qcms-core";
import { isAPIError } from "better-auth/api";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { adminAuthFor } from "../auth/route.js";
import { requireOpenWorkspace, requireWorkspace } from "./resolve.js";
import type {
  archiveWorkspaceRoute,
  createWorkspaceRoute,
  listWorkspacesRoute,
  moveFormRoute,
  moveQuestionRoute,
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
  invalidQuestionId: (): ApiError =>
    new ApiError("INVALID_QUESTION_ID", 400, "Malformed question id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  questionNotFound: (): ApiError => new ApiError("QUESTION_NOT_FOUND", 404, "No such question"),
} as const;

function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

/**
 * better-auth 1.7.10 refuses a taken slug with a vendor `APIError` nothing else maps, so a
 * lost create race would be a 500. Matched on status: `body.code` is undefined and
 * `BAD_REQUEST` has one cause here.
 */
function isVendorSlugRefusal(err: unknown): boolean {
  if (!isAPIError(err)) return false;
  return (err as { status?: unknown }).status === "BAD_REQUEST";
}

async function workspaceView(
  deps: Deps,
  row: WorkspaceRow,
): Promise<{
  workspaceId: string;
  name: string;
  slug: string;
  isShared: boolean;
  requireSecondApprover: boolean;
  seedNewEditorsWithTestData: boolean;
  archivedAt: string | null;
  forms: number;
  questions: number;
}> {
  const contents = await countWorkspaceContents(deps.databases.control, row.id);
  return {
    workspaceId: row.id,
    name: row.name,
    slug: row.slug,
    isShared: row.isShared,
    requireSecondApprover: row.requireSecondApprover,
    // On the list because the screen that writes it has to open on the value it has: a
    // panel that guessed `false` would present a statement about personal data as though
    // nobody had chosen it.
    seedNewEditorsWithTestData:
      (await readSeedNewEditorsWithTestData(deps.databases.control, row.id)) ?? false,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
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
    const rows = await listWorkspaces(deps.databases.control);
    const workspaces = [];
    for (const row of rows) workspaces.push(await workspaceView(deps, row));
    return c.json({ workspaces }, 200);
  };
}

/**
 * Goes through better-auth's `createOrganization` rather than inserting the row, because
 * that writes the owner `member` row in the same act: a workspace never exists without an
 * owner.
 */
export function makeCreateWorkspaceHandler(
  deps: Deps,
): RouteHandler<typeof createWorkspaceRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();

    const existing = await getWorkspaceBySlug(deps.databases.control, body.slug);
    if (existing !== undefined) throw fail.slugTaken(body.slug);

    let created: { id: string };
    try {
      created = await adminAuthFor(deps).api.createOrganization({
        body: { name: body.name, slug: body.slug, userId: principal.userId },
      });
    } catch (err: unknown) {
      // Two ways to lose the slug race, one answer: the plugin's own check and the unique
      // index underneath it. Neither is a 500.
      if (isUniqueViolation(err) || isVendorSlugRefusal(err)) throw fail.slugTaken(body.slug);
      throw err;
    }

    const row = await getWorkspace(deps.databases.control, created.id);
    // Written on this connection moments ago, so its absence is not a 404: it would mean
    // the library wrote somewhere this handler cannot read.
    if (row === undefined) {
      throw new ApiError("WORKSPACE_NOT_READABLE", 500, "The workspace was created but not found");
    }
    return c.json({ workspace: await workspaceView(deps, row) }, 201);
  };
}

export function makeSetSharedWorkspaceHandler(
  deps: Deps,
): RouteHandler<typeof setSharedWorkspaceRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const { shared } = c.req.valid("json");
    // Unmarking does not require an open workspace: one archived while it held the
    // library would otherwise keep it with no way to hand it on.
    const workspace = shared
      ? await requireOpenWorkspace(deps.databases.control, workspaceId)
      : await requireWorkspace(deps.databases.control, workspaceId);

    if (shared && !workspace.isShared) {
      // Read for the refusal's sake: the unique index would refuse the write anyway, and
      // would name no workspace in doing so.
      const rows = await listWorkspaces(deps.databases.control);
      const holder = rows.find((row) => row.isShared);
      if (holder !== undefined) throw fail.alreadyShared(holder);
    }

    const updated = await setWorkspaceShared(deps.databases.control, workspaceId, shared);
    if (updated === undefined) throw new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace");
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
    const workspace = await getWorkspace(deps.databases.control, workspaceId);
    if (workspace === undefined)
      throw new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace");
    if (workspace.archivedAt !== null) throw fail.alreadyArchived();

    const blockers = await findArchiveBlockers(deps.databases.control, workspaceId);
    if (blockers.forms.length > 0 || blockers.shared) {
      throw fail.archiveBlocked(blockers);
    }

    const archived = await archiveWorkspace(deps.databases.control, workspaceId, deps.clock.now());
    // `archiveWorkspace` matches only an unarchived row, so `undefined` here is the
    // concurrent-archive race the pre-read cannot close.
    if (archived === undefined) throw fail.alreadyArchived();
    return c.json({ workspace: await workspaceView(deps, archived) }, 200);
  };
}

/**
 * One `UPDATE` on the identity row: the slug is unique installation-wide, so an ownership
 * change re-points no public address. Existing pins are not re-checked - whether the next
 * draft may keep them is the publish rule's answer, from the state at that time.
 */
export function makeMoveFormHandler(deps: Deps): RouteHandler<typeof moveFormRoute, ApiEnv> {
  return async (c) => {
    const parsed = parseFormId(c.req.valid("param").id);
    if (!parsed.ok) throw fail.invalidFormId();
    const target = await requireOpenWorkspace(
      deps.databases.control,
      c.req.valid("json").workspaceId,
    );

    const form = await getForm(deps.databases.control, parsed.value);
    if (form === undefined) throw fail.formNotFound();

    const moved = await moveFormToWorkspace(deps.databases.control, parsed.value, target.id);
    if (moved === undefined) throw fail.formNotFound();
    return c.json({ id: moved.formId, workspaceId: moved.workspaceId }, 200);
  };
}

/**
 * No version is touched, so a form elsewhere that already pins one keeps serving it and
 * keeps that pin in its next draft. Only a new cross-workspace pin is refused.
 */
export function makeMoveQuestionHandler(
  deps: Deps,
): RouteHandler<typeof moveQuestionRoute, ApiEnv> {
  return async (c) => {
    const parsed = parseQuestionId(c.req.valid("param").id);
    if (!parsed.ok) throw fail.invalidQuestionId();
    const target = await requireOpenWorkspace(
      deps.databases.control,
      c.req.valid("json").workspaceId,
    );

    const question = await getQuestion(deps.databases.control, parsed.value);
    if (question === undefined) throw fail.questionNotFound();

    const moved = await moveQuestionToWorkspace(deps.databases.control, parsed.value, target.id);
    if (moved === undefined) throw fail.questionNotFound();
    return c.json({ id: moved.questionId, workspaceId: moved.workspaceId }, 200);
  };
}
