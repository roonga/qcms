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
 * Row types come straight from `@qcms/db`: the enum-bearing `forms` and
 * `question_versions` rows are now hand-authored and sound across the package
 * boundary (issue #5), so this slice reads them by inference with no local view
 * or cast. The enum-free `form_drafts`/`form_versions` rows are used directly as
 * well.
 */

import type { RouteHandler } from "@hono/zod-openapi";
import { compileForm } from "@qcms/a2ui-compiler";
import {
  type AnswerValue,
  compileDraft,
  type DraftInput,
  evaluateRules,
  type FormDefinition,
  type FormId,
  type FrozenSnapshot,
  parseFormDefinition,
  parseFormId,
  parseLocaleCode,
  parseQuestionId,
  type PublishError,
  type QuestionDefinition,
  type QuestionId,
  type QuestionVersionRecord,
  type ResolveQuestionVersion,
  ruleReferences,
  type StepId,
  type VisibilityRule,
} from "@qcms/core";
import {
  closeForm,
  createForm,
  deleteDraft,
  enqueue,
  getDraft,
  getForm,
  getFormVersion,
  getLatestPublishedVersion,
  getQuestionVersion,
  insertFormVersion,
  listForms,
  listFormVersions,
  listQuestionVersions,
  type QuestionStatus,
  reopenForm,
  updateFormSettings,
  upsertDraft,
} from "@qcms/db";

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
  publishFormRoute,
  putDraftRoute,
  reopenFormRoute,
  updateFormSettingsRoute,
  validateDraftRoute,
} from "./route.js";

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
type PublishIssue = PublishError | DeprecatedPinIssue;

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
  ruleNotFound: (): ApiError =>
    new ApiError("RULE_NOT_FOUND", 404, "The definition carries no rule with that ruleId"),
  // The bench cannot answer for a question the form does not pin: there is no
  // version to resolve it against, so there is no defined answer shape either.
  // Named as a distinct code so the panel can say which reference is unpinned
  // rather than showing a generic failure.
  unpinnedReference: (questionIds: readonly QuestionId[]): ApiError =>
    new ApiError(
      "UNPINNED_CONDITION_REFERENCE",
      422,
      "The condition reads question(s) this form does not pin",
      { questionIds },
    ),
  unresolvablePin: (questionId: QuestionId, version: number): ApiError =>
    new ApiError("UNRESOLVABLE_PIN", 422, "A pinned question version does not exist", {
      questionId,
      version,
    }),
} as const;

// --- shared helpers ---------------------------------------------------------

/** Parse a `:id` path param to a FormId, or 400. */
function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

/** Parse a `:v` path param to a positive integer, or 404 (no such version). */
function requireVersion(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw fail.versionNotFound();
  return n;
}

/** Validate an opaque definition body through the kernel (422 on failure). */
function requireDefinition(value: unknown): FormDefinition {
  const parsed = parseFormDefinition(value);
  if (!parsed.ok) throw fail.invalidDefinition(parsed.error);
  return parsed.value;
}

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
    for (const item of step.items) ids.add(item.questionId);
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
      for (const item of step.items) {
        carried.add(placementKey(step.stepId, item.questionId, item.version));
      }
    }
  }

  const issues: DeprecatedPinIssue[] = [];
  for (const step of definition.steps) {
    for (const item of step.items) {
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
 * `compileDraft` (008). Returns every issue (all errors, never first-only) and,
 * when the draft is clean, the frozen snapshot ready to compile and persist.
 * Shared by the advisory paths (PUT draft, validate) and publish itself.
 */
async function validateDraft(
  deps: Deps,
  definition: FormDefinition,
): Promise<{ issues: PublishIssue[]; snapshot?: FrozenSnapshot }> {
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
  return { issues, ...(result.ok ? { snapshot: result.value } : {}) };
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
    const rows = await listForms(deps.db);

    // One draft/version read per row is fine at launch admin scale (R7); a
    // denormalized status column is a Phase-4 optimization, not a launch need.
    const forms = [];
    for (const row of rows) {
      const draft = await getDraft(deps.db, row.formId);
      const latest = await getLatestPublishedVersion(deps.db, row.formId);
      forms.push({
        formId: row.formId,
        slug: row.slug,
        defaultLocale: row.defaultLocale,
        status: row.status,
        hasDraft: draft !== undefined,
        latestVersion: latest === undefined ? null : latest.version,
        publishedAt: latest === undefined ? null : latest.publishedAt.toISOString(),
      });
    }

    return c.json({ forms }, 200);
  };
}

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
    // Identity is fixed: a draft save cannot repoint the form's id.
    if (definition.formId !== formId) throw fail.idMismatch();

    const form = await getForm(deps.db, formId);
    if (form === undefined) throw fail.formNotFound();

    // Save first (drafts may be temporarily inconsistent), then advise. Advisory
    // issues do not block the save; they block publish.
    await upsertDraft(deps.db, { formId, definition });
    const { issues } = await validateDraft(deps, definition);

    return c.json({ draft: definition, issues }, 200);
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

    const { issues } = await validateDraft(deps, definition);
    return c.json({ valid: issues.length === 0, issues }, 200);
  };
}

// --- POST /admin/forms/:id/draft/preview-condition --------------------------

/**
 * The synthetic ids the rule test bench's probe snapshot carries.
 *
 * A preview snapshot is built, evaluated, and thrown away inside one request: it
 * is never persisted, never pinned, and never published, so these cannot collide
 * with authored ids in storage (R6). They can collide with ids in the *submitted*
 * definition, which is why the probe question id is uniquified below rather than
 * used as a constant.
 */
// Cast justification (both): string literals written to the `stp_[a-z0-9_]+` id
// grammar, so the brand is a compile-time label over a value that is correct by
// construction. Parsing them would be a runtime check of a constant.
const PREVIEW_INPUT_STEP_ID = "stp_preview_condition_inputs" as StepId;
const PREVIEW_RESULT_STEP_ID = "stp_preview_condition_result" as StepId;
const PREVIEW_PROBE_BASE = "q_preview_condition_probe";

/** A probe id no question in the definition uses. */
function mintProbeId(taken: ReadonlySet<string>): QuestionId {
  let candidate = PREVIEW_PROBE_BASE;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${PREVIEW_PROBE_BASE}_${String(suffix)}`;
    suffix += 1;
  }
  // Constructed from a literal matching the `q_[a-z0-9_]+` id grammar, so the
  // parse cannot fail; parsed anyway so the brand is earned, never cast.
  const parsed = parseQuestionId(candidate);
  /* v8 ignore next 1 -- unreachable: the candidate is built to the id grammar */
  if (!parsed.ok) throw new Error("preview probe id failed to parse");
  return parsed.value;
}

/**
 * The rule's referenced questions, ordered and version-pinned as the draft has
 * them. A forward pass is order-sensitive (ADR-16), so the probe snapshot has to
 * preserve the draft's own document order; a reference the form does not pin has
 * no version to resolve against and is a 422 rather than a silent "unanswered".
 */
function orderReferences(
  definition: FormDefinition,
  rule: VisibilityRule,
): { ordered: QuestionId[]; pinByQuestion: Map<QuestionId, number> } {
  const referenced = new Set<QuestionId>(ruleReferences(rule));
  const pinByQuestion = new Map<QuestionId, number>();
  const ordered: QuestionId[] = [];
  for (const step of definition.steps) {
    for (const item of step.items) {
      if (!referenced.has(item.questionId) || pinByQuestion.has(item.questionId)) continue;
      pinByQuestion.set(item.questionId, item.version);
      ordered.push(item.questionId);
    }
  }
  const unpinned = [...referenced].filter((questionId) => !pinByQuestion.has(questionId));
  if (unpinned.length > 0) throw fail.unpinnedReference(unpinned);
  return { ordered, pinByQuestion };
}

/**
 * The rule test bench (033): does this rule's condition match these answers?
 *
 * ## Why the API answers this and the admin does not
 *
 * The bench needs `@qcms/core`'s evaluator, and the admin app is a strict BFF
 * that imports no kernel value at all (R2, enforced by the admin's
 * `r2-import-surface.test.ts`). So the evaluator runs where it already lives,
 * exactly as 032 resolved the same tension for the question preview pane. The
 * wireframe's original "client-side evaluation" wording is amended accordingly
 * (2026-08-01, PO seat).
 *
 * ## The synthetic snapshot, and why it is not the draft itself
 *
 * `evaluateRules` answers "what is visible", not "did this condition match", and
 * running the real draft would conflate the two: a target can be hidden by a
 * *different* rule, and a rule placed backwards (ADR-16) has no well-defined
 * effect at all. So the bench evaluates a purpose-built two-step form:
 *
 *   step 1 - every question the condition reads, at its pinned version, in the
 *            draft's own document order;
 *   step 2 - one synthetic probe question, targeted by this one rule.
 *
 * A rule target is hidden unless a targeting rule matches, so "the probe is
 * visible" *is* "the condition matched" - nothing else in the snapshot can move
 * it. Laying the inputs strictly before the probe also means the bench keeps
 * answering while the author's real placement is still wrong, which is precisely
 * when they need it. Whether the rule is legally placed is `analyzeRuleGraph`'s
 * verdict, delivered separately by `draft/validate`.
 *
 * Nothing is stored and nothing is compiled. The hypothetical answers are
 * answer-shaped data (SEC-13, ADR-34): they are read here and never logged, never
 * persisted, and never echoed back - the kernel's own evaluation errors name ids
 * and operators only.
 */
export function makePreviewConditionHandler(
  deps: Deps,
): RouteHandler<typeof previewConditionRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");
    const definition = requireDefinition(body.definition);
    if (definition.formId !== formId) throw fail.idMismatch();

    const form = await getForm(deps.db, formId);
    if (form === undefined) throw fail.formNotFound();

    const rule = definition.rules.find((r) => r.ruleId === body.ruleId);
    if (rule === undefined) throw fail.ruleNotFound();

    const { ordered, pinByQuestion } = orderReferences(definition, rule);

    // Resolve every referenced pin to the exact version it names (R1): a rule is
    // checked against the frozen content it was written for, never against
    // whatever the question's newest version happens to say now.
    const resolved = new Map<QuestionId, QuestionDefinition>();
    for (const [questionId, version] of pinByQuestion) {
      const row = await getQuestionVersion(deps.db, questionId, version);
      if (row === undefined) throw fail.unresolvablePin(questionId, version);
      resolved.set(questionId, row.definition);
    }

    const probeId = mintProbeId(new Set(pinnedQuestionIds(definition)));
    const probe: QuestionDefinition = {
      questionId: probeId,
      type: "boolean",
      label: { [definition.defaultLocale]: "condition preview probe" },
      required: false,
    };
    const snapshot: FormDefinition = {
      formId: definition.formId,
      defaultLocale: definition.defaultLocale,
      title: definition.title,
      steps: [
        {
          stepId: PREVIEW_INPUT_STEP_ID,
          title: definition.title,
          items: ordered.map((questionId) => ({
            questionId,
            version: pinByQuestion.get(questionId) ?? 1,
          })),
        },
        {
          stepId: PREVIEW_RESULT_STEP_ID,
          title: definition.title,
          items: [{ questionId: probeId, version: 1 }],
        },
      ],
      rules: [{ ruleId: rule.ruleId, when: rule.when, show: [probeId] }],
    };

    // Only the referenced questions carry answers into the pass; anything else in
    // the submitted map is not in the snapshot and is ignored by the evaluator.
    const answers = new Map<QuestionId, AnswerValue>();
    for (const questionId of ordered) {
      const supplied = body.answers[questionId];
      if (supplied === undefined) continue;
      // Cast justification: the bench's answers are unknown JSON by design. The
      // evaluator re-parses every entry through `AnswerValue` and reports a bad
      // one as MALFORMED_ANSWER_VALUE, so this is a shape assertion the kernel
      // immediately re-checks, not a trusted narrowing.
      answers.set(questionId, supplied as AnswerValue);
    }

    const outcome = evaluateRules(snapshot, answers, (questionId) =>
      questionId === probeId ? probe : resolved.get(questionId),
    );

    return c.json(
      {
        ruleId: rule.ruleId,
        references: [...ordered],
        matches: outcome.ok
          ? outcome.value.visible.some((entry) => entry.questionId === probeId)
          : null,
        error: outcome.ok ? null : { code: outcome.error.code, message: outcome.error.message },
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
 */
export function makeUpdateFormSettingsHandler(
  deps: Deps,
): RouteHandler<typeof updateFormSettingsRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");

    const form = await getForm(deps.db, formId);
    if (form === undefined) throw fail.formNotFound();

    const updated = await updateFormSettings(deps.db, formId, {
      ...(body.challengeRequired === undefined
        ? {}
        : { challengeRequired: body.challengeRequired }),
      ...(body.minSubmitMs === undefined ? {} : { minSubmitMs: body.minSubmitMs }),
    });
    /* v8 ignore next 1 -- the row existed a statement ago; a gone row is a 404 */
    if (updated === undefined) throw fail.formNotFound();

    return c.json(
      {
        formId: updated.formId,
        settings: {
          challengeRequired: updated.challengeRequired,
          minSubmitMs: updated.minSubmitMs,
        },
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
