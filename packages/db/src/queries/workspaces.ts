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
 * become a third. The refusal that has to happen first - **no form of any kind, and not
 * the shared library** (Q64, Q65) - is the caller's, because it is a rule over other
 * tables and over this row's own `isShared` rather than a property of the stamp
 * ({@link findArchiveBlockers} below, and
 * `apps/api/src/features/workspaces/handler.ts`).
 *
 * **There is no unarchive** (Q66), which is why this stamp is written once and why the
 * only write an archived workspace still takes is {@link setWorkspaceShared} unmarking
 * the library.
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
  /**
   * **Every** form this workspace owns, by id, open or closed and released or not.
   *
   * An archived workspace owns no form at all (Code Owner, 2026-10-16, PR #1059). The
   * two lists below are the same forms narrowed, and they exist so the refusal can say
   * which ones are urgent rather than only how many there are.
   */
  readonly forms: readonly FormId[];
  /** Forms in this workspace still accepting new sessions, by id. */
  readonly openForms: readonly FormId[];
  /** Forms in this workspace that have ever been released to an environment, by id. */
  readonly releasedForms: readonly FormId[];
  /** True when this workspace is the installation's shared question library. */
  readonly shared: boolean;
}

/**
 * What makes an archive premature (criterion 4).
 *
 * # Every form, not only the open and the released ones (Code Owner, 2026-10-16)
 *
 * The first reading of criterion 4 refused an archive while an **open** form or a
 * **released** version remained, which left a closed, never-released form owned by an
 * archived workspace - and `POST /admin/forms/{id}/reopen` checks no workspace state, so
 * that form could be reopened afterwards and the archived workspace would then own an open
 * form, which is the state the archive had just refused. The Code Owner ruled the
 * literal reading of Q15 instead: "its forms and questions are reassigned first" means an
 * archived workspace owns **no form**, so every form is a blocker and the loophole closes
 * without waiting for task 069's membership screens.
 *
 * **Questions stay non-blockers.** They serve the pins that already exist, and a question
 * in an archived workspace cannot take a **new** pin from anywhere: the publish rule
 * allows a form to pin its own workspace's questions or the shared workspace's, and an
 * archived workspace is neither for any live form once its forms have left.
 *
 * # The shared library is a blocker too, and is not cleared for the operator
 * (Code Owner, 2026-10-16)
 *
 * A workspace that is the installation's shared question library is refused the archive
 * while it is marked shared, named as its own blocker. Clearing `isShared` here would be
 * the cascade Q15 refuses - it would change what every other workspace may pin as a side
 * effect of one operator act - so the operator unmarks it, or hands the library to
 * another workspace, and archives after that. The repair path exists either way, because
 * unmarking a workspace does not require it to be open.
 *
 * # Why lists rather than counts
 *
 * A refusal that says "3 forms" sends an operator looking; one that names the forms tells
 * them what to reassign. The same reasoning ADR-40's drop rule applies to an environment,
 * which names the open forms and the session count rather than refusing bare.
 *
 * # What "open" means on the narrower list, since task 066
 *
 * There is no `forms.status`: the closed state is per (form, environment) and lives on
 * the release state (Q18), so "open" here is **open in at least one environment** - the
 * newest release row for some pair does not say closed. That makes `openForms` a subset
 * of `releasedForms`, because a form can only be open where something is released, and it
 * leaves a never-released form in **neither** narrower list. It is still a blocker: the
 * `forms` list above is every owned form, which is the whole of the Code Owner's
 * 2026-10-16 reading and is why the loophole stays closed without a status column.
 *
 * # Why "ever released" rather than "released now" on that narrower list
 *
 * `control.form_releases` is append-only and there is no un-release: an environment moves
 * to another version, and the row recording the earlier one stays (ADR-40). So there is no
 * state in which a form that has been released has no released version, and the list means
 * "this workspace still owns a form that reached an environment".
 */
export async function findArchiveBlockers(
  exec: Executor,
  workspaceId: string,
): Promise<ArchiveBlockers> {
  const owned = await exec
    .select({ formId: forms.formId })
    .from(forms)
    .where(eq(forms.workspaceId, workspaceId))
    .orderBy(asc(forms.formId));

  const released = await exec
    .selectDistinct({ formId: forms.formId })
    .from(forms)
    .innerJoin(formReleases, eq(formReleases.formId, forms.formId))
    .where(eq(forms.workspaceId, workspaceId))
    .orderBy(asc(forms.formId));

  // Open **in some environment**, which is what "open" means since task 066 (Q18): there
  // is no `forms.status`, and the state is the `closed` flag on the newest
  // `control.form_releases` row for each (form, environment) pair. A form with no release
  // anywhere is in neither narrower list and is still a blocker, because `forms` above is
  // every owned form - which is the Code Owner's 2026-10-16 reading.
  const open = await exec.execute<{ form_id: string }>(sql`
    select distinct f.form_id
      from ${forms} f
      join ${formReleases} r on r.form_id = f.form_id
     where f.workspace_id = ${workspaceId}
       and r.closed = false
       and r.sequence = (
             select max(r2.sequence)
               from ${formReleases} r2
              where r2.form_id = r.form_id
                and r2.environment = r.environment)
     order by f.form_id
  `);

  const workspace = await getWorkspace(exec, workspaceId);

  return {
    forms: owned.map((row) => row.formId),
    openForms: open.rows.map((row) => row.form_id as FormId),
    releasedForms: released.map((row) => row.formId),
    shared: workspace?.isShared ?? false,
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
