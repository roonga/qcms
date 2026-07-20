import { and, desc, eq, sql } from "drizzle-orm";

import type { CompiledForm } from "@qcms/a2ui-compiler";
import type { FormDefinition, FormId } from "@qcms/core";

import { formDrafts, formStatus, formVersions, forms } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * Form lifecycle status. Derived from the `formStatus` pgEnum (schema/enums.ts)
 * so the union tracks the DB enum automatically - never re-typed as literals.
 */
export type FormStatus = (typeof formStatus.enumValues)[number];

/**
 * The `forms` identity row. Hand-authored (issue #5) because `forms` is
 * enum-bearing (`status`), and Drizzle's `$inferSelect` degrades to a TypeScript
 * `error` type across this package's emitted `.d.ts` boundary - see
 * `schema-drift.ts`. Keep every field in lockstep with the `forms` table in
 * `schema/forms.ts`; the drift guard below fails the build if they diverge.
 */
export interface FormRow {
  formId: FormId;
  slug: string;
  defaultLocale: string;
  status: FormStatus;
  challengeRequired: boolean;
  minSubmitMs: number | null;
}

// Drift guard (issue #5): assert FormRow is structurally identical to what
// Drizzle infers from the `forms` table. `$inferSelect` resolves soundly here in
// the package source; it only degrades through the emitted `.d.ts`. Both
// directions must hold, so any column added, dropped, or retyped in
// schema/forms.ts breaks this instantiation until FormRow is updated to match.
export type _FormRowMatchesTable = AssignableTo<FormRow, typeof forms.$inferSelect> &
  AssignableTo<typeof forms.$inferSelect, FormRow>;

// Enum-free tables: `$inferSelect` is sound through the package boundary.
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

/** Read a form identity by its `formId`, or `undefined`. */
export async function getForm(exec: Executor, formId: FormId): Promise<FormRow | undefined> {
  const [row] = await exec.select().from(forms).where(eq(forms.formId, formId)).limit(1);
  return row;
}

/**
 * Every form identity, newest-created first is not meaningful (no created stamp
 * on the identity row), so ordered by `formId` for a stable listing. The admin
 * library list (022) joins each row against its draft/latest-version state.
 */
export async function listForms(exec: Executor): Promise<FormRow[]> {
  return exec.select().from(forms).orderBy(forms.formId);
}

/**
 * Create a form identity. Defaults to `open` (accepting new sessions) with no
 * abuse-control gates. The optional per-form abuse settings (task 026) may be
 * set here or left to their column defaults (`challengeRequired = false`,
 * `minSubmitMs = NULL` → use the config default floor); the admin builder (034)
 * is their normal authoring path.
 */
export async function createForm(
  exec: Executor,
  input: {
    formId: FormId;
    slug: string;
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
