import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { FormId } from "@roonga/qcms-core";

import { authOrganization, formReleases, forms, questions } from "../schema/index.js";
import type { Executor } from "./executor.js";

// A workspace is better-auth's `organization` row, created through `auth.api.createOrganization`, which also
// writes the `member` row carrying `forms.owner`. Only `isShared`, `requireSecondApprover` and
// `archivedAt` are QCMS's to write, except in {@link ensureSeedWorkspace}.

/** A workspace, as QCMS reads better-auth's `organization` row. */
export interface WorkspaceRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** The org-wide question library every workspace may pin from. */
  readonly isShared: boolean;
  readonly requireSecondApprover: boolean;
  /** Set once. A workspace is archived and never deleted. */
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

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
 * Every workspace, oldest first. Archived ones are included, because they still own
 * questions; {@link listActiveWorkspaces} is the filtered read.
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

/** The installation's shared workspace. Having none marked is a legal state. */
export async function getSharedWorkspace(exec: Executor): Promise<WorkspaceRow | undefined> {
  const [row] = await exec
    .select(workspaceColumns)
    .from(authOrganization)
    .where(eq(authOrganization.isShared, true))
    .limit(1);
  return row;
}

/**
 * Mark a workspace as the installation's shared question library, or unmark it. A second
 * workspace marked shared violates `organization_shared_uq`, which the caller turns into
 * a legible refusal.
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
 * Archive a workspace: stamp `archivedAt` and change nothing else, so archiving is not a third whole-session
 * delete path beside ADR-17's two. The caller refuses first, through {@link findArchiveBlockers}. There is no
 * unarchive, and `archivedAt IS NULL` keeps a second attempt from overwriting the stamp.
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

/** What stands between a workspace and being archived. */
export interface ArchiveBlockers {
  /** Every form this workspace owns, since an archived workspace owns none. */
  readonly forms: readonly FormId[];
  /** Those open in at least one environment, so a refusal can say which are urgent. */
  readonly openForms: readonly FormId[];
  /** Those ever released to an environment. */
  readonly releasedForms: readonly FormId[];
  readonly shared: boolean;
}

/**
 * What makes an archive premature. Every form blocks, since reopening checks no workspace state. The shared
 * flag blocks rather than being cleared, which would change what every other workspace may pin. Questions do
 * not block: an archived workspace can take no new pin.
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

  // There is no `forms.status`: open means the newest release row for some
  // (form, environment) pair does not say closed.
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

/** How much a workspace owns. */
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

export const SEED_WORKSPACE_ID = "org_default_workspace";
export const SEED_WORKSPACE_NAME = "Default workspace";
export const SEED_WORKSPACE_SLUG = "default";

/**
 * The installation's first workspace as a fixture: the existing one, or a new one if none. Idempotent. Not
 * the product's bootstrap path (`createOrganization` also writes the `member` row); it adopts an existing
 * workspace because with two, a create omitting `workspaceId` is refused as ambiguous.
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
    // Two harnesses seeding one database concurrently: the second insert does nothing and
    // both callers get the same id back.
    .onConflictDoNothing({ target: authOrganization.id });
  return SEED_WORKSPACE_ID;
}
