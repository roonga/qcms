/**
 * Admin form-authoring handlers (task 022, DOMAIN_SCHEMA §4.1).
 *
 * Draft CRUD is honest transaction script (R5); **publish is the aggregate** -
 * the one slice that loads the pinned question versions, calls `compileDraft`
 * (008) to freeze an immutable snapshot, projects it to A2UI with `compileForm`
 * (011), and persists version + compiled + stamps in **one transaction**
 * alongside the `form.published` outbox event and the draft's deletion. This is
 * where the kernel, the compiler, and storage meet for the first time.
 *
 * Immutability (R1, I1, ADR-18): a published `form_versions` row is frozen - the
 * `form_versions_reject_update` trigger (migration 0001) is the storage
 * backstop, and this slice never issues an UPDATE against it. Publish compiles
 * **once** and stores the result; the serve path (019) reads the stored compiled
 * A2UI and must never recompile (ADR-18) - this slice is the *only* caller of
 * `compileForm`.
 *
 * Fetch-pure (R4): time is `deps.clock`, no `node:*`. Answer values are never
 * handled here, so nothing content-bearing is ever logged (SEC-8).
 *
 * Row types come straight from `@roonga/qcms-db`: the enum-bearing `forms` and
 * `question_versions` rows are now hand-authored and sound across the package
 * boundary (issue #5), so this slice reads them by inference with no local view
 * or cast. The enum-free `form_drafts`/`form_versions` rows are used directly as
 * well.
 */

import type { RouteHandler, z } from "@hono/zod-openapi";
import { compileForm } from "@roonga/qcms-a2ui-compiler";
import {
  type AnswerKey,
  answerKey,
  type AnswerMap,
  type AnswerValue,
  compileDraft,
  countBounds,
  type DraftInput,
  evaluateRules,
  type FormDefinition,
  type FormId,
  type FrozenSnapshot,
  type GroupId,
  type InstanceId,
  isStepId,
  parseAnswerValue,
  parseFormDefinition,
  parseFormId,
  parseInstanceId,
  parseLocaleCode,
  parseQuestionId,
  type PublishError,
  type PublishWarning,
  type QuestionId,
  type QuestionRef,
  type QuestionVersionRecord,
  type RepeatGroup,
  repeatGroups,
  type ResolveQuestion,
  type ResolveQuestionVersion,
  type RosterMap,
  ruleReferences,
  ruleGroupReferences,
  type StepId,
  type VisibilityRule,
  questionGroups,
  stepQuestionRefs,
} from "@roonga/qcms-core";
import {
  closeForm,
  createForm,
  deleteDraft,
  enqueue,
  getDraft,
  getForm,
  getFormVersion,
  getLatestPublishedVersion,
  insertFormVersion,
  listForms,
  listFormVersions,
  listQuestionVersions,
  type QuestionStatus,
  reopenForm,
  updateFormSettings,
  upsertDraft,
} from "@roonga/qcms-db";
import type { Executor, FormDraftRow } from "@roonga/qcms-db";

import { challengeEnforceable } from "../../config.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type {
  closeFormRoute,
  createFormRoute,
  getFormRoute,
  getFormVersionRoute,
  listFormsRoute,
  previewConditionRoute,
  previewDraftRoute,
  publishFormRoute,
  putDraftRoute,
  reopenFormRoute,
  updateFormSettingsRoute,
  validateDraftRoute,
} from "./route.js";
import type { ListFormsQuery } from "./schema.js";

/** The outbox event type for a completed publish (ARCHITECTURE §5.3, §11). */
const FORM_PUBLISHED = "form.published" as const;

/**
 * A publish issue: the kernel's typed `PublishError` (008) *or* the slice-level
 * `DEPRECATED_PIN` - a new-or-moved pin to a deprecated question version, which
 * publish rejects but the kernel does not model (it only knows published/not).
 * The admin UI (034) renders the union verbatim; `DEPRECATED_PIN` carries the
 * same structured-path shape so it renders uniformly.
 */
interface DeprecatedPinIssue {
  readonly code: "DEPRECATED_PIN";
  readonly message: string;
  readonly path: { readonly step: StepId; readonly question: QuestionId; readonly version: number };
}
export type PublishIssue = PublishError | DeprecatedPinIssue;
/**
 * Re-exported so the assist slice (041) takes the advisory contract from the one
 * place that produces it, rather than importing half of it from here and half
 * from `@roonga/qcms-core` and letting the two drift.
 */
export type { PublishWarning };

// --- typed failures (envelope codes the admin app keys off, 032) ------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_FORM_ID", 400, "Malformed form id"),
  invalidLocale: (): ApiError =>
    new ApiError("INVALID_DEFAULT_LOCALE", 400, "Malformed default locale"),
  invalidDefinition: (issues: readonly unknown[]): ApiError =>
    new ApiError("INVALID_FORM_DEFINITION", 422, "The form definition is invalid", { issues }),
  idMismatch: (): ApiError =>
    new ApiError(
      "FORM_ID_MISMATCH",
      422,
      "The definition's formId does not match the path id (identity is fixed)",
    ),
  idTaken: (): ApiError =>
    new ApiError("FORM_ID_TAKEN", 409, "This formId is already in use (ids are never reused)"),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  noDraft: (): ApiError => new ApiError("NO_DRAFT", 409, "This form has no open draft to publish"),
  versionNotFound: (): ApiError => new ApiError("VERSION_NOT_FOUND", 404, "No such form version"),
  publishRejected: (issues: readonly PublishIssue[]): ApiError =>
    new ApiError("PUBLISH_REJECTED", 422, "The draft cannot be published", { issues }),
  previewRejected: (issues: readonly PublishIssue[]): ApiError =>
    new ApiError("PREVIEW_REJECTED", 422, "The draft cannot be previewed", { issues }),
  // A draft that compiled cleanly but whose rules could not be evaluated. Kept
  // distinct from `previewRejected` because the two ask different things of the
  // screen: one is a work list, the other has nothing to list. Carrying no
  // `details.issues` at all - rather than an empty array - is what stops the
  // admin rendering "the reasons are listed below" above nothing.
  previewUnavailable: (): ApiError =>
    new ApiError(
      "PREVIEW_UNAVAILABLE",
      422,
      "The draft compiled, but its rules could not be evaluated for these answers",
    ),
} as const;

// The rule test bench deliberately adds no failure codes here. Everything it
// cannot answer (an unparseable draft, an unknown ruleId, an unresolvable target,
// answers it cannot evaluate) comes back as a 200 `unavailable` verdict carrying
// a typed `reason`: one error channel, because the bench is a read-only aid over
// a draft that is legitimately half-built and those states are ordinary, not
// exceptional.

// --- shared helpers ---------------------------------------------------------

/** Parse a `:id` path param to a FormId, or 400. */
function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

/**
 * The largest value a version number can take: `form_versions.version` is an
 * `int4` column, so nothing above this can name a stored row (issue #645).
 * Without the bound the guard passed the segment straight to Postgres, which
 * refused the parameter with "value out of range for type integer" - an
 * unexpected throw, so a caller who typed too many digits got a 500 instead of
 * the 404 the same URL earns one digit shorter.
 */
const MAX_VERSION = 2_147_483_647;

/** Parse a `:v` path param to an in-range positive integer, or 404 (no such version). */
function requireVersion(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VERSION) throw fail.versionNotFound();
  return n;
}

/** Validate an opaque definition body through the kernel (422 on failure). */
function requireDefinition(value: unknown): FormDefinition {
  const parsed = parseFormDefinition(value);
  if (!parsed.ok) throw fail.invalidDefinition(parsed.error);
  return parsed.value;
}

/**
 * The draft-save leg of `PUT /admin/forms/:id/draft`, minus the response.
 *
 * Exported for 041's accept (issue #823), which stores the accepted draft in the
 * **same transaction** that materialises the proposal's new questions. Taking an
 * `Executor` rather than reaching for `deps.db` is what lets that transaction be
 * the caller's: the slice owns the boundary, never the helper (R5).
 *
 * The parse is the caller's, deliberately. Accept validates every proposed
 * question *and* the draft before it opens a transaction, so a refusal costs no
 * database work and cannot leave a half-written accept behind.
 */
export async function storeDraftDefinition(
  exec: Executor,
  formId: FormId,
  definition: FormDefinition,
  agentAssisted: boolean,
): Promise<FormDraftRow> {
  // Identity is fixed: a draft save cannot repoint the form's id.
  if (definition.formId !== formId) throw fail.idMismatch();

  const form = await getForm(exec, formId);
  if (form === undefined) throw fail.formNotFound();

  return upsertDraft(exec, { formId, definition, agentAssisted });
}

/** {@link requireDefinition}, exported under a name that says which definition. */
export const requireFormDefinition = requireDefinition;

/** Key a pin by identity + version. */
function pinKey(questionId: QuestionId, version: number): string {
  return `${questionId} ${String(version)}`;
}

/** Locate a pin by step + identity + version (a "carried-over" placement). */
function placementKey(stepId: StepId, questionId: QuestionId, version: number): string {
  return `${stepId} ${questionId} ${String(version)}`;
}

/** Every distinct questionId pinned anywhere in a definition. */
function pinnedQuestionIds(definition: FormDefinition): Set<QuestionId> {
  const ids = new Set<QuestionId>();
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) ids.add(item.questionId);
  }
  return ids;
}

/**
 * The publish lookups `compileDraft` needs, built from the caller's question
 * store (R3): a `resolveQuestion` over every pinned version and the map of
 * *published* versions per question. Also returns each pinned version's status,
 * so the deprecated-pin gate can tell a published pin from a deprecated one.
 */
async function loadQuestionLookups(
  deps: Deps,
  definition: FormDefinition,
): Promise<{
  resolveQuestion: ResolveQuestionVersion;
  publishedQuestionVersions: Map<QuestionId, Set<number>>;
  statusByPin: Map<string, QuestionStatus>;
}> {
  const recordByPin = new Map<string, QuestionVersionRecord>();
  const statusByPin = new Map<string, QuestionStatus>();
  const publishedQuestionVersions = new Map<QuestionId, Set<number>>();

  for (const questionId of pinnedQuestionIds(definition)) {
    const rows = await listQuestionVersions(deps.db, questionId);
    const published = new Set<number>();
    for (const row of rows) {
      const key = pinKey(row.questionId, row.version);
      recordByPin.set(key, {
        questionId: row.questionId,
        version: row.version,
        definition: row.definition,
      });
      statusByPin.set(key, row.status);
      if (row.status === "published") published.add(row.version);
    }
    publishedQuestionVersions.set(questionId, published);
  }

  const resolveQuestion: ResolveQuestionVersion = (questionId, version) =>
    recordByPin.get(pinKey(questionId, version));
  return { resolveQuestion, publishedQuestionVersions, statusByPin };
}

/**
 * The deprecated-pin gate (DOMAIN_SCHEMA §4.1/§4.2 lifecycle). A deprecated
 * question version may **stay** pinned only if the exact placement
 * `(step, question, version)` was already in the previous published version - a
 * carried-over pin the author did not touch. A *new* pin (no prior published
 * version, or this placement is not in it) or a *moved* pin (same version, but
 * now in a different step) to a deprecated version is rejected `DEPRECATED_PIN`.
 *
 * Every pinned deprecated version is added to `publishedQuestionVersions` so
 * `compileDraft` treats it as resolvable published-once content (a deprecated
 * version is real, immutable content - not an unpublished draft), leaving this
 * gate the sole author of the deprecation verdict: a rejected pin is reported
 * once, as `DEPRECATED_PIN`, never doubled as `UNPUBLISHED_QUESTION_PIN`.
 */
function deprecatedPinGate(
  definition: FormDefinition,
  previousDefinition: FormDefinition | undefined,
  statusByPin: ReadonlyMap<string, QuestionStatus>,
  publishedQuestionVersions: Map<QuestionId, Set<number>>,
): DeprecatedPinIssue[] {
  const carried = new Set<string>();
  if (previousDefinition !== undefined) {
    for (const step of previousDefinition.steps) {
      for (const item of stepQuestionRefs(step)) {
        carried.add(placementKey(step.stepId, item.questionId, item.version));
      }
    }
  }

  const issues: DeprecatedPinIssue[] = [];
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) {
      if (statusByPin.get(pinKey(item.questionId, item.version)) !== "deprecated") continue;
      // Deprecated content is still valid content for compileDraft to resolve.
      publishedQuestionVersions.get(item.questionId)?.add(item.version);
      if (!carried.has(placementKey(step.stepId, item.questionId, item.version))) {
        issues.push({
          code: "DEPRECATED_PIN",
          message: `Step "${step.stepId}" pins question "${item.questionId}"@${String(item.version)}, a deprecated version, as a new or moved pin`,
          path: { step: step.stepId, question: item.questionId, version: item.version },
        });
      }
    }
  }
  return issues;
}

/**
 * Run the full publish validation in dry-run: the deprecated-pin gate plus
 * `compileDraft` (008). Returns every issue (all errors, never first-only),
 * every non-blocking warning, and - when the draft is clean - the frozen
 * snapshot ready to compile and persist. Shared by the advisory paths (PUT
 * draft, validate) and publish itself.
 *
 * `warnings` is empty whenever the **kernel** reports errors, and that is the
 * real invariant: `compileDraft` advises only on a draft it could compile, so a
 * kernel error suppresses every warning (issue #123).
 *
 * It is **not** true that a warning cannot appear beside an issue. `issues` also
 * carries this layer's `DEPRECATED_PIN` findings, so a draft that moves a pin
 * onto a deprecated version *and* reveals a same-step question from a
 * multiChoice answer has both facts and reports both. That coexistence is
 * deliberate rather than tolerated: suppressing the advisory because an
 * unrelated deprecation is open would drop information the author needs, and
 * would make the warning list depend on which *other* problems happen to exist.
 *
 * A warning never contributes to the refusal decision either way, which is why
 * every caller below tests `issues` rather than a combined count.
 */
export async function validateDraft(
  deps: Deps,
  definition: FormDefinition,
): Promise<{
  issues: PublishIssue[];
  warnings: readonly PublishWarning[];
  snapshot?: FrozenSnapshot;
}> {
  const { resolveQuestion, publishedQuestionVersions, statusByPin } = await loadQuestionLookups(
    deps,
    definition,
  );
  const previous = await getLatestPublishedVersion(deps.db, definition.formId);
  const previousDefinition: FormDefinition | undefined = previous?.definition;

  const deprecatedIssues = deprecatedPinGate(
    definition,
    previousDefinition,
    statusByPin,
    publishedQuestionVersions,
  );

  const draft: DraftInput = { definition, resolveQuestion, publishedQuestionVersions };
  const result = compileDraft(draft);
  const issues: PublishIssue[] = [...deprecatedIssues, ...(result.ok ? [] : result.error)];
  return {
    issues,
    warnings: result.ok ? result.value.warnings : [],
    ...(result.ok ? { snapshot: result.value.snapshot } : {}),
  };
}

/** True for a Postgres unique-violation (SQLSTATE 23505) on the id/cause. */
function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

// --- POST /admin/forms ------------------------------------------------------

export function makeCreateFormHandler(deps: Deps): RouteHandler<typeof createFormRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const parsedId = parseFormId(body.formId);
    if (!parsedId.ok) throw fail.invalidId();
    const formId = parsedId.value;
    const locale = parseLocaleCode(body.defaultLocale);
    if (!locale.ok) throw fail.invalidLocale();

    // An empty draft: the minimal working state an author fills in via PUT. It
    // is deliberately not a *publishable* FormDefinition (no steps yet) - publish
    // re-parses it (004) and rejects until real content is saved.
    const emptyDraft: FormDefinition = {
      formId,
      defaultLocale: locale.value,
      title: {},
      steps: [],
      rules: [],
    };

    const created = await deps.db.transaction(async (tx) => {
      try {
        await createForm(tx, { formId, slug: body.slug, defaultLocale: locale.value });
      } catch (err: unknown) {
        // formId is the primary key: a collision is a reused id, a clean 409.
        if (isUniqueViolation(err)) throw fail.idTaken();
        throw err;
      }
      await upsertDraft(tx, { formId, definition: emptyDraft });
      return emptyDraft;
    });

    return c.json(
      {
        formId,
        slug: body.slug,
        defaultLocale: locale.value,
        status: "open" as const,
        draft: created,
      },
      201,
    );
  };
}

// --- GET /admin/forms -------------------------------------------------------

export function makeListFormsHandler(deps: Deps): RouteHandler<typeof listFormsRoute, ApiEnv> {
  return async (c) => {
    const { status, search, sort } = c.req.valid("query");
    const rows = await listForms(deps.db);

    // The status filter is the identity row's own column, so it narrows before the
    // per-row reads below rather than after them: a closed-only list of a library of
    // fifty forms should not pay for fifty drafts.
    const byStatus = status === undefined ? rows : rows.filter((row) => row.status === status);

    // One draft/version read per row is fine at launch admin scale (R7); a
    // denormalized status column is a Phase-4 optimization, not a launch need.
    const assembled = [];
    for (const row of byStatus) {
      const draft = await getDraft(deps.db, row.formId);
      const latest = await getLatestPublishedVersion(deps.db, row.formId);
      assembled.push({
        row: {
          formId: row.formId,
          slug: row.slug,
          defaultLocale: row.defaultLocale,
          status: row.status,
          hasDraft: draft !== undefined,
          latestVersion: latest === undefined ? null : latest.version,
          publishedAt: latest === undefined ? null : latest.publishedAt.toISOString(),
        },
        // Beside the row rather than in it: the title is read for the search only, from
        // the definitions the two reads above already loaded, and the response carries
        // no title field. The list screen shows the slug, and adding a title column to
        // it is a change to which columns the table carries rather than a change to how
        // it is filtered, so the search reaches further than the table does.
        title: titleOf(draft?.definition ?? latest?.definition),
      });
    }

    // Search matches the slug or any locale of the form title, which is the question
    // library's rule with `label` swapped for `title`. The author's own draft title
    // wins over the published one when both exist: a rename that has not been
    // published yet is still what the author is looking for.
    const needle = search?.trim().toLowerCase();
    const matched =
      needle === undefined || needle === ""
        ? assembled
        : assembled.filter(
            (entry) =>
              entry.row.slug.toLowerCase().includes(needle) || titleMatches(entry.title, needle),
          );

    return c.json({ forms: sortForms(matched, sort ?? "slug-asc").map((entry) => entry.row) }, 200);
  };
}

/** The localized title carried by any form definition (used for list search). */
function titleOf(definition: FormDefinition | undefined): unknown {
  return definition === undefined ? undefined : (definition as { title?: unknown }).title;
}

/** Substring-match a needle against any locale value of a localized title. */
function titleMatches(title: unknown, needle: string): boolean {
  if (title === null || typeof title !== "object") return false;
  return Object.values(title as Record<string, unknown>).some(
    (value) => typeof value === "string" && value.toLowerCase().includes(needle),
  );
}

/** The two fields an order is decided on, whatever else the assembled row carries. */
interface Orderable {
  readonly row: { readonly slug: string; readonly publishedAt: string | null };
}

/**
 * Order the library (issue 686).
 *
 * `slug-asc` is the default because the slug is what the list's identifying column
 * shows and what an author names a form by; the previous order was `forms.form_id`,
 * which is an id column nothing on the screen reads.
 *
 * A form that was never published has no publish date, so it cannot take a position
 * on a publish-date axis. Rather than invent one (treating it as the epoch would put
 * every unpublished form at the top of "oldest published", which answers a question
 * nobody asked), unpublished rows go **last in both directions** and are ordered
 * among themselves by slug. Every comparison falls back to the slug, so the order is
 * total and two renders of the same library never disagree.
 */
function sortForms<T extends Orderable>(rows: readonly T[], sort: SortKey): T[] {
  const bySlug = (a: T, b: T): number => a.row.slug.localeCompare(b.row.slug);
  const byPublished = (a: T, b: T, newestFirst: boolean): number => {
    const left = a.row.publishedAt;
    const right = b.row.publishedAt;
    if (left === null || right === null) {
      if (left === right) return bySlug(a, b);
      return left === null ? 1 : -1;
    }
    if (left === right) return bySlug(a, b);
    const oldestFirst = left < right ? -1 : 1;
    return newestFirst ? -oldestFirst : oldestFirst;
  };
  const sorted = [...rows];
  switch (sort) {
    case "slug-asc":
      return sorted.sort(bySlug);
    case "slug-desc":
      return sorted.sort((a, b) => bySlug(b, a));
    case "published-desc":
      return sorted.sort((a, b) => byPublished(a, b, true));
    case "published-asc":
      return sorted.sort((a, b) => byPublished(a, b, false));
  }
}

/** The orders `GET /admin/forms` guarantees, from the route's own query schema. */
type SortKey = NonNullable<z.infer<typeof ListFormsQuery>["sort"]>;

// --- GET /admin/forms/:id ---------------------------------------------------

export function makeGetFormHandler(deps: Deps): RouteHandler<typeof getFormRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);

    const form = await getForm(deps.db, formId);
    if (form === undefined) throw fail.formNotFound();

    const versions = await listFormVersions(deps.db, formId);
    const openDraft = await getDraft(deps.db, formId);

    // The draft the editor opens: the open draft if one exists, otherwise seeded
    // from the latest published version (§4.1 "new draft opened, seeded from vN")
    // - a read-time convenience, not persisted until the author saves (PUT).
    let draft: FormDefinition | null = null;
    let draftSource: "open" | "seeded" | "none" = "none";
    if (openDraft !== undefined) {
      draft = openDraft.definition;
      draftSource = "open";
    } else if (versions.length > 0) {
      draft = versions[0]!.definition; // listFormVersions is newest-first
      draftSource = "seeded";
    }

    return c.json(
      {
        formId: form.formId,
        slug: form.slug,
        defaultLocale: form.defaultLocale,
        status: form.status,
        draft,
        draftSource,
        draftAgentAssisted: openDraft?.agentAssisted ?? false,
        draftUpdatedAt: openDraft?.updatedAt.toISOString() ?? null,
        versions: versions.map((v) => ({
          version: v.version,
          publishedAt: v.publishedAt.toISOString(),
          compilerVersion: v.compilerVersion,
          a2uiSpecVersion: v.a2uiSpecVersion,
          semanticsVersion: v.semanticsVersion,
        })),
        // The abuse-control settings ride the detail read (033's settings panel)
        // rather than getting a GET of their own: they live on the identity row
        // this handler has already loaded, and a panel that needed a second round
        // trip to render one switch would be a worse screen for no gain.
        settings: {
          challengeRequired: form.challengeRequired,
          minSubmitMs: form.minSubmitMs,
        },
        // A derived boolean, never the provider name: ADR-24 says clients
        // receive behavior, not flag values. It rides along on the read so the
        // panel can warn on load that `challengeRequired` is unenforceable
        // (033), rather than only discovering it after a write.
        challengeEnforceable: challengeEnforceable(deps.config.flags),
      },
      200,
    );
  };
}

// --- PUT /admin/forms/:id/draft ---------------------------------------------

export function makePutDraftHandler(deps: Deps): RouteHandler<typeof putDraftRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const definition = requireDefinition(c.req.valid("json").definition);

    // Save first (drafts may be temporarily inconsistent), then advise. Advisory
    // issues do not block the save; they block publish.
    //
    // 041: an accepted agent proposal marks the draft's provenance. Sticky in
    // the query, so a plain save after one never clears the mark.
    const saved = await storeDraftDefinition(
      deps.db,
      formId,
      definition,
      c.req.valid("json").agentAssisted ?? false,
    );
    const { issues, warnings } = await validateDraft(deps, definition);

    return c.json(
      {
        draft: definition,
        issues,
        warnings: [...warnings],
        agentAssisted: saved.agentAssisted,
        updatedAt: saved.updatedAt.toISOString(),
      },
      200,
    );
  };
}

// --- POST /admin/forms/:id/draft/validate -----------------------------------

export function makeValidateDraftHandler(
  deps: Deps,
): RouteHandler<typeof validateDraftRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const definition = requireDefinition(c.req.valid("json").definition);
    if (definition.formId !== formId) throw fail.idMismatch();

    const form = await getForm(deps.db, formId);
    if (form === undefined) throw fail.formNotFound();

    // `valid` keys off errors alone: a warning describes a draft that would
    // publish, so counting it here would refuse on advice (issue #123).
    const { issues, warnings } = await validateDraft(deps, definition);
    return c.json({ valid: issues.length === 0, issues, warnings: [...warnings] }, 200);
  };
}

// --- hypothetical rosters, shared by both admin preview routes (074) --------

/** The roster an admin preview evaluated with, in both shapes it is needed in. */
interface Hypothetical {
  /** What `evaluateRules` takes as its fourth parameter. */
  readonly rosters: RosterMap;
  /** What the response echoes, so the panel can state what it answered about. */
  readonly projection: { groupId: string; instances: string[] }[];
}

/**
 * Turn the caller's hypothetical instance ids into a roster the evaluator will take.
 *
 * ## Why a preview has to be handed a roster at all
 *
 * `evaluateRules` takes the live roster as a parameter rather than deriving it from the
 * answer keys, and ADR-42 gives the reason: an instance a respondent has added and not yet
 * answered would not exist in a derived roster, so "Add passenger" would do nothing visible.
 * The roster is state the SERVER owns at serve time, out of `answer_group_instances`. An
 * admin preview has no session and therefore no such state, so the author's screen mints one
 * - from the group's own `min`, or from a count the author types - and sends it (section 6.5).
 *
 * ## What this refuses, and what it quietly drops
 *
 * A group the definition does not declare contributes nothing: that is `DANGLING_GROUP_REF`
 * at publish, a refusal with its own sentence, and inventing a roster for it here would make
 * a rule reading a non-existent group appear to work in the preview and fail at publish.
 *
 * An id that is not a well-formed `InstanceId` is dropped rather than refused, because the
 * one thing it can be is a caller bug and the honest rendering of it is an instance that is
 * not there. Duplicates are dropped too: roster ORDER is meaning (ADR-42 widens I7's
 * determinism statement to include it), and a repeated id would make one instance appear
 * twice in a walk that is supposed to visit each once.
 *
 * The list is **truncated at the group's declared maximum**, which is not belt-and-braces
 * tidiness: a preview showing ten instances of a group whose `max` is nine would be a claim
 * about a page no respondent can reach, and the API is where the bound is known from the
 * pinned definition rather than from anything the caller said. A `fixed` count is its own
 * bound, so it truncates at the count.
 */
function hypotheticalRosters(
  definition: FormDefinition,
  supplied: Readonly<Record<string, readonly string[]>> | undefined,
): Hypothetical {
  const rosters = new Map<GroupId, readonly InstanceId[]>();
  const projection: { groupId: string; instances: string[] }[] = [];
  for (const group of repeatGroups(definition.steps)) {
    const instances = rosterFor(group, supplied?.[group.groupId] ?? []);
    rosters.set(group.groupId, instances);
    projection.push({ groupId: group.groupId, instances: [...instances] });
  }
  return { rosters, projection };
}

function rosterFor(group: RepeatGroup, asked: readonly string[]): readonly InstanceId[] {
  const seen = new Set<string>();
  const instances: InstanceId[] = [];
  const max = countBounds(group.count).max;
  for (const candidate of asked) {
    if (max !== undefined && instances.length >= max) break;
    if (seen.has(candidate)) continue;
    const parsed = parseInstanceId(candidate);
    if (!parsed.ok) continue;
    seen.add(candidate);
    instances.push(parsed.value);
  }
  return instances;
}

/**
 * Read the caller's hypothetical answers into an `AnswerMap`, keyed the way the evaluator
 * keys them.
 *
 * A bare `questionId` for a question outside every repeating group, byte-identically to what
 * both routes always accepted, and `instanceId/questionId` for a question inside one. Three
 * things are checked for a qualified key, and each of them closes a way for the preview to
 * disagree with what a respondent would get:
 *
 * 1. the question is pinned by the definition at all (the same check a bare key gets);
 * 2. it is pinned INSIDE the group the instance belongs to, so an answer cannot be smuggled
 *    into an instance of a group that does not hold that question;
 * 3. the instance is in that group's roster, which is the same "is this instance live"
 *    precondition `SEC-16` puts on every real answer write.
 *
 * `onUnreadable` is how the two routes differ, and they differ for a stated reason. The bench
 * declines the whole request (`unresolvedAnswers`) rather than treating a malformed relevant
 * value as unanswered and reporting a confident `noMatch` the author would have to debug. The
 * preview skips, because its values arrive from the shared renderer and an unreadable one
 * means the author changed the draft under their own answers - whose honest rendering is a
 * question reading as unanswered, not a pane that goes blank while they edit.
 *
 * SEC-13 / ADR-34: these are answer-shaped values. Read here, never logged, never persisted,
 * never echoed into a response or an error message.
 */
function collectKeyedAnswers(
  supplied: Readonly<Record<string, unknown>> | undefined,
  definition: FormDefinition,
  pins: ReadonlyMap<QuestionId, number>,
  rosters: RosterMap,
  onUnreadable: "skip" | "refuse",
): AnswerMap | undefined {
  const groupOf = questionGroups(definition.steps);
  const answers = new Map<AnswerKey, AnswerValue>();
  for (const [key, value] of Object.entries(supplied ?? {})) {
    if (value === undefined) continue;
    const resolved = resolveAnswerKey(key, pins, rosters, groupOf);
    if (resolved === undefined) continue;
    const answer = parseAnswerValue(value);
    if (!answer.ok) {
      if (onUnreadable === "refuse") return undefined;
      continue;
    }
    answers.set(resolved, answer.value);
  }
  return answers;
}

/** One supplied key as an evaluator key, or `undefined` when it names nothing answerable. */
function resolveAnswerKey(
  key: string,
  pins: ReadonlyMap<QuestionId, number>,
  rosters: RosterMap,
  groupOf: ReadonlyMap<QuestionId, GroupId>,
): AnswerKey | undefined {
  const cut = key.indexOf("/");
  if (cut < 0) {
    const questionId = parseQuestionId(key);
    // A question INSIDE a group answered by its bare id is dropped rather than accepted: it
    // has one answer per instance and no single value, so there is no instance the value
    // could belong to. Accepting it would put a key in the map the evaluator never reads.
    if (!questionId.ok || !pins.has(questionId.value)) return undefined;
    return groupOf.has(questionId.value) ? undefined : questionId.value;
  }
  const instanceId = parseInstanceId(key.slice(0, cut));
  const questionId = parseQuestionId(key.slice(cut + 1));
  if (!instanceId.ok || !questionId.ok || !pins.has(questionId.value)) return undefined;
  const groupId = groupOf.get(questionId.value);
  if (groupId === undefined) return undefined;
  if (!(rosters.get(groupId) ?? []).includes(instanceId.value)) return undefined;
  return answerKey(questionId.value, instanceId.value);
}

// --- POST /admin/forms/:id/draft/preview-condition --------------------------

/**
 * The two synthetic step ids the bench form carries. The bench form is built,
 * evaluated, and thrown away inside one request: it is never persisted, never
 * pinned, and never published, so these cannot collide with authored ids in
 * storage (R6).
 */
// Cast justification (both): string literals written to the `stp_[a-z0-9_]+` id
// grammar, so the brand is a compile-time label over a value that is correct by
// construction. Parsing them would be a runtime check of a constant.
const BENCH_READS_STEP_ID = "stp_bench_reads" as StepId;
const BENCH_TARGET_STEP_ID = "stp_bench_target" as StepId;

/** Why the bench could not answer. The response's single failure channel. */
type PreviewReason = "unparseableDraft" | "ruleNotFound" | "noTarget" | "unresolvedAnswers";

/** The preview response body, shaped once so every exit agrees on it. */
interface PreviewVerdict {
  readonly ruleId: string;
  readonly references: string[];
  readonly outcome: "match" | "noMatch" | "unavailable";
  readonly reason?: PreviewReason;
  readonly rosters: { groupId: string; instances: string[] }[];
}

/**
 * An "I cannot answer that" verdict. Tri-state `outcome` plus a typed `reason`,
 * never a nullable boolean: the panel must be able to tell "could not evaluate"
 * from a real "no match", and a half-built draft makes the former ordinary.
 *
 * The roster rides on this exit too, and deliberately: a panel showing three hypothetical
 * passengers beside "could not evaluate" has to be able to say what it could not evaluate.
 */
function unavailable(
  ruleId: string,
  references: readonly QuestionId[],
  reason: PreviewReason,
  rosters: { groupId: string; instances: string[] }[] = [],
): PreviewVerdict {
  return { ruleId, references: [...references], outcome: "unavailable", reason, rosters };
}

/**
 * Every questionId the definition pins, mapped to the version it pins it at.
 * A parsed definition pins each question at most once (the kernel rejects
 * `DUPLICATE_QUESTION_IN_FORM`), so this map is total and unambiguous.
 */
function pinsByQuestion(definition: FormDefinition): Map<QuestionId, number> {
  const pins = new Map<QuestionId, number>();
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) pins.set(item.questionId, item.version);
  }
  return pins;
}

/**
 * The questions the condition reads: those the draft pins first, in the draft's
 * own document order, then any it does not pin. Document order is the meaningful
 * order because the forward pass is order-sensitive (ADR-16); the unpinned tail
 * still ships so the panel can show a reference that has no resolvable version
 * (it reads as unanswered rather than silently vanishing).
 */
function orderedReferences(
  definition: FormDefinition,
  rule: VisibilityRule,
  pins: ReadonlyMap<QuestionId, number>,
): QuestionId[] {
  const referenced = new Set<QuestionId>(ruleReferences(rule));
  const pinned: QuestionId[] = [];
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) {
      if (referenced.has(item.questionId)) pinned.push(item.questionId);
    }
  }
  return [...pinned, ...[...referenced].filter((questionId) => !pins.has(questionId))];
}

/**
 * The rule's bench target: the first `show` entry that resolves to a question the
 * draft pins. A step target stands for its first question, because that is the
 * first thing a respondent would actually see the step reveal.
 */
function benchTarget(
  definition: FormDefinition,
  rule: VisibilityRule,
  pins: ReadonlyMap<QuestionId, number>,
): QuestionRef | undefined {
  for (const target of rule.show) {
    if (isStepId(target)) {
      const step = definition.steps.find((entry) => entry.stepId === target);
      const first = step === undefined ? undefined : stepQuestionRefs(step)[0];
      if (first !== undefined) return first;
      continue;
    }
    const version = pins.get(target);
    if (version !== undefined) return { questionId: target, version };
  }
  return undefined;
}

/**
 * The bench's own form, assembled so that the one rule under test is the only thing deciding
 * whether its target is visible (074 widens it to repeating groups).
 *
 * ## Why the bench form has to know about groups at all
 *
 * Because scope is implicit BY POSITION (ADR-42 §3.4). A rule whose target sits inside group
 * H is evaluated once per live instance of H, and a condition reading another question in H
 * resolves to that instance's answer. None of that is written in the condition, so a bench
 * form that flattened H into a plain step would evaluate the rule once, against one answer
 * per question, and report a single verdict for a rule that genuinely has one verdict per
 * instance. The author would come to the bench precisely to find that out and be told the
 * opposite.
 *
 * So each group the rule touches is declared in the bench form as a group:
 *
 * - the group the TARGET sits in, which is what makes the evaluation per instance, and which
 *   carries the target as its last member so the reads in it come first;
 * - the group of any question the condition reads bare, which is the inside-out case;
 * - any group a whole-group operator names, which is the outside-in case and needs the group
 *   to exist even when nothing in it is read by name (`instanceCount` reads no question, so
 *   its group is declared holding its own first member as the one pin `items.min(1)` needs).
 *
 * ## The count source is always `open`, and that is deliberate
 *
 * The roster is passed to the evaluator explicitly, so the bench group's count source decides
 * nothing about the walk - it only has to parse. `open` is the one source that needs no other
 * question in the form: copying a `fromAnswer` source would pull the count question into the
 * bench, or leave the bench form naming a question it does not pin. The `max` is the roster
 * the bench was handed, which has already been truncated against the author's own declaration.
 */
interface BenchForm {
  readonly definition: FormDefinition;
  /** The group the target sits in, which is exactly when the rule is per-instance. */
  readonly targetGroupId?: GroupId | undefined;
}

/**
 * Which groups the bench has to declare: the target's, every one holding a question the
 * condition reads, and every one a whole-group operator names.
 *
 * A group the rule does not touch is left out, because a group the bench declares and nothing
 * reads is a span the evaluator walks for no verdict.
 */
function benchWantedGroups(
  rule: VisibilityRule,
  references: readonly QuestionId[],
  groupOf: ReadonlyMap<QuestionId, GroupId>,
  declared: ReadonlySet<GroupId>,
  targetGroupId: GroupId | undefined,
): ReadonlySet<GroupId> {
  const wanted = new Set<GroupId>();
  if (targetGroupId !== undefined) wanted.add(targetGroupId);
  for (const questionId of references) {
    const groupId = groupOf.get(questionId);
    if (groupId !== undefined) wanted.add(groupId);
  }
  for (const groupId of ruleGroupReferences(rule)) {
    if (declared.has(groupId)) wanted.add(groupId);
  }
  return wanted;
}

/** The questions the condition reads, split by the container the bench has to put them in. */
function benchReads(
  target: QuestionRef,
  references: readonly QuestionId[],
  pins: ReadonlyMap<QuestionId, number>,
  groupOf: ReadonlyMap<QuestionId, GroupId>,
): {
  readonly bare: readonly QuestionRef[];
  readonly byGroup: ReadonlyMap<GroupId, readonly QuestionRef[]>;
} {
  const bare: QuestionRef[] = [];
  const byGroup = new Map<GroupId, QuestionRef[]>();
  for (const questionId of references) {
    // The target is excluded from the reads even when the condition reads it: the kernel
    // refuses a question pinned twice in one form, and a self-reference then correctly reads
    // as unanswered, which is what a forward pass would do anyway.
    if (questionId === target.questionId) continue;
    const version = pins.get(questionId);
    if (version === undefined) continue;
    const groupId = groupOf.get(questionId);
    if (groupId === undefined) {
      bare.push({ questionId, version });
      continue;
    }
    const existing = byGroup.get(groupId) ?? [];
    existing.push({ questionId, version });
    byGroup.set(groupId, existing);
  }
  return { bare, byGroup };
}

function benchForm(
  definition: FormDefinition,
  rule: VisibilityRule,
  target: QuestionRef,
  references: readonly QuestionId[],
  pins: ReadonlyMap<QuestionId, number>,
  rosters: RosterMap,
): BenchForm | undefined {
  const groupOf = questionGroups(definition.steps);
  const byId = new Map(repeatGroups(definition.steps).map((group) => [group.groupId, group]));
  const targetGroupId = groupOf.get(target.questionId);
  const wanted = benchWantedGroups(rule, references, groupOf, new Set(byId.keys()), targetGroupId);
  const { bare: bareReads, byGroup: readsByGroup } = benchReads(target, references, pins, groupOf);

  const groupItem = (groupId: GroupId): RepeatGroup | undefined => {
    const source = byId.get(groupId);
    if (source === undefined) return undefined;
    const reads = readsByGroup.get(groupId) ?? [];
    const members = [...reads, ...(groupId === targetGroupId ? [target] : [])];
    // `items.min(1)`: a group named only by `instanceCount` is read as a whole and by no
    // question, so it stands on its own first member.
    const items = members.length > 0 ? members : source.items.slice(0, 1);
    const instances = rosters.get(groupId) ?? [];
    return {
      groupId,
      label: source.label,
      instanceLabel: source.instanceLabel,
      items,
      count: { source: "open", min: 0, max: Math.max(1, instances.length) },
      presentation: source.presentation,
    };
  };

  const readGroups = [...byId.keys()]
    .filter((groupId) => wanted.has(groupId) && groupId !== targetGroupId)
    .map(groupItem)
    .filter((group): group is RepeatGroup => group !== undefined);
  const readItems = [...bareReads, ...readGroups];
  const targetGroup = targetGroupId === undefined ? undefined : groupItem(targetGroupId);
  const targetItems = targetGroup === undefined ? [target] : [targetGroup];
  /** Whether the target's own group carries any of the questions the condition reads. */
  const readsInTargetGroup =
    targetGroupId !== undefined && (readsByGroup.get(targetGroupId) ?? []).length > 0;

  // NO READABLE INPUT means no answer the bench could vary: the condition reads only questions
  // the draft does not pin and names no group it declares, so there is nothing to evaluate. A
  // group-only read still counts, because the instance COUNT is a thing the author can vary
  // (`instanceCount` is the whole case), and so does a read that sits in the target's OWN group,
  // which is the inside-out case and the commonest shape of all.
  if (readItems.length === 0 && !readsInTargetGroup) return undefined;

  // ONE STEP when every read is inside the target's own group, and that is the inside-out case
  // rather than a special case: "this passenger is an infant, show this passenger's fare basis"
  // reads and shows inside one span, so a second step would be a step with no items - which the
  // kernel refuses (`items.min(1)`) and which would make the bench decline to answer the most
  // ordinary per-instance rule there is. The group's member order puts the reads before the
  // target, so the forward pass sees them in that order within each instance.
  const steps =
    readItems.length === 0
      ? [{ stepId: BENCH_TARGET_STEP_ID, title: definition.title, items: targetItems }]
      : [
          { stepId: BENCH_READS_STEP_ID, title: definition.title, items: readItems },
          { stepId: BENCH_TARGET_STEP_ID, title: definition.title, items: targetItems },
        ];

  const parsed = parseFormDefinition({
    formId: definition.formId,
    defaultLocale: definition.defaultLocale,
    title: definition.title,
    steps,
    rules: [{ ruleId: rule.ruleId, when: rule.when, show: [target.questionId] }],
  });
  if (!parsed.ok) return undefined;
  return {
    definition: parsed.value,
    ...(targetGroupId === undefined ? {} : { targetGroupId }),
  };
}

/**
 * The rule test bench (033): does this rule's condition match these answers?
 *
 * ## Why the API answers this and the admin does not
 *
 * The bench needs `@roonga/qcms-core`'s evaluator, and the admin app is a strict BFF
 * that imports no kernel value at all (R2, enforced by the admin's
 * `r2-import-surface.test.ts`). So the evaluator runs where it already lives.
 * The task file's original "client-side evaluation" wording is superseded by
 * the enforced server-side boundary.
 *
 * ## Why a synthetic two-step form, and not the draft itself
 *
 * ADR-16 evaluation is a single forward pass, so a target's visibility is only
 * well-defined when it sits after every question the condition reads. The real
 * draft need not satisfy that, and a backward target is precisely one of the
 * things an author comes to the bench to understand: evaluating the draft
 * directly would answer "what is visible right now", which is a different
 * question, and would conflate this rule's verdict with every other rule that
 * happens to target the same question.
 *
 * So the bench evaluates a purpose-built form that isolates the one question it
 * actually asks:
 *
 *   step 1 `stp_bench_reads`  - the questions this condition reads, at the
 *                               versions the draft pins them at;
 *   step 2 `stp_bench_target` - the rule's target, alone;
 *   rules                     - this one rule, nothing else.
 *
 * The target is excluded from step 1 even when the condition reads it, because
 * the kernel rejects a question pinned twice in one form; a self-reference then
 * correctly reads as unanswered, which is what a forward pass would do anyway.
 * Since the target is hidden unless a targeting rule matches and this form has
 * exactly one rule, "the target is visible" *is* "the condition matched".
 *
 * Whether the rule is *legally placed* is `analyzeRuleGraph`'s answer, already
 * reported by `draft/validate` as `RULE_BACKWARD_TARGET`/`RULE_CYCLE`. This
 * endpoint deliberately does not duplicate that verdict.
 *
 * Nothing is stored and nothing is compiled.
 */
export function makePreviewConditionHandler(
  deps: Deps,
): RouteHandler<typeof previewConditionRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");

    // The form must exist for the route to mean anything, so an unknown form is a
    // 404 exactly as it is on validate - never a 200 "unavailable".
    const form = await getForm(deps.db, formId);
    if (form === undefined) throw fail.formNotFound();

    // Unlike validate, an unparseable definition is NOT an error here: the bench
    // is a read-only aid over a draft that is legitimately half-built while the
    // author works, so it reports an ordinary `unavailable` verdict instead of
    // blanking the panel with a 422 at the moment it is most wanted.
    const parsed = parseFormDefinition(body.definition);
    if (!parsed.ok) return c.json(unavailable(body.ruleId, [], "unparseableDraft"), 200);
    const definition = parsed.value;
    // Identity is fixed: a preview cannot be run against another form's draft.
    if (definition.formId !== formId) throw fail.idMismatch();

    const rule = definition.rules.find((candidate) => candidate.ruleId === body.ruleId);
    if (rule === undefined) return c.json(unavailable(body.ruleId, [], "ruleNotFound"), 200);

    const pins = pinsByQuestion(definition);
    const references = orderedReferences(definition, rule, pins);
    // The roster the AUTHOR's draft bounds, not the bench form's: the maxima that truncate it
    // are the author's own declarations, and the bench form is built from the result.
    const asked = hypotheticalRosters(definition, body.instances);

    const target = benchTarget(definition, rule, pins);
    if (target === undefined) {
      return c.json(unavailable(rule.ruleId, references, "noTarget", asked.projection), 200);
    }

    const bench = benchForm(definition, rule, target, references, pins, asked.rosters);
    if (bench === undefined) {
      return c.json(
        unavailable(rule.ruleId, references, "unresolvedAnswers", asked.projection),
        200,
      );
    }

    // Version-exact resolution through the same path publish uses, so the bench
    // and publish can never disagree about which content a pin names (R1).
    // `loadQuestionLookups` hands back a `ResolveQuestionVersion` (id + version)
    // while the evaluator wants a `ResolveQuestion` (id only); the bench form's
    // own pin map is what bridges the two, and it is what keeps this lookup
    // version-exact instead of silently resolving to a question's newest version.
    const { resolveQuestion } = await loadQuestionLookups(deps, bench.definition);
    const benchPins = pinsByQuestion(bench.definition);
    const resolve: ResolveQuestion = (questionId) => {
      const version = benchPins.get(questionId);
      return version === undefined ? undefined : resolveQuestion(questionId, version)?.definition;
    };

    // The roster is re-derived against the BENCH form, because that is the definition the
    // evaluator is handed: a group the bench did not need to declare has no roster entry, and
    // an entry for a group the definition does not carry is a key the evaluator never reads.
    const benchRosters = hypotheticalRosters(bench.definition, rosterRecord(asked.projection));
    const answers = collectKeyedAnswers(
      body.answers,
      bench.definition,
      benchPins,
      benchRosters.rosters,
      "refuse",
    );
    if (answers === undefined) {
      return c.json(
        unavailable(rule.ruleId, references, "unresolvedAnswers", asked.projection),
        200,
      );
    }

    const flow = evaluateRules(bench.definition, answers, resolve, benchRosters.rosters);
    // A typed evaluation failure (an unresolvable pin, a type mismatch) is the
    // bench declining to answer, not an API error: same read-only-aid reasoning
    // as the unparseable draft above.
    if (!flow.ok) {
      return c.json(
        unavailable(rule.ruleId, references, "unresolvedAnswers", asked.projection),
        200,
      );
    }

    const hits = flow.value.visible.filter((entry) => entry.questionId === target.questionId);
    const targetGroupId = bench.targetGroupId;
    // ONE VERDICT PER INSTANCE when the target is inside a group, and it is an EMPTY LIST
    // rather than an absent key when that group has no instance. The empty list is the
    // zero-instance case seen from the panel's side, and it is the honest answer: the rule
    // matched for none of nothing, which is not the same as a rule that was not evaluated.
    const instanceOutcomes =
      targetGroupId === undefined
        ? undefined
        : (benchRosters.rosters.get(targetGroupId) ?? []).map((instanceId) => ({
            instanceId: String(instanceId),
            outcome: hits.some((hit) => hit.instanceId === instanceId)
              ? ("match" as const)
              : ("noMatch" as const),
          }));
    return c.json(
      {
        ruleId: rule.ruleId,
        references: [...references],
        outcome: hits.length > 0 ? ("match" as const) : ("noMatch" as const),
        rosters: asked.projection,
        ...(targetGroupId === undefined ? {} : { targetGroupId: String(targetGroupId) }),
        ...(instanceOutcomes === undefined ? {} : { instanceOutcomes }),
      },
      200,
    );
  };
}

/** The projection read back as the record shape {@link hypotheticalRosters} takes. */
function rosterRecord(
  projection: readonly { groupId: string; instances: readonly string[] }[],
): Record<string, readonly string[]> {
  const record: Record<string, readonly string[]> = {};
  for (const entry of projection) record[entry.groupId] = entry.instances;
  return record;
}

// --- POST /admin/forms/:id/draft/preview ------------------------------------

/**
 * The live draft preview (034): compile the draft the author is looking at, and
 * project it for the answers they have walked in with.
 *
 * ## Why the API compiles, and the admin does not
 *
 * The same reasoning 032's question preview settled and 033's rule bench
 * repeated: compiling in the admin would put `@roonga/qcms-a2ui-compiler` and
 * `@roonga/qcms-core` inside a strict BFF, which is exactly the capability the admin's
 * `r2-import-surface.test.ts` exists to keep out (R2). Running it here also makes
 * preview fidelity **structural** rather than a version coincidence: preview and
 * publish call the same `compileForm` in the same process, so they cannot drift.
 *
 * ## Why the visible set comes back with it
 *
 * The task file and the screen contract both describe the author walking branches with
 * "the core evaluator client-side". That is not implementable and has already
 * been ruled on once: rule evaluation lives in the API, and the portal does no
 * rule evaluation either - it
 * receives an authoritative `visibleQuestions` list and projects the full
 * compiled document onto it (`documentForVisible`, R2). So this route returns the
 * *same pair* the portal's serve-step returns, and the admin projects and renders
 * it through the identical shared code. Preview fidelity is stronger for it: the
 * admin is not a second implementation of visibility, it is the same one.
 *
 * ## Why a draft that will not compile is a 422 and not a blank pane
 *
 * A preview of an unpublishable draft would be a claim about what a respondent
 * would see that publish would then refuse to honour. The issues come back
 * verbatim in the same `details.issues` envelope publish uses, so the pane
 * renders the author's real next action instead of an empty step.
 *
 * Nothing here writes. The draft is not saved, the answers are not stored, and
 * the compiled output is not the ADR-18 audit copy: only publish writes that.
 */
export function makePreviewDraftHandler(
  deps: Deps,
): RouteHandler<typeof previewDraftRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");

    const form = await getForm(deps.db, formId);
    if (form === undefined) throw fail.formNotFound();

    const definition = requireDefinition(body.definition);
    if (definition.formId !== formId) throw fail.idMismatch();

    const { issues, snapshot } = await validateDraft(deps, definition);
    if (issues.length > 0 || snapshot === undefined) {
      // `PREVIEW_REJECTED` always carries at least one issue, and that is an
      // invariant rather than a happy accident: the admin's copy for it promises
      // "the reasons are listed below", so a rejection with nothing to list would
      // print a promise it cannot keep. A compile that fails without saying why
      // therefore takes the other door.
      if (issues.length === 0) throw fail.previewUnavailable();
      throw fail.previewRejected(issues);
    }

    const compiled = compileForm(snapshot, {});

    // The snapshot already carries the version-exact question records the pins
    // resolved to, so the evaluator's resolver is built from it rather than by
    // reading the library a second time. Version-exact matters (R1): resolving a
    // pin to a question's newest version would preview content the draft does
    // not name.
    const definitionByQuestion = new Map(
      snapshot.questions.map((record) => [record.questionId, record.definition] as const),
    );
    const resolve: ResolveQuestion = (questionId) => definitionByQuestion.get(questionId);

    // THE PREVIEW'S OWN ROSTER (ADR-42 §6.5). There is no session here, so there is no live
    // roster: the author's screen mints one from each group's `min` or from a count it lets
    // them type, and sends it. Truncated against the author's own declared maxima, so the
    // preview cannot show a page no respondent could reach.
    const asked = hypotheticalRosters(definition, body.instances);
    // `skip` rather than `refuse`, unlike the bench: these values arrive from the shared
    // renderer, so an unreadable one means the author changed the draft under their own
    // answers, and the honest rendering of that is a question reading as unanswered rather
    // than a pane that goes blank while they edit.
    const answers = collectKeyedAnswers(
      body.answers,
      definition,
      pinsByQuestion(definition),
      asked.rosters,
      "skip",
    );
    if (answers === undefined) throw fail.previewUnavailable();
    const flow = evaluateRules(snapshot, answers, resolve, asked.rosters);
    // A clean draft plus renderer-shaped answers cannot fail the forward pass:
    // every pin resolves and every rule type-checked during validation above. If
    // it ever does, it fails as what it is - an evaluation that could not run -
    // rather than as a rejection with an empty issue list, which would show the
    // author a sentence promising reasons that do not exist.
    if (!flow.ok) throw fail.previewUnavailable();

    return c.json(
      {
        documents: compiled.documents.map((document) => ({
          stepId: document.stepId,
          root: document.root,
        })),
        compilerVersion: compiled.compilerVersion,
        a2uiSpecVersion: compiled.a2uiSpecVersion,
        flow: {
          visibleSteps: [...flow.value.visibleSteps],
          // THE ANSWER KEY, not the bare question id - the identical projection the portal's
          // serve-step sends (ADR-42, ADR-43). A member question of a repeating group can be
          // visible in one instance and hidden in another, so only the qualified key can say
          // which; `documentForVisible` consequently leaves a repeat template alone and the
          // renderer's expansion prunes each clone against this same set. A form with no group
          // produces the byte-identical bare list it always did.
          visibleQuestions: flow.value.visible.map((entry) =>
            String(answerKey(entry.questionId, entry.instanceId)),
          ),
          complete: flow.value.complete,
          rosters: asked.projection,
        },
      },
      200,
    );
  };
}

// --- PATCH /admin/forms/:id/settings ----------------------------------------

/**
 * The per-form abuse-control settings (026, ADR-24 tier 2), as the builder's
 * settings panel edits them (033).
 *
 * These live on the mutable `forms` identity row rather than in the published
 * definition, which is the whole point of the tier: an operator can turn a
 * challenge on for a live form without republishing it, and an already-pinned
 * session's frozen snapshot (R1) is untouched by the change. That also makes this
 * a plain transaction script, not an aggregate (R5) - there is no invariant
 * spanning more than the one row.
 *
 * The body is partial, so a panel can save one control without echoing the other
 * back, and `minSubmitMs: null` means "use the deployment's configured floor"
 * rather than "no floor". Neither `slug` nor `status` is reachable here: they
 * have their own doors.
 *
 * There is no pre-read to distinguish "no such form" from "nothing to update":
 * the body schema rejects an all-absent patch, so `updateFormSettings` returning
 * `undefined` can only mean the form does not exist. That is the same single-read
 * 404 shape `closeForm`/`reopenForm` use, and it keeps the sentinel unambiguous.
 *
 * The response carries the derived `challengeEnforceable` alongside the saved
 * settings so the panel can re-render its "unenforceable" warning from the
 * write's own answer, with no follow-up read. It is a behavior statement and not
 * the provider flag's value (ADR-24).
 */
export function makeUpdateFormSettingsHandler(
  deps: Deps,
): RouteHandler<typeof updateFormSettingsRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");

    const updated = await updateFormSettings(deps.db, formId, {
      ...(body.challengeRequired === undefined
        ? {}
        : { challengeRequired: body.challengeRequired }),
      ...(body.minSubmitMs === undefined ? {} : { minSubmitMs: body.minSubmitMs }),
    });
    if (updated === undefined) throw fail.formNotFound();

    return c.json(
      {
        formId: updated.formId,
        settings: {
          challengeRequired: updated.challengeRequired,
          minSubmitMs: updated.minSubmitMs,
        },
        challengeEnforceable: challengeEnforceable(deps.config.flags),
      },
      200,
    );
  };
}

// --- POST /admin/forms/:id/publish ------------------------------------------

export function makePublishFormHandler(deps: Deps): RouteHandler<typeof publishFormRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const now = deps.clock.now();

    const form = await getForm(deps.db, formId);
    if (form === undefined) throw fail.formNotFound();

    const draft = await getDraft(deps.db, formId);
    if (draft === undefined) throw fail.noDraft();

    // Re-parse the stored draft (its JSONB is unknown at the type level, and a
    // draft may be temporarily inconsistent): a malformed draft is a 422, never
    // a 500.
    const definition = requireDefinition(draft.definition);
    if (definition.formId !== formId) throw fail.idMismatch();

    // The aggregate: validate every publish invariant (all errors, not first) -
    // deprecated-pin gate + compileDraft (008). Nothing is persisted on failure.
    const { issues, snapshot } = await validateDraft(deps, definition);
    if (issues.length > 0 || snapshot === undefined) throw fail.publishRejected(issues);

    // Project the frozen snapshot to A2UI once (ADR-18): the stored copy is
    // served forever; serve (019) never recompiles.
    const compiled = compileForm(snapshot, {});

    const inserted = await deps.db.transaction(async (tx) => {
      // Freeze the immutable version with all stamps, delete the draft, and emit
      // the publish event - one transaction, so a version is never observed
      // without its event and the draft never lingers past its publish (§11).
      const version = await insertFormVersion(tx, {
        formId,
        definition: snapshot.definition,
        compiled,
        compilerVersion: compiled.compilerVersion,
        a2uiSpecVersion: compiled.a2uiSpecVersion,
        semanticsVersion: String(snapshot.semanticsVersion),
        publishedAt: now,
      });
      await deleteDraft(tx, formId);
      await enqueue(tx, {
        eventType: FORM_PUBLISHED,
        payload: {
          formId,
          version: version.version,
          publishedAt: version.publishedAt.toISOString(),
        },
      });
      return version;
    });

    return c.json(
      { version: inserted.version, publishedAt: inserted.publishedAt.toISOString() },
      200,
    );
  };
}

// --- POST /admin/forms/:id/close --------------------------------------------

export function makeCloseFormHandler(deps: Deps): RouteHandler<typeof closeFormRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    // Closing stops *new* sessions (018 checks status at start); in-flight
    // sessions finish on their pinned version (R1) - status is the only change.
    const row = await closeForm(deps.db, formId);
    if (row === undefined) throw fail.formNotFound();
    return c.json({ formId: row.formId, status: row.status }, 200);
  };
}

// --- POST /admin/forms/:id/reopen -------------------------------------------

export function makeReopenFormHandler(deps: Deps): RouteHandler<typeof reopenFormRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const row = await reopenForm(deps.db, formId);
    if (row === undefined) throw fail.formNotFound();
    return c.json({ formId: row.formId, status: row.status }, 200);
  };
}

// --- GET /admin/forms/:id/versions/:v ---------------------------------------

export function makeGetFormVersionHandler(
  deps: Deps,
): RouteHandler<typeof getFormVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const formId = requireFormId(id);
    const version = requireVersion(v);

    const row = await getFormVersion(deps.db, formId, version);
    if (row === undefined) throw fail.versionNotFound();

    return c.json(
      {
        // `formId`/`version` come from the parsed, validated path params; they are
        // the same values the row carries, so there is no need to read them back.
        formId,
        version,
        publishedAt: row.publishedAt.toISOString(),
        compilerVersion: row.compilerVersion,
        a2uiSpecVersion: row.a2uiSpecVersion,
        semanticsVersion: row.semanticsVersion,
        definition: row.definition,
        compiled: row.compiled,
      },
      200,
    );
  };
}
