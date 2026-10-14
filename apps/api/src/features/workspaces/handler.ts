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
  setWorkspaceShared,
} from "@roonga/qcms-db";
import type { WorkspaceRow } from "@roonga/qcms-db";

import { parseFormId, parseQuestionId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { adminAuthFor } from "../auth/route.js";
import { requireOpenWorkspace } from "./resolve.js";
import type {
  archiveWorkspaceRoute,
  createWorkspaceRoute,
  listWorkspacesRoute,
  moveFormRoute,
  moveQuestionRoute,
  setSharedWorkspaceRoute,
} from "./route.js";

/**
 * Handlers for the workspace model (ADR-41, task 068).
 *
 * Every route here runs on the **control** pool: a workspace is control-plane state, as
 * are the forms and questions that reference it, and no statement in this slice reaches a
 * data schema at all. That is not incidental - it is the property criterion 5 asserts.
 * **No code path here deletes a workspace and none reaches a response row from one**, so
 * ADR-17's two whole-session delete paths stay at two: archiving stamps one column,
 * moving a form or a question is one `UPDATE` on an identity row, and `@roonga/qcms-db`
 * exports no workspace delete for a future handler to reach for.
 *
 * What is deliberately absent:
 *
 *   - **No role and no membership check.** Task 068 builds the container and grants
 *     nothing; the six roles, the scope, the resolver and the middleware are 069's, and
 *     these routes sit behind the admin-session gate every other admin slice sits behind
 *     and nothing more. A check written before the roles exist would be inventing them.
 *   - **No admin screen.** The plan's 068 section has no screen in it. The workspace and
 *     membership screens arrive with 069, which is where the permissions matrix that
 *     governs them is built.
 *   - **No `requireSecondApprover` write.** The field is declared, defaults off (Q13)
 *     and is read by task 070. Nothing here sets it.
 */

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
   * Another workspace is already the installation's shared question library.
   *
   * At most one is marked shared (ADR-41), so the second request is a refusal naming the
   * one that holds it rather than a silent move: which workspace owns the library is a
   * decision about what every other workspace may pin, and moving it quietly would
   * change that for everybody.
   */
  alreadyShared: (holder: WorkspaceRow): ApiError =>
    new ApiError(
      "SHARED_WORKSPACE_EXISTS",
      409,
      `The workspace "${holder.slug}" is already the installation's shared question library; unmark it first`,
      { workspaceId: holder.id, slug: holder.slug },
    ),
  archiveBlocked: (open: readonly string[], released: readonly string[]): ApiError =>
    new ApiError(
      "WORKSPACE_NOT_EMPTY",
      409,
      "Archiving is the last step: reassign these forms to another workspace first",
      { openForms: [...open], releasedForms: [...released] },
    ),
  alreadyArchived: (): ApiError =>
    new ApiError("WORKSPACE_ARCHIVED", 409, "That workspace is already archived"),
  invalidFormId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  invalidQuestionId: (): ApiError =>
    new ApiError("INVALID_QUESTION_ID", 400, "Malformed question id"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  questionNotFound: (): ApiError => new ApiError("QUESTION_NOT_FOUND", 404, "No such question"),
} as const;

/** True for a Postgres unique-violation (SQLSTATE 23505) on the error or its cause. */
function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

/** One workspace as the API reports it, with what it owns. */
async function workspaceView(
  deps: Deps,
  row: WorkspaceRow,
): Promise<{
  workspaceId: string;
  name: string;
  slug: string;
  isShared: boolean;
  requireSecondApprover: boolean;
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
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
    forms: contents.forms,
    questions: contents.questions,
  };
}

// --- GET /admin/workspaces --------------------------------------------------

export function makeListWorkspacesHandler(
  deps: Deps,
): RouteHandler<typeof listWorkspacesRoute, ApiEnv> {
  return async (c) => {
    // Archived workspaces are **in** the list: a workspace is archived and never deleted
    // (Q15), and one that still owns questions is exactly what a reader needs to see.
    const rows = await listWorkspaces(deps.databases.control);
    const workspaces = [];
    for (const row of rows) workspaces.push(await workspaceView(deps, row));
    return c.json({ workspaces }, 200);
  };
}

// --- POST /admin/workspaces -------------------------------------------------

/**
 * Create a workspace through better-auth's **server-side** `createOrganization` with an
 * explicit `userId` (Q32, ADR-41).
 *
 * The plugin's own HTTP endpoint is unreachable - `features/auth/route.ts`'s allowlist
 * names none of its paths - and `allowUserToCreateOrganization: false` refuses every
 * session-bound call to it, so this is the one path by which a workspace comes into
 * existence. Going through the library rather than inserting the row is what writes the
 * `member` row carrying `forms.owner` (the plugin's `creatorRole`) in the same act, so a
 * workspace never exists without an owner.
 *
 * The slug is pre-checked for a legible 409. The unique index behind it is the backstop,
 * and a race that reaches it is mapped to the same refusal rather than surfacing as a
 * 500.
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
      if (isUniqueViolation(err)) throw fail.slugTaken(body.slug);
      throw err;
    }

    const row = await getWorkspace(deps.databases.control, created.id);
    // The row was just written on this connection, so its absence is not a 404 to
    // report: it would mean the library wrote somewhere this handler cannot read.
    if (row === undefined) {
      throw new ApiError("WORKSPACE_NOT_READABLE", 500, "The workspace was created but not found");
    }
    return c.json({ workspace: await workspaceView(deps, row) }, 201);
  };
}

// --- PUT /admin/workspaces/:id/shared ---------------------------------------

export function makeSetSharedWorkspaceHandler(
  deps: Deps,
): RouteHandler<typeof setSharedWorkspaceRoute, ApiEnv> {
  return async (c) => {
    const workspaceId = c.req.valid("param").id;
    const { shared } = c.req.valid("json");
    const workspace = await requireOpenWorkspace(deps.databases.control, workspaceId);

    if (shared && !workspace.isShared) {
      // Read the holder for the refusal's sake. The unique index would refuse the write
      // anyway, and would name no workspace in doing so.
      const rows = await listWorkspaces(deps.databases.control);
      const holder = rows.find((row) => row.isShared);
      if (holder !== undefined) throw fail.alreadyShared(holder);
    }

    const updated = await setWorkspaceShared(deps.databases.control, workspaceId, shared);
    if (updated === undefined) throw new ApiError("WORKSPACE_NOT_FOUND", 404, "No such workspace");
    return c.json({ workspace: await workspaceView(deps, updated) }, 200);
  };
}

// --- POST /admin/workspaces/:id/archive -------------------------------------

/**
 * Archive a workspace, never delete one (Q15).
 *
 * **It refuses rather than tidying up.** An archive is allowed only once the workspace
 * holds no open form and no released version, and the refusal **names the forms** so an
 * operator knows what to reassign. An implementation that closed or reassigned on the
 * operator's behalf would turn one act into several silent ones, which fails the spirit
 * of Q15 even where it passes the letter: closing a form stops new sessions for real
 * respondents, and moving a form changes who can see it.
 *
 * "No released version" reads `control.form_releases`, which is task 065's table and the
 * reason this task depends on it (Q63).
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
    if (blockers.openForms.length > 0 || blockers.releasedForms.length > 0) {
      throw fail.archiveBlocked(blockers.openForms, blockers.releasedForms);
    }

    const archived = await archiveWorkspace(deps.databases.control, workspaceId, deps.clock.now());
    // `archiveWorkspace` matches only an unarchived row, so `undefined` here is the
    // concurrent-archive race the pre-read cannot close. The answer is the same refusal.
    if (archived === undefined) throw fail.alreadyArchived();
    return c.json({ workspace: await workspaceView(deps, archived) }, 200);
  };
}

// --- POST /admin/forms/:id/workspace ----------------------------------------

/**
 * Move a form to another workspace.
 *
 * The companion of Q14's question move, and the act that makes an archive possible:
 * archiving is the last step and never a cascade, so a workspace's forms are reassigned
 * first. One `UPDATE` on the identity row, so no published version changes hands, no
 * compiled document is touched and no public address moves (criterion 7) - the slug is
 * unique installation-wide precisely so that an ownership change re-points nothing.
 *
 * **It does not re-check the form's existing pins.** A form that pinned a question from
 * its old workspace keeps serving every published version it has (R1, ADR-02), and
 * whether its **next draft** may keep those pins is the publish rule's answer, computed
 * from the state at that time. Deciding it here would be deciding it twice, from the
 * older of the two states.
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

// --- POST /admin/questions/:id/workspace ------------------------------------

/**
 * Move a question to another workspace (Q14).
 *
 * One `UPDATE` on the identity row and no version is touched, which is what makes the
 * grandfathering true rather than promised: a form elsewhere that already pins one of
 * this question's versions **keeps serving it**, because the version is immutable content
 * this statement does not reach, and **keeps that pin in its next draft**, because the
 * publish rule grandfathers a placement that was already in the previous published
 * version. What is refused afterwards is a **new** pin from another workspace, through
 * the same path that refuses a pin to a `deprecated` version.
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
