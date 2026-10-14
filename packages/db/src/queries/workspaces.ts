import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import { authOrganization, formReleases, forms, questions } from "../schema/index.js";
import type { Executor } from "./executor.js";

/**
 * Workspace reads and the two writes a workspace row takes (ADR-41, task 068).
 *
 * # A workspace is an `organization` row, and these helpers are the QCMS view of it
 *
 * Q32 put the workspace on better-auth's `organization` table rather than on a
 * `workspaces` table of QCMS's own, so the row's **creation** belongs to the library
 * (`auth.api.createOrganization`, which also writes the `member` row that carries
 * `forms.owner`) while the three QCMS fields on it - `isShared`,
 * `requireSecondApprover` and `archivedAt` - are read and written here, through Drizzle,
 * like any other control-plane state. That split is deliberate: the library owns the
 * identity and the membership it cascades from, and QCMS owns the fields its own rules
 * read, so neither side has to know how the other spells a decision.
 *
 * The one exception is {@link ensureSeedWorkspace}, which does insert a row, and its own
 * documentation says why a fixture path cannot go through the library.
 *
 * # The shape of a workspace, as QCMS reads it
 *
 * Narrow on purpose. `logo` and `metadata` are the plugin's own columns and QCMS reads
 * neither for a decision (Q39), `seedNewEditorsWithTestData` is task 069's and nothing
 * here looks at it, and `requireSecondApprover` is carried because task 070 reads it and
 * an owner has to be able to see what it is set to - this task writes it nowhere.
 */
export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** The org-wide question library every workspace may pin from (finding 10). */
  readonly isShared: boolean;
  /** The two-person switch task 070 reads; off by default and not written here (Q13). */
  readonly requireSecondApprover: boolean;
  /** Set once, when the workspace is archived. A workspace is never deleted (Q15). */
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

/** The columns {@link WorkspaceRow} carries, as one Drizzle projection. */
const workspaceColumns = {
  id: authOrganization.id,
  name: authOrganization.name,
  slug: authOrganization.slug,
  isShared: authOrganization.isShared,
  requireSecondApprover: authOrganization.requireSecondApprover,
  archivedAt: authOrganization.archivedAt,
  createdAt: authOrganization.createdAt,
} as const;

/**
 * Every workspace, oldest first, archived ones included.
 *
 * Oldest first rather than by name, because the first row is the workspace a bootstrapped
 * installation was seeded with and an installation with one workspace should see it at the
 * top of a list rather than wherever its display name sorts.
 *
 * Archived workspaces are **in** the list: a workspace is archived and never deleted
 * (Q15), so a list that hid them would be a list from which the rows that still own
 * questions had silently disappeared. Callers that need only the workspaces a new form may
 * be created in filter on `archivedAt`, and {@link listActiveWorkspaces} is that filter.
 */
export async function listWorkspaces(exec: Executor): Promise<WorkspaceRow[]> {
  return exec
    .select(workspaceColumns)
    .from(authOrganization)
    .orderBy(asc(authOrganization.createdAt), asc(authOrganization.id));
}

/** Every workspace that has not been archived, oldest first. */
export async function listActiveWorkspaces(exec: Executor): Promise<WorkspaceRow[]> {
  return exec
    .select(workspaceColumns)
    .from(authOrganization)
    .where(isNull(authOrganization.archivedAt))
    .orderBy(asc(authOrganization.createdAt), asc(authOrganization.id));
}

/** One workspace by id, or `undefined`. */
export async function getWorkspace(
  exec: Executor,
  workspaceId: string,
): Promise<WorkspaceRow | undefined> {
  const [row] = await exec
    .select(workspaceColumns)
    .from(authOrganization)
    .where(eq(authOrganization.id, workspaceId))
    .limit(1);
  return row;
}

/** One workspace by slug, or `undefined`. Slugs are unique installation-wide. */
export async function getWorkspaceBySlug(
  exec: Executor,
  slug: string,
): Promise<WorkspaceRow | undefined> {
  const [row] = await exec
    .select(workspaceColumns)
    .from(authOrganization)
    .where(eq(authOrganization.slug, slug))
    .limit(1);
  return row;
}

/**
 * The installation's shared workspace, or `undefined` when none is marked.
 *
 * At most one row can answer this: `organization_shared_uq` is a unique index over the
 * flag where it is true (the schema module says why), so this read needs no tie-break and
 * cannot be ambiguous. The shared workspace is **optional** (ADR-41), which is why the
 * absent case is a value and not an error.
 */
export async function getSharedWorkspace(exec: Executor): Promise<WorkspaceRow | undefined> {
  const [row] = await exec
    .select(workspaceColumns)
    .from(authOrganization)
    .where(eq(authOrganization.isShared, true))
    .limit(1);
  return row;
}

/**
 * Mark a workspace as the installation's shared question library, or unmark it.
 *
 * Returns the updated row, or `undefined` when no such workspace exists. A second
 * workspace marked shared fails `organization_shared_uq` as a unique violation; the
 * caller turns that into a legible refusal rather than letting it surface as a 500.
 */
export async function setWorkspaceShared(
  exec: Executor,
  workspaceId: string,
  shared: boolean,
): Promise<WorkspaceRow | undefined> {
  const [row] = await exec
    .update(authOrganization)
    .set({ isShared: shared })
    .where(eq(authOrganization.id, workspaceId))
    .returning(workspaceColumns);
  return row;
}

/**
 * Archive a workspace: stamp `archivedAt` and change nothing else (Q15).
 *
 * **Never a cascade and never a delete.** No form, question, version, release or response
 * row is touched, which is the property criterion 5 asserts: ADR-17 keeps exactly two
 * whole-session delete paths and "archive a workspace" is deliberately not allowed to
 * become a third. The refusal that has to happen first - no open form, no released
 * version - is the caller's, because it is a rule over other tables rather than a
 * property of this row (`apps/api/src/features/workspaces/handler.ts`).
 *
 * `WHERE "archivedAt" IS NULL` makes it idempotent in the honest direction: a workspace
 * already archived matches nothing, so the stamp of the act that archived it is never
 * overwritten by a second attempt and the caller can tell the two cases apart.
 */
export async function archiveWorkspace(
  exec: Executor,
  workspaceId: string,
  archivedAt: Date,
): Promise<WorkspaceRow | undefined> {
  const [row] = await exec
    .update(authOrganization)
    .set({ archivedAt })
    .where(and(eq(authOrganization.id, workspaceId), isNull(authOrganization.archivedAt)))
    .returning(workspaceColumns);
  return row;
}

/** What stands between a workspace and being archived (criterion 4). */
export interface ArchiveBlockers {
  /** Forms in this workspace still accepting new sessions, by id. */
  readonly openForms: readonly FormId[];
  /** Forms in this workspace that have ever been released to an environment, by id. */
  readonly releasedForms: readonly FormId[];
}

/**
 * The forms that make an archive premature: the open ones and the released ones
 * (criterion 4).
 *
 * # Why "ever released" rather than "released now"
 *
 * `control.form_releases` is append-only and there is no un-release: an environment moves
 * to another version, and the row recording the earlier one stays (ADR-40). So there is no
 * state in which a form that has been released has no released version, and "while a
 * released version remains" can only mean "while this workspace still owns a form that
 * reached an environment". The fix is the one Q15 names either way - reassign the form to
 * another workspace - and reassignment is what makes the refusal go away.
 *
 * # Why both lists rather than a count
 *
 * A refusal that says "3 forms" sends an operator looking; one that names the forms tells
 * them what to reassign. The same reasoning ADR-40's drop rule applies to an environment,
 * which names the open forms and the session count rather than refusing bare.
 *
 * Questions are deliberately **not** blockers. Criterion 4 names an open form and a
 * released version, and nothing else; a question owned by an archived workspace keeps
 * serving every pin that already exists, and whether it may be edited is a membership
 * question (task 069) rather than an archive one.
 */
export async function findArchiveBlockers(
  exec: Executor,
  workspaceId: string,
): Promise<ArchiveBlockers> {
  const open = await exec
    .select({ formId: forms.formId })
    .from(forms)
    .where(and(eq(forms.workspaceId, workspaceId), eq(forms.status, "open")))
    .orderBy(asc(forms.formId));

  const released = await exec
    .selectDistinct({ formId: forms.formId })
    .from(forms)
    .innerJoin(formReleases, eq(formReleases.formId, forms.formId))
    .where(eq(forms.workspaceId, workspaceId))
    .orderBy(asc(forms.formId));

  return {
    openForms: open.map((row) => row.formId),
    releasedForms: released.map((row) => row.formId),
  };
}

/** How much a workspace owns, for a list screen and for a legible refusal. */
export interface WorkspaceContents {
  readonly forms: number;
  readonly questions: number;
}

/** The number of forms and questions one workspace owns. */
export async function countWorkspaceContents(
  exec: Executor,
  workspaceId: string,
): Promise<WorkspaceContents> {
  const [formCount] = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(forms)
    .where(eq(forms.workspaceId, workspaceId));
  const [questionCount] = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(questions)
    .where(eq(questions.workspaceId, workspaceId));
  return {
    forms: Number(formCount?.total ?? 0),
    questions: Number(questionCount?.total ?? 0),
  };
}

/** The id, name and slug a fixture installation's first workspace is seeded with. */
export const SEED_WORKSPACE_ID = "org_default_workspace";
export const SEED_WORKSPACE_NAME = "Default workspace";
export const SEED_WORKSPACE_SLUG = "default";

/**
 * The installation's first workspace **as a fixture**: the one it already has, or a new
 * one if it has none, returning its id (task 068).
 *
 * # This is not the product's bootstrap seeding, and the difference is the member row
 *
 * The product seeds its first workspace through better-auth's server-side
 * `createOrganization` with an explicit `userId` (ADR-41; `apps/api/src/features/auth/
 * bootstrap.ts`), because that call also writes the `member` row that carries
 * `forms.owner` and attributes the workspace to the first administrator. That path needs
 * an auth instance and a user, and neither exists in a database fixture: the test harness
 * migrates a container with no accounts in it, and `pnpm dev:seed` runs against a stack
 * whose forms have to exist whether or not anybody has created an admin yet.
 *
 * So this is the fixture half: one row, no membership, idempotent. It exists because
 * `forms.workspace_id` and `questions.workspace_id` are `NOT NULL` with no default
 * (criterion 1), which makes a workspace a precondition of every control-plane fixture in
 * the repository rather than something a few suites care about.
 *
 * **It adopts an existing workspace rather than adding one beside it**, which matters
 * more than it looks: a development stack that has run `qcms:create-admin` already has a
 * workspace with this slug, and an installation with two workspaces is one where an
 * omitted `workspaceId` on a create is refused as ambiguous rather than resolved. So the
 * read comes first, and the insert is for the case where there is nothing to adopt. It is
 * therefore idempotent, and safe to call on every seed run.
 */
export async function ensureSeedWorkspace(exec: Executor): Promise<string> {
  const existing = await listWorkspaces(exec);
  const first = existing[0];
  if (first !== undefined) return first.id;

  await exec
    .insert(authOrganization)
    .values({
      id: SEED_WORKSPACE_ID,
      name: SEED_WORKSPACE_NAME,
      slug: SEED_WORKSPACE_SLUG,
    })
    // A concurrent seeder, which `pnpm dev:up` can produce when two harnesses start
    // against one database: whichever insert lands second does nothing and both callers
    // get the same id back.
    .onConflictDoNothing({ target: authOrganization.id });
  return SEED_WORKSPACE_ID;
}
