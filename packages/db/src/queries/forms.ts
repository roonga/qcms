import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import type { FormDefinition, FormId } from "@roonga/qcms-core";

import { formDrafts, formVersions, forms } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * A form's lifecycle status in one environment. Derived, not stored: the state is the
 * `closed` flag on the newest `control.form_releases` row for the pair.
 */
export type FormStatus = "open" | "closed";

/**
 * The `forms` identity row; it carries no status, which is per (form, environment).
 * Hand-authored: `$inferSelect` degrades through the emitted `.d.ts` for a branded table.
 */
export interface FormRow {
  formId: FormId;
  slug: string;
  /** The workspace that owns this form. Never null. */
  workspaceId: string;
  defaultLocale: string;
  challengeRequired: boolean;
  minSubmitMs: number | null;
}

// `$inferSelect` is sound in package source and only degrades through the emitted
// `.d.ts`, so it can police `FormRow` here.
export type _FormRowMatchesTable = AssignableTo<FormRow, typeof forms.$inferSelect> &
  AssignableTo<typeof forms.$inferSelect, FormRow>;

// Enum-free and unbranded, so `$inferSelect` is sound through the package boundary.
export type FormDraftRow = typeof formDrafts.$inferSelect;
export type FormVersionRow = typeof formVersions.$inferSelect;

/** Read a form identity by its public `slug`, or `undefined`. */
export async function getFormBySlug(exec: Executor, slug: string): Promise<FormRow | undefined> {
  const [row] = await exec.select().from(forms).where(eq(forms.slug, slug)).limit(1);
  return row;
}

/** Read a form identity by its `formId`, or `undefined`. */
export async function getForm(exec: Executor, formId: FormId): Promise<FormRow | undefined> {
  const [row] = await exec.select().from(forms).where(eq(forms.formId, formId)).limit(1);
  return row;
}

/** Every form identity, ordered by `formId` for a stable listing. */
export async function listForms(
  exec: Executor,
  options: { readonly workspaceIds?: readonly string[] } = {},
): Promise<FormRow[]> {
  // The confidentiality boundary: `undefined` is the whole installation, and an empty
  // list must stay empty rather than widen to every workspace.
  if (options.workspaceIds === undefined) {
    return exec.select().from(forms).orderBy(forms.formId);
  }
  if (options.workspaceIds.length === 0) return [];
  return exec
    .select()
    .from(forms)
    .where(inArray(forms.workspaceId, [...options.workspaceIds]))
    .orderBy(forms.formId);
}

/** Create a form identity. The abuse settings may be left to their column defaults. */
export async function createForm(
  exec: Executor,
  input: {
    formId: FormId;
    slug: string;
    workspaceId: string;
    defaultLocale: string;
    challengeRequired?: boolean;
    minSubmitMs?: number | null;
  },
): Promise<FormRow> {
  const [row] = await exec
    .insert(forms)
    .values({
      formId: input.formId,
      slug: input.slug,
      workspaceId: input.workspaceId,
      defaultLocale: input.defaultLocale,
      ...(input.challengeRequired !== undefined
        ? { challengeRequired: input.challengeRequired }
        : {}),
      ...(input.minSubmitMs !== undefined ? { minSubmitMs: input.minSubmitMs } : {}),
    })
    .returning();
  return row!;
}

/**
 * Write or overwrite the single open draft for a form. The `form_drafts` primary key on
 * `form_id` is what enforces at most one open draft.
 */
export async function upsertDraft(
  exec: Executor,
  input: { formId: FormId; definition: FormDefinition; agentAssisted?: boolean },
): Promise<FormDraftRow> {
  const agentAssisted = input.agentAssisted ?? false;
  const [row] = await exec
    .insert(formDrafts)
    .values({ formId: input.formId, definition: input.definition, agentAssisted })
    .onConflictDoUpdate({
      target: formDrafts.formId,
      // `agent_assisted` is sticky: a later ordinary save must not erase that provenance
      // before a human publishes.
      set: {
        definition: input.definition,
        agentAssisted: sql`${formDrafts.agentAssisted} or ${agentAssisted}`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row!;
}

/** Read the open draft for a form, or `undefined`. */
export async function getDraft(exec: Executor, formId: FormId): Promise<FormDraftRow | undefined> {
  const [row] = await exec.select().from(formDrafts).where(eq(formDrafts.formId, formId)).limit(1);
  return row;
}

/** Delete the open draft for a form. Returns whether a row was removed. */
export async function deleteDraft(exec: Executor, formId: FormId): Promise<boolean> {
  const deleted = await exec
    .delete(formDrafts)
    .where(eq(formDrafts.formId, formId))
    .returning({ formId: formDrafts.formId });
  return deleted.length > 0;
}

/**
 * Freeze the next immutable published version, numbering it atomically.
 *
 * `publishedBy` is the author the two-person release rule compares against and cannot be
 * filled in later. It is optional only for fixture and seeding paths; a null is the
 * "author unknown" case that rule refuses.
 */
export async function insertFormVersion(
  exec: Executor,
  input: {
    formId: FormId;
    definition: FormDefinition;
    compiled: CompiledForm;
    compilerVersion: string;
    a2uiSpecVersion: string;
    semanticsVersion: string;
    publishedAt?: Date;
    publishedBy?: string | null;
  },
): Promise<FormVersionRow> {
  const [row] = await exec
    .insert(formVersions)
    .values({
      formId: input.formId,
      version: sql<number>`(select coalesce(max(${formVersions.version}), 0) + 1 from ${formVersions} where ${formVersions.formId} = ${input.formId})`,
      definition: input.definition,
      compiled: input.compiled,
      compilerVersion: input.compilerVersion,
      a2uiSpecVersion: input.a2uiSpecVersion,
      semanticsVersion: input.semanticsVersion,
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      publishedBy: input.publishedBy ?? null,
    })
    .returning();
  return row!;
}

/** Read one published form version, or `undefined`. */
export async function getFormVersion(
  exec: Executor,
  formId: FormId,
  version: number,
): Promise<FormVersionRow | undefined> {
  const [row] = await exec
    .select()
    .from(formVersions)
    .where(and(eq(formVersions.formId, formId), eq(formVersions.version, version)))
    .limit(1);
  return row;
}

/** The newest published version of a form, or `undefined` if it has never been published. */
export async function getLatestPublishedVersion(
  exec: Executor,
  formId: FormId,
): Promise<FormVersionRow | undefined> {
  const [row] = await exec
    .select()
    .from(formVersions)
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(formVersions.version))
    .limit(1);
  return row;
}

/** All versions of a form, newest first. */
export async function listFormVersions(exec: Executor, formId: FormId): Promise<FormVersionRow[]> {
  return exec
    .select()
    .from(formVersions)
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(formVersions.version));
}

/**
 * Move a form to another workspace; no published version or public address moves with it.
 * The caller must check the target is not archived: `archivedAt` is a rule, not a
 * constraint.
 */
export async function moveFormToWorkspace(
  exec: Executor,
  formId: FormId,
  workspaceId: string,
): Promise<FormRow | undefined> {
  const [row] = await exec
    .update(forms)
    .set({ workspaceId })
    .where(eq(forms.formId, formId))
    .returning();
  return row;
}

/**
 * Update the per-form abuse-control settings. An absent key leaves that column alone, and
 * `minSubmitMs: null` means "use the deployment's configured floor".
 *
 * Deliberately narrow: `slug` and `defaultLocale` are identity and must stay unreachable.
 */
export async function updateFormSettings(
  exec: Executor,
  formId: FormId,
  settings: { challengeRequired?: boolean; minSubmitMs?: number | null },
): Promise<FormRow | undefined> {
  const patch = {
    ...(settings.challengeRequired === undefined
      ? {}
      : { challengeRequired: settings.challengeRequired }),
    ...(settings.minSubmitMs === undefined ? {} : { minSubmitMs: settings.minSubmitMs }),
  };
  // An empty `set` is a SQL syntax error in Drizzle, and saving nothing is legitimate.
  if (Object.keys(patch).length === 0) return getForm(exec, formId);
  const [row] = await exec.update(forms).set(patch).where(eq(forms.formId, formId)).returning();
  return row;
}
