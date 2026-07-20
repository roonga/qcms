import { and, desc, eq, sql } from "drizzle-orm";

import type { CompiledForm } from "@qcms/a2ui-compiler";
import type { FormDefinition, FormId } from "@qcms/core";

import { formDrafts, formVersions, forms } from "../schema/index.js";
import type { Executor } from "./executor.js";

export type FormRow = typeof forms.$inferSelect;
export type FormDraftRow = typeof formDrafts.$inferSelect;
export type FormVersionRow = typeof formVersions.$inferSelect;

/**
 * Read a form identity by its public `slug`, or `undefined`. The anonymous
 * start-session path (018) resolves the respondent-supplied slug to a form here
 * before checking status and picking the newest published version. Shape-
 * preserving read only (R5); `limit(1)` because a slug addresses at most one
 * form (uniqueness is an authoring-time concern, not a DB constraint yet).
 */
export async function getFormBySlug(exec: Executor, slug: string): Promise<FormRow | undefined> {
  const [row] = await exec.select().from(forms).where(eq(forms.slug, slug)).limit(1);
  return row;
}

/** Create a form identity. Defaults to `open` (accepting new sessions). */
export async function createForm(
  exec: Executor,
  input: { formId: FormId; slug: string; defaultLocale: string },
): Promise<FormRow> {
  const [row] = await exec
    .insert(forms)
    .values({ formId: input.formId, slug: input.slug, defaultLocale: input.defaultLocale })
    .returning();
  return row!;
}

/**
 * Write (or overwrite) the single open draft for a form. The `form_drafts`
 * primary key on `form_id` enforces at-most-one-open-draft: the conflict target
 * updates the existing row's `definition` and bumps `updated_at`.
 */
export async function upsertDraft(
  exec: Executor,
  input: { formId: FormId; definition: FormDefinition },
): Promise<FormDraftRow> {
  const [row] = await exec
    .insert(formDrafts)
    .values({ formId: input.formId, definition: input.definition })
    .onConflictDoUpdate({
      target: formDrafts.formId,
      // Use the database clock (like the insert's `defaultNow()`) so the
      // timestamp advances monotonically regardless of client/server skew.
      set: { definition: input.definition, updatedAt: sql`now()` },
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
 * Freeze the next immutable published version (R1, I1, ADR-18) with all version
 * stamps. The version number is assigned atomically by a scalar subquery in the
 * same INSERT; the composite primary key `(formId, version)` is the backstop
 * against a concurrent duplicate.
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

/**
 * The newest published version of a form (new sessions bind to it; §4.1), or
 * `undefined` if the form has never been published.
 */
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

/** Close a form to new sessions (§4.1). In-flight sessions finish on their pinned version (R1). */
export async function closeForm(exec: Executor, formId: FormId): Promise<FormRow | undefined> {
  const [row] = await exec
    .update(forms)
    .set({ status: "closed" })
    .where(eq(forms.formId, formId))
    .returning();
  return row;
}

/** Reopen a closed form to new sessions (§4.1). */
export async function reopenForm(exec: Executor, formId: FormId): Promise<FormRow | undefined> {
  const [row] = await exec
    .update(forms)
    .set({ status: "open" })
    .where(eq(forms.formId, formId))
    .returning();
  return row;
}
