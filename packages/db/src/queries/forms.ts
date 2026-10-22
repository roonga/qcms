import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
import type { FormDefinition, FormId } from "@roonga/qcms-core";

import { formDrafts, formVersions, forms } from "../schema/index.js";
import type { Executor } from "./executor.js";
import type { AssignableTo } from "./schema-drift.js";

/**
 * A form's lifecycle status **in one environment** (`DOMAIN_SCHEMA.md` §4.1 as amended
 * by Q18): `open` accepts new sessions there, `closed` stops them, and an in-flight
 * session finishes on the version it started either way (R1).
 *
 * **Derived rather than stored, since task 066.** There is no `forms.status` column and
 * no `form_status` enum: the state is the `closed` flag on the newest
 * `control.form_releases` row for the (form, environment) pair, and this union is the
 * two readings of it a screen renders. `getFormEnvironmentState` and
 * `environmentStatesByForm` in `queries/releases.ts` derive it.
 */
export type FormStatus = "open" | "closed";

/**
 * The `forms` identity row. Hand-authored (issue #5) because Drizzle's `$inferSelect`
 * degrades to a TypeScript `error` type across this package's emitted `.d.ts` boundary
 * for a table carrying a `$type<>` brand, which `forms` does through `FormId` - see
 * `schema-drift.ts`. Keep every field in lockstep with the `forms` table in
 * `schema/control/forms.ts`; the drift guard below fails the build if they diverge.
 *
 * **No `status`, since task 066** (Q18): the closed state is per (form, environment) and
 * is read from the release state. See {@link FormStatus}.
 */
export interface FormRow {
  formId: FormId;
  slug: string;
  /** The workspace that owns this form (ADR-41, task 068). Never null. */
  workspaceId: string;
  defaultLocale: string;
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
 * before reading the environment's release state - which carries both the closed
 * reading and the released version (Q18). Shape-preserving read only (R5);
 * `limit(1)` because a slug addresses **exactly** one form: `forms_slug_unique` since
 * task 068 (criterion 3), where this comment used to say uniqueness was an
 * authoring-time concern and not a database constraint yet. The `limit(1)` stays as the
 * statement's shape rather than as what makes the answer single.
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
export async function listForms(
  exec: Executor,
  options: { readonly workspaceIds?: readonly string[] } = {},
): Promise<FormRow[]> {
  // `workspaceIds` is the confidentiality boundary ADR-41 draws between two groups
  // sharing one installation (task 069): the library list is narrowed to the workspaces
  // the caller holds `form: read` in, so a `forms.viewer` in one workspace never sees
  // another group's forms. `undefined` is the whole installation, which is what the
  // installation-wide claim and the operator CLIs read.
  //
  // An **empty** list is an empty result rather than the whole table, which is the
  // fail-closed direction: a caller who holds the act nowhere sees nothing, and a filter
  // that treated "no workspaces" as "every workspace" would be the one bug this argument
  // exists to prevent.
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

/**
 * Create a form identity. Defaults to `open` (accepting new sessions) with no
 * abuse-control gates. The optional per-form abuse settings (task 026) may be
 * set here or left to their column defaults (`challengeRequired = false`,
 * `minSubmitMs = NULL` → use the config default floor); the admin builder's
 * settings panel (033) is their normal authoring path, via `updateFormSettings`.
 *
 * `workspaceId` is **required and has no default** (ADR-41, task 068, criterion 1): a
 * form belongs to exactly one workspace and nothing here guesses which. Resolving it -
 * from the request, or from the installation's single workspace - is the API's
 * (`apps/api/src/features/workspaces/resolve.ts`), because a default chosen in a query
 * helper is a default no caller can see.
 */
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
 * Write (or overwrite) the single open draft for a form. The `form_drafts`
 * primary key on `form_id` enforces at-most-one-open-draft: the conflict target
 * updates the existing row's `definition` and bumps `updated_at`.
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
      // Use the database clock (like the insert's `defaultNow()`) so the
      // timestamp advances monotonically regardless of client/server skew.
      //
      // `agent_assisted` is sticky (041): once a draft has accepted an
      // agent-assisted proposal, an ordinary later save must not quietly erase
      // that provenance before the human publishes. Discarding the draft clears
      // it, because that removes the row.
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
 * Freeze the next immutable published version (R1, I1, ADR-18) with all version
 * stamps. The version number is assigned atomically by a scalar subquery in the
 * same INSERT; the composite primary key `(formId, version)` is the backstop
 * against a concurrent duplicate.
 *
 * `publishedBy` is **the author the two-person rule compares against** (Q51, task 070): the
 * account that published this version, frozen with the snapshot because the table is
 * append-only and no later write can fill it in. It is optional on the input for the
 * fixtures and seeding paths that publish without an administrator principal; both admin
 * publish routes always pass it, and a null is the "author unknown" case the release rule
 * refuses rather than waves through.
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

/**
 * Move a form to another workspace: one `UPDATE` on the identity row (ADR-41, task 068).
 *
 * The same shape as Q14's question move and for the same reason: ownership is a property
 * of the `formId` and not of a version, so no published version changes hands, no
 * compiled document is touched and no public address moves (criterion 7). The slug does
 * not move either, because slugs are unique installation-wide rather than per workspace,
 * which is exactly what spares an ownership change from re-pointing a live link.
 *
 * Returns the updated row, or `undefined` when no such form exists. Whether the target
 * workspace exists and is not archived is the caller's check: the foreign key catches a
 * workspace that is not there, and `archivedAt` is a rule rather than a constraint.
 *
 * Every form has to be reachable this way, because reassignment is what makes an archive
 * possible at all (criterion 4): archiving is the last step and never a cascade, so the
 * forms leave first.
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

/*
 * `closeForm` and `reopenForm` are gone, since task 066 (Q18). Closing is per
 * (form, environment) and appends to the release state:
 * `closeFormInEnvironment` / `reopenFormInEnvironment` in `queries/releases.ts`.
 */

/**
 * Update the per-form abuse-control settings (task 026's domain config, ADR-24
 * tier 2), as the form builder's settings panel edits them (033).
 *
 * A partial update: an absent key leaves that column alone, so the panel can save
 * one switch without echoing the other back. `minSubmitMs: null` is a real value
 * and means "use the deployment's configured floor", which is why it is expressed
 * as an explicit `null` rather than by omission.
 *
 * Deliberately narrow. `slug` and `defaultLocale` are also columns on this row and are
 * **not** reachable here: they are identity an author names once, and a settings panel
 * that could rewrite a live form's slug is a different feature with different
 * consequences. The closed state is not a column on this row at all since task 066 -
 * it is per environment, with its own doors (`closeFormInEnvironment` /
 * `reopenFormInEnvironment`).
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
  // An empty `set` is a SQL syntax error in Drizzle, and "save nothing" is a
  // legitimate call from a panel whose fields are all unchanged: answer it with
  // the current row rather than a 500.
  if (Object.keys(patch).length === 0) return getForm(exec, formId);
  const [row] = await exec.update(forms).set(patch).where(eq(forms.formId, formId)).returning();
  return row;
}
