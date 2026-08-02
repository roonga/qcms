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
  type AnswerMap,
  type AnswerValue,
  compileDraft,
  type DraftInput,
  evaluateRules,
  type FormDefinition,
  type FormId,
  type FrozenSnapshot,
  isStepId,
  parseAnswerValue,
  parseFormDefinition,
  parseFormId,
  parseLocaleCode,
  parseQuestionId,
  type PublishError,
  type QuestionId,
  type QuestionRef,
  type QuestionVersionRecord,
  type ResolveQuestion,
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
  previewDraftRoute,
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
  previewRejected: (issues: readonly PublishIssue[]): ApiError =>
    new ApiError("PREVIEW_REJECTED", 422, "The draft cannot be previewed", { issues }),
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
        // The deployment-level provider rides along so the panel can warn on load
        // that `challengeRequired` is unenforceable while the provider is "none"
        // (033), rather than only discovering it after a write.
        challengeProvider: deps.config.flags.challengeProvider,
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
}

/**
 * An "I cannot answer that" verdict. Tri-state `outcome` plus a typed `reason`,
 * never a nullable boolean: the panel must be able to tell "could not evaluate"
 * from a real "no match", and a half-built draft makes the former ordinary.
 */
function unavailable(
  ruleId: string,
  references: readonly QuestionId[],
  reason: PreviewReason,
): PreviewVerdict {
  return { ruleId, references: [...references], outcome: "unavailable", reason };
}

/**
 * Every questionId the definition pins, mapped to the version it pins it at.
 * A parsed definition pins each question at most once (the kernel rejects
 * `DUPLICATE_QUESTION_IN_FORM`), so this map is total and unambiguous.
 */
function pinsByQuestion(definition: FormDefinition): Map<QuestionId, number> {
  const pins = new Map<QuestionId, number>();
  for (const step of definition.steps) {
    for (const item of step.items) pins.set(item.questionId, item.version);
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
    for (const item of step.items) {
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
      const first = definition.steps.find((step) => step.stepId === target)?.items[0];
      if (first !== undefined) return first;
      continue;
    }
    const version = pins.get(target);
    if (version !== undefined) return { questionId: target, version };
  }
  return undefined;
}

/**
 * The hypothetical answers, narrowed to what the bench form pins and parsed into
 * canonical `AnswerValue`s. Keys that are not question ids, and answers for
 * questions the bench form does not pin, are ignored - the same rule the
 * evaluator applies to a stray answer-map key. A *relevant* value that is not a
 * canonical encoding returns `undefined` (an `unresolvedAnswers` verdict):
 * declining to answer beats silently treating it as unanswered and reporting a
 * confident `noMatch` the author would have to debug.
 *
 * SEC-13 / ADR-34: these are answer-shaped values. They are read here and never
 * logged, never persisted, and never echoed into a response or an error message.
 */
function collectBenchAnswers(
  supplied: Readonly<Record<string, unknown>>,
  pins: ReadonlyMap<QuestionId, number>,
): AnswerMap | undefined {
  const answers = new Map<QuestionId, AnswerValue>();
  for (const [key, value] of Object.entries(supplied)) {
    if (value === undefined) continue;
    const questionId = parseQuestionId(key);
    if (!questionId.ok || !pins.has(questionId.value)) continue;
    const answer = parseAnswerValue(value);
    if (!answer.ok) return undefined;
    answers.set(questionId.value, answer.value);
  }
  return answers;
}

/**
 * The rule test bench (033): does this rule's condition match these answers?
 *
 * ## Why the API answers this and the admin does not
 *
 * The bench needs `@qcms/core`'s evaluator, and the admin app is a strict BFF
 * that imports no kernel value at all (R2, enforced by the admin's
 * `r2-import-surface.test.ts`). So the evaluator runs where it already lives.
 * The task file's original "client-side evaluation" wording is amended
 * accordingly (2026-08-01, PO seat).
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

    const target = benchTarget(definition, rule, pins);
    if (target === undefined) return c.json(unavailable(rule.ruleId, references, "noTarget"), 200);

    const reads: QuestionRef[] = [];
    for (const questionId of references) {
      if (questionId === target.questionId) continue;
      const version = pins.get(questionId);
      if (version !== undefined) reads.push({ questionId, version });
    }
    // No readable input means no answer the bench could vary: the condition can
    // only read questions the draft does not pin, so there is nothing to evaluate.
    if (reads.length === 0) {
      return c.json(unavailable(rule.ruleId, references, "unresolvedAnswers"), 200);
    }

    const bench = parseFormDefinition({
      formId: definition.formId,
      defaultLocale: definition.defaultLocale,
      title: definition.title,
      steps: [
        { stepId: BENCH_READS_STEP_ID, title: definition.title, items: reads },
        { stepId: BENCH_TARGET_STEP_ID, title: definition.title, items: [target] },
      ],
      rules: [{ ruleId: rule.ruleId, when: rule.when, show: [target.questionId] }],
    });
    if (!bench.ok) return c.json(unavailable(rule.ruleId, references, "unresolvedAnswers"), 200);

    // Version-exact resolution through the same path publish uses, so the bench
    // and publish can never disagree about which content a pin names (R1).
    // `loadQuestionLookups` hands back a `ResolveQuestionVersion` (id + version)
    // while the evaluator wants a `ResolveQuestion` (id only); the bench form's
    // own pin map is what bridges the two, and it is what keeps this lookup
    // version-exact instead of silently resolving to a question's newest version.
    const { resolveQuestion } = await loadQuestionLookups(deps, bench.value);
    const benchPins = pinsByQuestion(bench.value);
    const resolve: ResolveQuestion = (questionId) => {
      const version = benchPins.get(questionId);
      return version === undefined ? undefined : resolveQuestion(questionId, version)?.definition;
    };

    const answers = collectBenchAnswers(body.answers, benchPins);
    if (answers === undefined) {
      return c.json(unavailable(rule.ruleId, references, "unresolvedAnswers"), 200);
    }

    const flow = evaluateRules(bench.value, answers, resolve);
    // A typed evaluation failure (an unresolvable pin, a type mismatch) is the
    // bench declining to answer, not an API error: same read-only-aid reasoning
    // as the unparseable draft above.
    if (!flow.ok) return c.json(unavailable(rule.ruleId, references, "unresolvedAnswers"), 200);

    const matched = flow.value.visible.some((entry) => entry.questionId === target.questionId);
    return c.json(
      {
        ruleId: rule.ruleId,
        references: [...references],
        outcome: matched ? ("match" as const) : ("noMatch" as const),
      },
      200,
    );
  };
}

// --- POST /admin/forms/:id/draft/preview ------------------------------------

/**
 * Read the author's walk-through answers into an `AnswerMap`.
 *
 * Unlike the bench's collector this **skips** what it cannot read rather than
 * refusing the whole request. The values arrive straight from the shared
 * renderer's canonical `AnswerValue` shape, so an unreadable entry means the
 * author changed the draft under their own answers (a pin moved, a question was
 * removed) - and the honest rendering of that is the question reading as
 * unanswered, not a preview pane that goes blank while they edit.
 *
 * Answers are never logged and never persisted here (SEC-13, ADR-34).
 */
function collectPreviewAnswers(
  supplied: Readonly<Record<string, unknown>> | undefined,
  pins: ReadonlyMap<QuestionId, number>,
): AnswerMap {
  const answers = new Map<QuestionId, AnswerValue>();
  for (const [key, value] of Object.entries(supplied ?? {})) {
    if (value === undefined) continue;
    const questionId = parseQuestionId(key);
    if (!questionId.ok || !pins.has(questionId.value)) continue;
    const answer = parseAnswerValue(value);
    if (!answer.ok) continue;
    answers.set(questionId.value, answer.value);
  }
  return answers;
}

/**
 * The live draft preview (034): compile the draft the author is looking at, and
 * project it for the answers they have walked in with.
 *
 * ## Why the API compiles, and the admin does not
 *
 * The same reasoning 032's question preview settled and 033's rule bench
 * repeated: compiling in the admin would put `@qcms/a2ui-compiler` and
 * `@qcms/core` inside a strict BFF, which is exactly the capability the admin's
 * `r2-import-surface.test.ts` exists to keep out (R2). Running it here also makes
 * preview fidelity **structural** rather than a version coincidence: preview and
 * publish call the same `compileForm` in the same process, so they cannot drift.
 *
 * ## Why the visible set comes back with it
 *
 * The task file and the wireframe both describe the author walking branches with
 * "the core evaluator client-side". That is not implementable and has already
 * been ruled on once: rule evaluation lives in the API (033's amendment,
 * 2026-08-01, PO seat), and the portal does no rule evaluation either - it
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
    if (issues.length > 0 || snapshot === undefined) throw fail.previewRejected(issues);

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

    const answers = collectPreviewAnswers(body.answers, pinsByQuestion(definition));
    const flow = evaluateRules(snapshot, answers, resolve);
    // A clean draft plus renderer-shaped answers cannot fail the forward pass:
    // every pin resolves and every rule type-checked during validation above. If
    // it does, the pane is told the preview is unavailable rather than shown a
    // projection built from a failed evaluation.
    if (!flow.ok) throw fail.previewRejected([]);

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
          visibleQuestions: flow.value.visible.map((entry) => entry.questionId),
          complete: flow.value.complete,
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
 * The response carries the deployment's `challengeProvider` alongside the saved
 * settings so the panel can re-render its "unenforceable while the provider is
 * none" warning from the write's own answer, with no follow-up read.
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
        challengeProvider: deps.config.flags.challengeProvider,
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
