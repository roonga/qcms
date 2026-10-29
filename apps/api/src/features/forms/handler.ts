import type { RouteHandler, z } from "@hono/zod-openapi";
import { compileForm } from "@roonga/qcms-a2ui-compiler";
import type { CompiledForm } from "@roonga/qcms-a2ui-compiler";
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
  closeFormInEnvironment,
  createForm,
  environmentStatesByForm,
  deleteDraft,
  getDraft,
  getForm,
  getFormVersion,
  getLatestPublishedVersion,
  getWorkspace,
  insertFormVersion,
  listForms,
  listQuestionOwnership,
  listFormVersions,
  listFormReleases,
  listQuestionVersions,
  getFormEnvironmentState,
  type QuestionStatus,
  reopenFormInEnvironment,
  updateFormSettings,
  upsertDraft,
} from "@roonga/qcms-db";
import type { Executor, FormDraftRow, FormVersionRow, QuestionOwnership } from "@roonga/qcms-db";

import { challengeEnforceable } from "../../config.js";
import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { workspaceFilterFor } from "../membership/context.js";
import { approvalForRelease } from "../membership/two-person.js";
import type { ApiEnv } from "../../openapi.js";
import { recordRelease } from "../releases/release.js";
import { commitReleaseBatch, intentHashOf, storedResult } from "../releases/batch.js";
import {
  draftPublishNotAllowed,
  productionVersions,
  readWorkflow,
  ruleFor,
  testReleaseRequired,
  usesTestWorkflow,
} from "../releases/workflow.js";
import { resolveGrants, holdsInstallationClaim } from "../membership/resolver.js";
import { decideAccess } from "../membership/policy.js";
import { resolveWorkspaceForNewObject } from "../workspaces/resolve.js";
import { mayPinQuestion } from "../workspaces/rules.js";
import type {
  closeFormRoute,
  createFormRoute,
  getFormRoute,
  getFormVersionRoute,
  listFormsRoute,
  previewConditionRoute,
  previewDraftRoute,
  publishAndReleaseFormRoute,
  publishBatchRoute,
  publishFormRoute,
  putDraftRoute,
  reopenFormRoute,
  updateFormSettingsRoute,
  validateDraftRoute,
} from "./route.js";
import type { ListFormsQuery } from "./schema.js";

/** A slice-level issue: the kernel knows published/not and does not model deprecation. */
interface DeprecatedPinIssue {
  readonly code: "DEPRECATED_PIN";
  readonly message: string;
  readonly path: { readonly step: StepId; readonly question: QuestionId; readonly version: number };
}
/**
 * `DEPRECATED_PIN`'s shape and channel deliberately, so an author meets one mechanism for
 * "this version is not one you may newly pin here" rather than two.
 */
interface ForeignWorkspacePinIssue {
  readonly code: "FOREIGN_WORKSPACE_PIN";
  readonly message: string;
  readonly path: { readonly step: StepId; readonly question: QuestionId; readonly version: number };
}
export type PublishIssue = PublishError | DeprecatedPinIssue | ForeignWorkspacePinIssue;
/** Re-exported so the assist slice takes the whole advisory contract from one place. */
export type { PublishWarning };

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
  /**
   * Installation-wide, not per workspace: `/f/{slug}` carries no workspace segment, so a
   * slug names at most one form however many workspaces exist.
   */
  slugTaken: (slug: string): ApiError =>
    new ApiError("FORM_SLUG_TAKEN", 409, `The slug "${slug}" is already in use`),
  formNotFound: (): ApiError => new ApiError("FORM_NOT_FOUND", 404, "No such form"),
  noDraft: (): ApiError => new ApiError("NO_DRAFT", 409, "This form has no open draft to publish"),
  draftMoved: (): ApiError =>
    new ApiError(
      "STALE_REVIEW",
      409,
      "The draft was saved after the review this confirmation carries. Nothing was " +
        "written; read the review again and confirm the new one.",
      { field: "draftRevision" },
    ),
  unknownEnvironment: (name: string): ApiError =>
    new ApiError("UNKNOWN_ENVIRONMENT", 400, `This deployment serves no environment named ${name}`),
  /**
   * The closed flag is a value of the release state and a release row's `version` is
   * `NOT NULL`, so "closed with nothing released" is not expressible.
   */
  notReleasedHere: (environment: string): ApiError =>
    new ApiError(
      "NOT_RELEASED",
      409,
      `This form has no released version in ${environment}, so there is no intake to close or reopen`,
    ),
  /**
   * A refusal rather than a second identical row, so the history that answers "who
   * stopped production intake, and when" holds no row that recorded no change.
   */
  alreadyInState: (environment: string, closed: boolean): ApiError =>
    new ApiError(
      closed ? "ALREADY_CLOSED" : "ALREADY_OPEN",
      409,
      `Intake in ${environment} is already ${closed ? "closed" : "open"}`,
    ),
  /**
   * A 500 rather than an empty actor in the audit, which would look like an answer. The
   * admin-auth gate makes it unreachable in a mounted process.
   */
  noPrincipal: (): Error =>
    new Error("forms: no admin principal on a request that records an actor"),
  versionNotFound: (): ApiError => new ApiError("VERSION_NOT_FOUND", 404, "No such form version"),
  publishRejected: (issues: readonly PublishIssue[]): ApiError =>
    new ApiError("PUBLISH_REJECTED", 422, "The draft cannot be published", { issues }),
  previewRejected: (issues: readonly PublishIssue[]): ApiError =>
    new ApiError("PREVIEW_REJECTED", 422, "The draft cannot be previewed", { issues }),
  // Carries no `details.issues` at all, so the admin never renders "the reasons are
  // listed below" above nothing.
  previewUnavailable: (): ApiError =>
    new ApiError(
      "PREVIEW_UNAVAILABLE",
      422,
      "The draft compiled, but its rules could not be evaluated for these answers",
    ),
} as const;

/**
 * Checked against the pools this process holds rather than against `control.environments`,
 * so the answer cannot be "it exists but nothing here can reach it".
 */
function requireEnvironment(deps: Deps, name: string): string {
  if (!deps.databases.names.includes(name)) throw fail.unknownEnvironment(name);
  return name;
}

function requireFormId(id: string): FormId {
  const parsed = parseFormId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

/**
 * `form_versions.version` is `int4`. Without the bound Postgres refuses the parameter and
 * a caller who typed too many digits gets a 500 instead of a 404.
 */
const MAX_VERSION = 2_147_483_647;

function requireVersion(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VERSION) throw fail.versionNotFound();
  return n;
}

function requireDefinition(value: unknown): FormDefinition {
  const parsed = parseFormDefinition(value);
  if (!parsed.ok) throw fail.invalidDefinition(parsed.error);
  return parsed.value;
}

/**
 * Takes an `Executor` rather than reaching for `deps.databases.control` so the assist
 * slice's accept can store the draft in the same transaction that creates its questions.
 */
export async function storeDraftDefinition(
  exec: Executor,
  formId: FormId,
  definition: FormDefinition,
  agentAssisted: boolean,
): Promise<FormDraftRow> {
  if (definition.formId !== formId) throw fail.idMismatch();

  const form = await getForm(exec, formId);
  if (form === undefined) throw fail.formNotFound();

  return upsertDraft(exec, { formId, definition, agentAssisted });
}

export const requireFormDefinition = requireDefinition;

function pinKey(questionId: QuestionId, version: number): string {
  return `${questionId} ${String(version)}`;
}

function placementKey(stepId: StepId, questionId: QuestionId, version: number): string {
  return `${stepId} ${questionId} ${String(version)}`;
}

function pinnedQuestionIds(definition: FormDefinition): Set<QuestionId> {
  const ids = new Set<QuestionId>();
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) ids.add(item.questionId);
  }
  return ids;
}

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
    const rows = await listQuestionVersions(deps.databases.control, questionId);
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
 * A deprecated version may stay pinned only where the exact placement was already in the
 * previous published version. Each one is added to `publishedQuestionVersions` so this
 * gate is the sole author of the verdict and no pin is also reported as unpublished.
 */
function deprecatedPinGate(
  definition: FormDefinition,
  previousDefinition: FormDefinition | undefined,
  statusByPin: ReadonlyMap<string, QuestionStatus>,
  publishedQuestionVersions: Map<QuestionId, Set<number>>,
): DeprecatedPinIssue[] {
  const carried = carriedPlacements(previousDefinition);

  const issues: DeprecatedPinIssue[] = [];
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) {
      if (statusByPin.get(pinKey(item.questionId, item.version)) !== "deprecated") continue;
      // Deprecated content is still valid content for `compileDraft` to resolve.
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
 * A pin moved to another step, or repointed to another version, is a new pin rather than a
 * carried one, and both gates below treat it as one.
 */
function carriedPlacements(previousDefinition: FormDefinition | undefined): Set<string> {
  const carried = new Set<string>();
  if (previousDefinition === undefined) return carried;
  for (const step of previousDefinition.steps) {
    for (const item of stepQuestionRefs(step)) {
      carried.add(placementKey(step.stepId, item.questionId, item.version));
    }
  }
  return carried;
}

/**
 * A form may pin its own or the shared workspace's published versions. `carried`
 * grandfathers a placement the previous version had. It never asks who is publishing,
 * so the installation administrator is held to it too.
 */
function workspacePinGate(
  definition: FormDefinition,
  formWorkspaceId: string,
  ownershipByQuestion: ReadonlyMap<QuestionId, QuestionOwnership>,
  carried: ReadonlySet<string>,
): ForeignWorkspacePinIssue[] {
  const issues: ForeignWorkspacePinIssue[] = [];
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) {
      const question = ownershipByQuestion.get(item.questionId);
      // No ownership row means no such question, which `compileDraft` already reports.
      if (question === undefined) continue;
      if (mayPinQuestion({ formWorkspaceId, question })) continue;
      if (carried.has(placementKey(step.stepId, item.questionId, item.version))) continue;
      issues.push({
        code: "FOREIGN_WORKSPACE_PIN",
        message: `Step "${step.stepId}" pins question "${item.questionId}"@${String(item.version)}, which another workspace owns, as a new or moved pin`,
        path: { step: step.stepId, question: item.questionId, version: item.version },
      });
    }
  }
  return issues;
}

/**
 * `warnings` is empty whenever the kernel reports errors, since `compileDraft` advises
 * only on a draft it could compile; this layer's own pin findings can still stand beside
 * a warning. A warning never refuses, so every caller tests `issues` alone.
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
  const previous = await getLatestPublishedVersion(deps.databases.control, definition.formId);
  const previousDefinition: FormDefinition | undefined = previous?.definition;
  const carried = carriedPlacements(previousDefinition);

  const deprecatedIssues = deprecatedPinGate(
    definition,
    previousDefinition,
    statusByPin,
    publishedQuestionVersions,
  );

  // Read here rather than passed in so the rule judges the workspace the form is in now,
  // which is the answer the publish a moment later will give.
  const form = await getForm(deps.databases.control, definition.formId);
  const ownership = await listQuestionOwnership(deps.databases.control, [
    ...pinnedQuestionIds(definition),
  ]);
  const workspaceIssues =
    form === undefined
      ? []
      : workspacePinGate(
          definition,
          form.workspaceId,
          new Map(ownership.map((row) => [row.questionId, row])),
          carried,
        );

  const draft: DraftInput = { definition, resolveQuestion, publishedQuestionVersions };
  const result = compileDraft(draft);
  const issues: PublishIssue[] = [
    ...deprecatedIssues,
    ...workspaceIssues,
    ...(result.ok ? [] : result.error),
  ];
  return {
    issues,
    warnings: result.ok ? result.value.warnings : [],
    ...(result.ok ? { snapshot: result.value.snapshot } : {}),
  };
}

function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

/**
 * Read off the constraint name, which the driver puts on the error or on its `cause`;
 * matching the message instead would couple the refusal to Postgres's prose.
 */
function isSlugViolation(err: unknown): boolean {
  const constraintOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { constraint?: string }).constraint : undefined;
  const constraint =
    constraintOf(err) ?? constraintOf((err as { cause?: unknown }).cause) ?? undefined;
  return constraint === "forms_slug_unique";
}

export function makeCreateFormHandler(deps: Deps): RouteHandler<typeof createFormRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const parsedId = parseFormId(body.formId);
    if (!parsedId.ok) throw fail.invalidId();
    const formId = parsedId.value;
    const locale = parseLocaleCode(body.defaultLocale);
    if (!locale.ok) throw fail.invalidLocale();

    // Deliberately not publishable: publish re-parses it and rejects until the author
    // saves real content.
    const emptyDraft: FormDefinition = {
      formId,
      defaultLocale: locale.value,
      title: {},
      steps: [],
      rules: [],
    };

    // Resolved before the transaction, so a refusal costs no database work.
    const workspaceId = await resolveWorkspaceForNewObject(
      deps.databases.control,
      body.workspaceId,
    );

    const created = await deps.databases.control.transaction(async (tx) => {
      try {
        await createForm(tx, { formId, slug: body.slug, workspaceId, defaultLocale: locale.value });
      } catch (err: unknown) {
        // Two unique keys can fire: the primary key means a reused id, `forms_slug_unique`
        // a different mistake with a different fix, so each gets its own code.
        if (isUniqueViolation(err)) {
          throw isSlugViolation(err) ? fail.slugTaken(body.slug) : fail.idTaken();
        }
        throw err;
      }
      await upsertDraft(tx, { formId, definition: emptyDraft });
      return emptyDraft;
    });

    return c.json(
      {
        formId,
        slug: body.slug,
        workspaceId,
        defaultLocale: locale.value,
        status: "open" as const,
        draft: created,
      },
      201,
    );
  };
}

export function makeListFormsHandler(deps: Deps): RouteHandler<typeof listFormsRoute, ApiEnv> {
  return async (c) => {
    const { status, search, sort } = c.req.valid("query");
    // Narrowed to the workspaces the caller holds `form: read` in, so two groups sharing
    // one installation do not see each other's forms; `undefined` is every workspace.
    const rows = await listForms(deps.databases.control, {
      ...workspaceFilterFor(c.get("grantContext")),
    });
    // One query for the whole list rather than one per form. A form with nothing released
    // in this environment is absent from the map and reads `open`: nobody has closed it.
    const environment = requireEnvironment(
      deps,
      c.get("requestEnvironment") ?? deps.databases.defaultEnvironment,
    );
    const states = await environmentStatesByForm(deps.databases.control, environment);
    const statusOf = (formId: FormId): "open" | "closed" =>
      states.get(formId)?.closed === true ? "closed" : "open";

    // Narrows before the per-row reads below, so a closed-only list of fifty forms does
    // not pay for fifty drafts.
    const byStatus =
      status === undefined ? rows : rows.filter((row) => statusOf(row.formId) === status);

    const assembled = [];
    for (const row of byStatus) {
      const draft = await getDraft(deps.databases.control, row.formId);
      const latest = await getLatestPublishedVersion(deps.databases.control, row.formId);
      assembled.push({
        row: {
          formId: row.formId,
          slug: row.slug,
          defaultLocale: row.defaultLocale,
          status: statusOf(row.formId),
          hasDraft: draft !== undefined,
          latestVersion: latest === undefined ? null : latest.version,
          publishedAt: latest === undefined ? null : latest.publishedAt.toISOString(),
        },
        // Beside the row rather than in it: the title is read for the search only, and
        // the response carries no title field.
        title: titleOf(draft?.definition ?? latest?.definition),
      });
    }

    // The draft title wins over the published one: an unpublished rename is still what
    // the author is looking for.
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

function titleOf(definition: FormDefinition | undefined): unknown {
  return definition === undefined ? undefined : (definition as { title?: unknown }).title;
}

function titleMatches(title: unknown, needle: string): boolean {
  if (title === null || typeof title !== "object") return false;
  return Object.values(title as Record<string, unknown>).some(
    (value) => typeof value === "string" && value.toLowerCase().includes(needle),
  );
}

interface Orderable {
  readonly row: { readonly slug: string; readonly publishedAt: string | null };
}

/**
 * A form never published has no publish date, so unpublished rows go last in both
 * directions. Every comparison falls back to the slug, so the order is total.
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

type SortKey = NonNullable<z.infer<typeof ListFormsQuery>["sort"]>;

export function makeGetFormHandler(deps: Deps): RouteHandler<typeof getFormRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);

    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();

    const versions = await listFormVersions(deps.databases.control, formId);
    const openDraft = await getDraft(deps.databases.control, formId);
    const workspace = await getWorkspace(deps.databases.control, form.workspaceId);
    const environmentState = await getFormEnvironmentState(
      deps.databases.control,
      formId,
      requireEnvironment(deps, c.get("requestEnvironment") ?? deps.databases.defaultEnvironment),
    );

    const environment = c.get("requestEnvironment") ?? deps.databases.defaultEnvironment;
    const workflowEnabled = usesTestWorkflow(deps.databases.names);
    const principal = c.get("adminPrincipal");
    const membership =
      principal === undefined
        ? undefined
        : await resolveGrants(deps.databases.control, {
            userId: principal.userId,
            workspaceId: form.workspaceId,
            claim: holdsInstallationClaim(principal.role),
          });
    const allows = (resource: "form" | "release", action: string): boolean =>
      membership !== undefined &&
      decideAccess({
        ...membership,
        request: { resource, action, environment, formId },
      }).allowed;
    const releases = await listFormReleases(deps.databases.control, formId);
    const eligible =
      workflowEnabled && environment === "prod"
        ? [...productionVersions(releases)]
        : versions.map((v) => v.version);
    const preferred = releases.find(
      (r) => r.environment === (workflowEnabled && environment === "prod" ? "test" : environment),
    );
    const workflow = {
      enabled: workflowEnabled,
      environment,
      canEdit: allows("form", "write") && !(workflowEnabled && environment === "prod"),
      canPublish:
        allows("form", "publish") &&
        allows("release", "create") &&
        !(workflowEnabled && environment === "prod"),
      canRelease: allows("release", "create"),
      eligibleVersions: eligible,
      preferredVersion: preferred?.version ?? eligible[0] ?? null,
      currentVersion: environmentState?.version ?? null,
    };

    // A read-time convenience: a seeded draft is not persisted until the author saves.
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
        status: environmentState?.closed === true ? ("closed" as const) : ("open" as const),
        draft,
        draftSource,
        releasedDefinition:
          versions.find((v) => v.version === environmentState?.version)?.definition ?? null,
        draftAgentAssisted: openDraft?.agentAssisted ?? false,
        draftRevision: openDraft?.revision ?? null,
        draftUpdatedAt: openDraft?.updatedAt.toISOString() ?? null,
        versions: versions.map((v) => ({
          version: v.version,
          publishedAt: v.publishedAt.toISOString(),
          compilerVersion: v.compilerVersion,
          a2uiSpecVersion: v.a2uiSpecVersion,
          semanticsVersion: v.semanticsVersion,
          publishedBy: v.publishedBy,
        })),
        settings: {
          challengeRequired: form.challengeRequired,
          minSubmitMs: form.minSubmitMs,
        },
        challengeEnforceable: challengeEnforceable(deps.config.flags),
        requiresSecondApprover: workspace?.requireSecondApprover ?? false,
        workflow,
      },
      200,
    );
  };
}

export function makePutDraftHandler(deps: Deps): RouteHandler<typeof putDraftRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const definition = requireDefinition(c.req.valid("json").definition);

    // Save first, then advise: a draft may be temporarily inconsistent, and the issues
    // block publish rather than the save.
    const saved = await storeDraftDefinition(
      deps.databases.control,
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

export function makeValidateDraftHandler(
  deps: Deps,
): RouteHandler<typeof validateDraftRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const definition = requireDefinition(c.req.valid("json").definition);
    if (definition.formId !== formId) throw fail.idMismatch();

    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();

    // `valid` keys off errors alone: a warning describes a draft that would publish.
    const { issues, warnings } = await validateDraft(deps, definition);
    return c.json({ valid: issues.length === 0, issues, warnings: [...warnings] }, 200);
  };
}

interface Hypothetical {
  readonly rosters: RosterMap;
  readonly projection: { groupId: string; instances: string[] }[];
}

/**
 * A group the definition does not declare contributes nothing, so a rule reading one cannot
 * appear to work here and fail at publish. A malformed id is dropped rather than refused,
 * and a duplicate too, since roster order is meaning and one instance must appear once.
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

/**
 * Bounds one preview request's hypothesis about a group whose author has not declared a
 * `max` yet, and never a form's declared maximum. Without it nothing bounds the caller's
 * instance list, and the kernel's evaluation budget is checked only at publish.
 */
const PREVIEW_INSTANCE_CAP = 50;

function rosterFor(group: RepeatGroup, asked: readonly string[]): readonly InstanceId[] {
  const seen = new Set<string>();
  const instances: InstanceId[] = [];
  // Never the smaller of the two: a declared `max` above the cap is the author's own figure,
  // and a preview of it is a preview of what a respondent can reach.
  const ceiling = countBounds(group.count).max ?? PREVIEW_INSTANCE_CAP;
  for (const candidate of asked) {
    if (instances.length >= ceiling) break;
    if (seen.has(candidate)) continue;
    const parsed = parseInstanceId(candidate);
    if (!parsed.ok) continue;
    seen.add(candidate);
    instances.push(parsed.value);
  }
  return instances;
}

/**
 * A qualified key must name a pinned question inside the instance's group, with that
 * instance in the roster (SEC-16). SEC-13 / ADR-34: values are never logged or echoed.
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

function resolveAnswerKey(
  key: string,
  pins: ReadonlyMap<QuestionId, number>,
  rosters: RosterMap,
  groupOf: ReadonlyMap<QuestionId, GroupId>,
): AnswerKey | undefined {
  const cut = key.indexOf("/");
  if (cut < 0) {
    const questionId = parseQuestionId(key);
    // A question inside a group has one answer per instance, so its bare id names no single
    // value and is dropped rather than put in a map the evaluator never reads.
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

// Cast justification (both): string literals written to the `stp_[a-z0-9_]+` id
// grammar, so the brand is a compile-time label over a value that is correct by
// construction. Parsing them would be a runtime check of a constant.
const BENCH_READS_STEP_ID = "stp_bench_reads" as StepId;
const BENCH_TARGET_STEP_ID = "stp_bench_target" as StepId;

type PreviewReason = "unparseableDraft" | "ruleNotFound" | "noTarget" | "unresolvedAnswers";

interface PreviewVerdict {
  readonly ruleId: string;
  readonly references: string[];
  readonly outcome: "match" | "noMatch" | "unavailable";
  readonly reason?: PreviewReason;
  readonly rosters: { groupId: string; instances: string[] }[];
}

/**
 * Tri-state `outcome` plus a typed `reason` rather than a nullable boolean, so the panel
 * can tell "could not evaluate" from a real "no match".
 */
function unavailable(
  ruleId: string,
  references: readonly QuestionId[],
  reason: PreviewReason,
  rosters: { groupId: string; instances: string[] }[] = [],
): PreviewVerdict {
  return { ruleId, references: [...references], outcome: "unavailable", reason, rosters };
}

/** A parsed definition pins each question at most once, so the map is unambiguous. */
function pinsByQuestion(definition: FormDefinition): Map<QuestionId, number> {
  const pins = new Map<QuestionId, number>();
  for (const step of definition.steps) {
    for (const item of stepQuestionRefs(step)) pins.set(item.questionId, item.version);
  }
  return pins;
}

/**
 * Document order is the meaningful order because the forward pass is order-sensitive; the
 * unpinned tail still ships so a reference with no resolvable version does not vanish.
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

/** A step target stands for its first question: the first thing the step would reveal. */
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
 * Scope is implicit by position, so each group the rule touches must be declared, or one
 * verdict is reported where the rule has one per instance. The count source is `open`,
 * the one source needing no other question.
 */
interface BenchForm {
  readonly definition: FormDefinition;
  readonly targetGroupId?: GroupId | undefined;
}

/**
 * A group the rule does not touch is left out: one the bench declares and nothing reads is
 * a span the evaluator walks for no verdict.
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
    // The kernel refuses a question pinned twice in one form, and a self-reference then
    // reads as unanswered, which is what a forward pass would do anyway.
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
  const readsInTargetGroup =
    targetGroupId !== undefined && (readsByGroup.get(targetGroupId) ?? []).length > 0;

  // No readable input means no answer the bench could vary. A group-only read still counts,
  // since the instance count is itself variable, and so does a read inside the target's own
  // group.
  if (readItems.length === 0 && !readsInTargetGroup) return undefined;

  // One step when every read is inside the target's own group: a second step would have no
  // items, which the kernel refuses.
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
 * Evaluates a purpose-built form rather than the draft: evaluation is a single forward
 * pass, so a target's visibility is only well-defined when it sits after every question
 * the condition reads, and the bench form has exactly one rule, which makes "the target is
 * visible" mean "the condition matched". Nothing is stored and nothing is compiled.
 */
export function makePreviewConditionHandler(
  deps: Deps,
): RouteHandler<typeof previewConditionRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");

    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();

    // Unlike validate, an unparseable definition is not an error here: the bench is a
    // read-only aid over a draft that is legitimately half-built while the author works.
    const parsed = parseFormDefinition(body.definition);
    if (!parsed.ok) return c.json(unavailable(body.ruleId, [], "unparseableDraft"), 200);
    const definition = parsed.value;
    if (definition.formId !== formId) throw fail.idMismatch();

    const rule = definition.rules.find((candidate) => candidate.ruleId === body.ruleId);
    if (rule === undefined) return c.json(unavailable(body.ruleId, [], "ruleNotFound"), 200);

    const pins = pinsByQuestion(definition);
    const references = orderedReferences(definition, rule, pins);
    // Bounded by the author's draft, not the bench form's: the bench form is built from
    // the result.
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

    // The bench form's own pin map bridges `ResolveQuestionVersion` to the evaluator's
    // `ResolveQuestion`, keeping the lookup version-exact rather than newest-version.
    const { resolveQuestion } = await loadQuestionLookups(deps, bench.definition);
    const benchPins = pinsByQuestion(bench.definition);
    const resolve: ResolveQuestion = (questionId) => {
      const version = benchPins.get(questionId);
      return version === undefined ? undefined : resolveQuestion(questionId, version)?.definition;
    };

    // Re-derived against the bench form, since that is the definition the evaluator is
    // handed: a group it did not declare has no roster entry.
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
    // A typed evaluation failure is the bench declining to answer, not an API error.
    if (!flow.ok) {
      return c.json(
        unavailable(rule.ruleId, references, "unresolvedAnswers", asked.projection),
        200,
      );
    }

    const hits = flow.value.visible.filter((entry) => entry.questionId === target.questionId);
    const targetGroupId = bench.targetGroupId;
    // An empty list rather than an absent key when the group has no instance: matched for
    // none of nothing is not the same as a rule that was not evaluated.
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

function rosterRecord(
  projection: readonly { groupId: string; instances: readonly string[] }[],
): Record<string, readonly string[]> {
  const record: Record<string, readonly string[]> = {};
  for (const entry of projection) record[entry.groupId] = entry.instances;
  return record;
}

/**
 * Compiles here rather than in the admin, which imports no kernel value (R2), and returns
 * the same pair the portal's serve-step returns so the admin is not a second
 * implementation of visibility. Nothing here writes.
 */
export function makePreviewDraftHandler(
  deps: Deps,
): RouteHandler<typeof previewDraftRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");

    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();

    const definition = requireDefinition(body.definition);
    if (definition.formId !== formId) throw fail.idMismatch();

    const { issues, snapshot } = await validateDraft(deps, definition);
    if (issues.length > 0 || snapshot === undefined) {
      // `PREVIEW_REJECTED` always carries at least one issue: the admin's copy promises
      // "the reasons are listed below", so a compile that fails silently takes the other
      // door.
      if (issues.length === 0) throw fail.previewUnavailable();
      throw fail.previewRejected(issues);
    }

    const compiled = compileForm(snapshot, {});

    // Built from the snapshot so the resolver stays version-exact: resolving a pin to a
    // question's newest version would preview content the draft does not name.
    const definitionByQuestion = new Map(
      snapshot.questions.map((record) => [record.questionId, record.definition] as const),
    );
    const resolve: ResolveQuestion = (questionId) => definitionByQuestion.get(questionId);

    // No session here, so the roster is the caller's hypothesis, truncated against the
    // author's declared maxima so the preview cannot show a page no respondent can reach.
    const asked = hypotheticalRosters(definition, body.instances);
    // `skip` rather than `refuse`, unlike the bench: these values arrive from the shared
    // renderer, so an unreadable one means the author changed the draft under their own
    // answers, which honestly renders as a question reading unanswered.
    const answers = collectKeyedAnswers(
      body.answers,
      definition,
      pinsByQuestion(definition),
      asked.rosters,
      "skip",
    );
    if (answers === undefined) throw fail.previewUnavailable();
    const flow = evaluateRules(snapshot, answers, resolve, asked.rosters);
    // Unreachable after a clean validation; if it ever happens it fails as an evaluation
    // that could not run rather than as a rejection with an empty issue list.
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
          // The identical projection the portal's serve-step sends: a member question can be
          // visible in one instance and hidden in another, so only the qualified key says
          // which.
          visibleQuestions: flow.value.visible.map((entry) =>
            String(answerKey(entry.questionId, entry.instanceId)),
          ),
          complete: flow.value.complete,
          rosters: asked.projection,
          // Forwarded rather than derived, and absent for a draft with no repeating group
          // exactly as the kernel leaves it.
          ...(flow.value.visibleStepViews === undefined
            ? {}
            : { visibleStepViews: flow.value.visibleStepViews.map((view) => ({ ...view })) }),
        },
      },
      200,
    );
  };
}

/**
 * These settings live on the mutable identity row, so an operator can turn a challenge on
 * for a live form without republishing and an already-pinned session is untouched. There
 * is no pre-read: the body schema refuses an all-absent patch, so `undefined` back from
 * `updateFormSettings` can only mean the form does not exist.
 */
export function makeUpdateFormSettingsHandler(
  deps: Deps,
): RouteHandler<typeof updateFormSettingsRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");

    const updated = await updateFormSettings(deps.databases.control, formId, {
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

/**
 * Split from the write so the combined publish-and-release action can run both writes in
 * one transaction. Nothing here persists, so every refusal it raises costs no database
 * work and lands before a transaction is open.
 */
async function freezeDraft(
  deps: Deps,
  formId: FormId,
): Promise<{ snapshot: FrozenSnapshot; compiled: CompiledForm; draftRevision: number }> {
  const form = await getForm(deps.databases.control, formId);
  if (form === undefined) throw fail.formNotFound();

  const draft = await getDraft(deps.databases.control, formId);
  if (draft === undefined) throw fail.noDraft();

  // A stored draft may be temporarily inconsistent, so a malformed one is a 422, not a 500.
  const definition = requireDefinition(draft.definition);
  if (definition.formId !== formId) throw fail.idMismatch();

  const { issues, snapshot } = await validateDraft(deps, definition);
  if (issues.length > 0 || snapshot === undefined) throw fail.publishRejected(issues);

  // Projected once: the stored copy is served forever and the serve path never recompiles
  // (ADR-18).
  return { snapshot, compiled: compileForm(snapshot, {}), draftRevision: draft.revision };
}

/**
 * `publishedBy` is the account the two-person rule compares against, and is frozen here
 * because `form_versions` is append-only and no later write can fill it in.
 */
async function writeVersion(
  tx: Executor,
  formId: FormId,
  frozen: { snapshot: FrozenSnapshot; compiled: CompiledForm },
  publishedAt: Date,
  publishedBy: string,
): Promise<FormVersionRow> {
  const version = await insertFormVersion(tx, {
    formId,
    definition: frozen.snapshot.definition,
    compiled: frozen.compiled,
    compilerVersion: frozen.compiled.compilerVersion,
    a2uiSpecVersion: frozen.compiled.a2uiSpecVersion,
    semanticsVersion: String(frozen.snapshot.semanticsVersion),
    publishedAt,
    publishedBy,
  });
  await deleteDraft(tx, formId);
  return version;
}

export function makePublishFormHandler(deps: Deps): RouteHandler<typeof publishFormRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const now = deps.clock.now();
    const frozen = await freezeDraft(deps, formId);
    // Thrown rather than recorded as `""`: a version whose author is the empty string is
    // one the two-person rule could not judge while looking as though it could.
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();

    // Publishing enqueues nothing in any environment. One transaction still, so the draft
    // never lingers past its publish; `form.released` is written by the release itself.
    const inserted = await deps.databases.control.transaction((tx) =>
      writeVersion(tx, formId, frozen, now, principal.userId),
    );

    return c.json(
      { version: inserted.version, publishedAt: inserted.publishedAt.toISOString() },
      200,
    );
  };
}

/**
 * One transaction holds the version, draft deletion, release record and event. No policy
 * call here: the route's `form: publish` and `release: create` row is judged against the
 * body's environment first, which stops an editor scoped to `test` releasing to `prod`.
 */
export function makePublishAndReleaseFormHandler(
  deps: Deps,
): RouteHandler<typeof publishAndReleaseFormRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const environment = requireEnvironment(deps, c.req.valid("json").environment);
    const now = deps.clock.now();
    // Thrown rather than recorded as `""`: the release record answers "who put that
    // version into `prod`", and an empty actor answers nothing while looking like an answer.
    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();

    // The combined act makes the publisher the releaser, so a gated `prod` release always
    // refuses here and has to be two requests by two accounts. Raised before the draft is
    // compiled, so the refusal costs no database work.
    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();
    const approvedBy = await approvalForRelease(deps.databases.control, {
      workspaceId: c.get("grantContext")?.workspaceId ?? form.workspaceId,
      environment,
      // The version this act is about to assign, not the previous one: it is read back
      // only in a refusal message, which would otherwise name a version the operator may
      // never have touched. `insertFormVersion` assigns the same number.
      version:
        ((await getLatestPublishedVersion(deps.databases.control, formId))?.version ?? 0) + 1,
      author: principal.userId,
      releasedBy: principal.userId,
    });

    // The configured workflow decides whether a destination may take a version frozen in
    // the same act; the derived default keeps the code the release dialog already reads.
    const workflow = await readWorkflow(deps.databases.control, deps.databases.names);
    if (!ruleFor(workflow, environment).allowsDraftPublish) {
      throw workflow.source === "default"
        ? testReleaseRequired()
        : draftPublishNotAllowed(environment);
    }
    const frozen = await freezeDraft(deps, formId);

    const result = await deps.databases.control.transaction(async (tx) => {
      const version = await writeVersion(tx, formId, frozen, now, principal.userId);
      const release = await recordRelease(tx, {
        formId,
        environment,
        version: version.version,
        releasedBy: principal.userId,
        // `undefined` in every case this route can reach; threaded rather than hard-coded
        // so the two release paths read the same.
        approvedBy,
        // The version is new, so it was released nowhere before this.
        fromEnvironment: undefined,
        // A new version into a closed environment does not resume intake.
        closed: (await getFormEnvironmentState(tx, formId, environment))?.closed ?? false,
      });
      return { version, release };
    });

    return c.json(
      {
        version: result.version.version,
        publishedAt: result.version.publishedAt.toISOString(),
        environment: result.release.environment,
        releasedAt: result.release.releasedAt.toISOString(),
      },
      200,
    );
  };
}

/**
 * Freeze the shared draft once and release that one snapshot into every named destination,
 * or into none, in one transaction. The draft is compiled before the transaction opens, so
 * a malformed one costs no database work; the revision it was compiled from is rechecked
 * under the form's lock.
 */
export function makePublishBatchHandler(
  deps: Deps,
): RouteHandler<typeof publishBatchRoute, ApiEnv> {
  return async (c) => {
    const formId = requireFormId(c.req.valid("param").id);
    const body = c.req.valid("json");
    for (const target of body.targets) {
      requireEnvironment(deps, target.environment);
      if (target.fromEnvironment !== undefined) requireEnvironment(deps, target.fromEnvironment);
    }

    const principal = c.get("adminPrincipal");
    if (principal === undefined) throw fail.noPrincipal();
    const form = await getForm(deps.databases.control, formId);
    if (form === undefined) throw fail.formNotFound();

    // Before the draft is read: the first attempt consumed it, so a replay has nothing to
    // freeze and would answer "no draft to publish" instead of the result it produced.
    const intentHash = intentHashOf(body);
    const replayed = await storedResult(deps, {
      principalId: principal.userId,
      formId,
      idempotencyKey: body.idempotencyKey,
      intentHash,
    });
    if (replayed !== undefined) return c.json(replayed, 200);

    const now = deps.clock.now();
    const frozen = await freezeDraft(deps, formId);
    if (frozen.draftRevision !== body.source.draftRevision) throw fail.draftMoved();

    const result = await commitReleaseBatch(deps, {
      formId,
      workspaceId: c.get("grantContext")?.workspaceId ?? form.workspaceId,
      principalId: principal.userId,
      idempotencyKey: body.idempotencyKey,
      intentHash,
      expectedWorkflowRevision: body.expectedWorkflowRevision,
      source: {
        kind: "draft",
        draftRevision: body.source.draftRevision,
        freeze: (tx) => writeVersion(tx, formId, frozen, now, principal.userId),
      },
      targets: body.targets.map((target) => ({
        environment: target.environment,
        expectedSequence: target.expectedSequence,
        ...(target.fromEnvironment === undefined
          ? {}
          : { fromEnvironment: target.fromEnvironment }),
      })),
    });
    return c.json(result, 200);
  };
}

/**
 * Closing stops new sessions only; in-flight ones finish on their pinned version. The read
 * and the append share a transaction so a release landing between them cannot be closed
 * over with the earlier version.
 */
async function setIntake(
  deps: Deps,
  c: Parameters<RouteHandler<typeof closeFormRoute, ApiEnv>>[0],
  closed: boolean,
): Promise<{ formId: string; environment: string; status: "open" | "closed" }> {
  const formId = requireFormId(c.req.valid("param").id);
  const environment = requireEnvironment(deps, c.req.valid("json").environment);
  const principal = c.get("adminPrincipal");
  if (principal === undefined) throw fail.noPrincipal();

  const form = await getForm(deps.databases.control, formId);
  if (form === undefined) throw fail.formNotFound();

  const row = await deps.databases.control.transaction(async (tx) => {
    const current = await getFormEnvironmentState(tx, formId, environment);
    if (current === undefined) throw fail.notReleasedHere(environment);
    if (current.closed === closed) throw fail.alreadyInState(environment, closed);
    return closed
      ? await closeFormInEnvironment(tx, { formId, environment, closedBy: principal.userId })
      : await reopenFormInEnvironment(tx, { formId, environment, reopenedBy: principal.userId });
  });
  // Unreachable: the read inside the transaction already refused the only case that
  // produces it.
  if (row === undefined) throw fail.notReleasedHere(environment);

  return { formId: row.formId, environment: row.environment, status: closed ? "closed" : "open" };
}

export function makeCloseFormHandler(deps: Deps): RouteHandler<typeof closeFormRoute, ApiEnv> {
  return async (c) => c.json(await setIntake(deps, c, true), 200);
}

export function makeReopenFormHandler(deps: Deps): RouteHandler<typeof reopenFormRoute, ApiEnv> {
  return async (c) => c.json(await setIntake(deps, c, false), 200);
}

export function makeGetFormVersionHandler(
  deps: Deps,
): RouteHandler<typeof getFormVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const formId = requireFormId(id);
    const version = requireVersion(v);

    const row = await getFormVersion(deps.databases.control, formId, version);
    if (row === undefined) throw fail.versionNotFound();

    return c.json(
      {
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
