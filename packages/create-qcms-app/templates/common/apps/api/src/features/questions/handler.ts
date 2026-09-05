/**
 * Admin question-authoring handlers (task 021) - honest transaction scripts (R5).
 *
 * The question library, headless: create a question with a first draft version,
 * seed new draft versions, edit drafts, publish, deprecate, and read. The kernel
 * (`QuestionDefinition`, 003) validates every definition; the `@roonga/qcms-db` helpers
 * (014) persist. There is no domain aggregate here - the version lifecycle
 * (draft → published → deprecated, `DOMAIN_SCHEMA.md` §4.2) is a set of
 * single-row state checks the slice owns, each wrapped in a transaction so the
 * check and the write are one atomic decision.
 *
 * Fetch-pure (R4): no `node:*`; time is not needed here (the db helpers stamp
 * `publishedAt`). Answers are never handled here, so nothing content-bearing is
 * ever logged (SEC-8).
 *
 * **Immutability is returned before the DB trigger fires.** Editing or
 * transitioning a non-draft version is rejected with the typed
 * `VERSION_IMMUTABLE` / `INVALID_VERSION_STATE` after reading the current
 * status - the `question_versions_freeze_published` trigger (013) is only the
 * backstop, never the first line, so a client sees a clean 409, not a 500.
 *
 * **R6:** a `questionId` is stable forever. Create rejects any id ever used -
 * including for a deleted or deprecated question - via `isQuestionIdTaken`
 * (`QUESTION_ID_REUSED`). There is deliberately no delete endpoint: questions
 * are deprecated, never removed (see this slice's README).
 */

import type { RouteHandler } from "@hono/zod-openapi";
import {
  A2UI_SPEC_VERSION,
  COMPILER_VERSION,
  questionToNode,
  type TextResolver,
} from "@roonga/qcms-a2ui-compiler";
import {
  LocaleCode,
  parseLocaleCode,
  parseQuestionId,
  type LocalizedText,
  type QuestionDefinition,
  type QuestionId,
} from "@roonga/qcms-core";
import {
  createQuestionVersion,
  deprecateQuestionVersion,
  getQuestion,
  getQuestionVersion,
  listQuestionVersions,
  listQuestions,
  listVersionsForQuestions,
  publishQuestionVersion,
  updateDraftDefinition,
} from "@roonga/qcms-db";
import type { QuestionStatus, QuestionVersionRow } from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import { createQuestionWithFirstDraft, requireQuestionDefinition } from "./create.js";
import type {
  createQuestionRoute,
  createVersionRoute,
  deprecateVersionRoute,
  editVersionRoute,
  getQuestionRoute,
  listQuestionsRoute,
  previewQuestionVersionRoute,
  publishVersionRoute,
} from "./route.js";
import type { QuestionListItem, QuestionVersionView } from "./schema.js";

// --- typed failures (envelope codes the admin app keys off, 032) -------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_QUESTION_ID", 400, "Malformed question id"),
  idMismatch: (): ApiError =>
    new ApiError(
      "QUESTION_ID_MISMATCH",
      422,
      "The definition's questionId does not match the path id (identity is fixed, R6)",
    ),
  questionNotFound: (): ApiError => new ApiError("QUESTION_NOT_FOUND", 404, "No such question"),
  versionNotFound: (): ApiError =>
    new ApiError("VERSION_NOT_FOUND", 404, "No such question version"),
  immutable: (): ApiError =>
    new ApiError(
      "VERSION_IMMUTABLE",
      409,
      "Only draft versions can be edited; publish creates immutable content (R1/I1)",
    ),
  invalidState: (from: QuestionStatus, action: string): ApiError =>
    new ApiError("INVALID_VERSION_STATE", 409, `Cannot ${action} a ${from} version`),
} as const;

// --- shared helpers ---------------------------------------------------------

/** Parse a `:id` path param to a QuestionId, or 400. */
function requireQuestionId(id: string): QuestionId {
  const parsed = parseQuestionId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

/**
 * The largest value a version number can take: `question_versions.version` is
 * an `int4` column, so nothing above this can name a stored row (issue #645).
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

/** Shape a stored version row into its response view. */
function toVersionView(row: QuestionVersionRow): QuestionVersionView {
  return {
    questionId: row.questionId,
    version: row.version,
    status: row.status,
    definition: row.definition,
    publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
  };
}

/** The localized label carried by any definition (used for list display/search). */
function labelOf(definition: QuestionDefinition): unknown {
  return (definition as { label?: unknown }).label;
}

/**
 * The question type carried by any definition (list display + type filter).
 *
 * Read positionally like {@link labelOf} rather than narrowed through the kernel
 * union: a stored definition is already kernel-valid, so its `type` is one of the
 * seven, and the response schema is what pins that for clients.
 */
function typeOf(definition: QuestionDefinition): QuestionListItem["type"] {
  return (definition as { type: QuestionListItem["type"] }).type;
}

// --- POST /admin/questions --------------------------------------------------

export function makeCreateQuestionHandler(
  deps: Deps,
): RouteHandler<typeof createQuestionRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const definition = requireQuestionDefinition(body.definition);

    // The identity check, the identity row and the first draft version are one
    // atomic decision, and they live in `create.ts` so 041's accept can make the
    // same one (issue #823) instead of growing a second create path.
    const created = await deps.db.transaction((tx) =>
      createQuestionWithFirstDraft(tx, { definition, slug: body.slug }),
    );

    return c.json(
      {
        questionId: created.question.questionId,
        slug: created.question.slug,
        createdAt: created.question.createdAt.toISOString(),
        version: toVersionView(created.version),
      },
      201,
    );
  };
}

// --- POST /admin/questions/:id/versions -------------------------------------

export function makeCreateVersionHandler(
  deps: Deps,
): RouteHandler<typeof createVersionRoute, ApiEnv> {
  return async (c) => {
    const questionId = requireQuestionId(c.req.valid("param").id);

    const created = await deps.db.transaction(async (tx) => {
      const versions = await listQuestionVersions(tx, questionId);
      const latest = versions.at(-1);
      if (latest === undefined) throw fail.questionNotFound();

      // Seed the new draft from the latest version's definition (the author
      // then edits it via PUT). A fresh draft is always editable.
      const row = await createQuestionVersion(tx, {
        questionId,
        definition: latest.definition,
      });
      return row;
    });

    return c.json(toVersionView(created), 201);
  };
}

// --- PUT /admin/questions/:id/versions/:v -----------------------------------

export function makeEditVersionHandler(deps: Deps): RouteHandler<typeof editVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const questionId = requireQuestionId(id);
    const version = requireVersion(v);
    const definition = requireQuestionDefinition(c.req.valid("json").definition);

    // Identity is fixed (R6): a draft edit cannot repoint the version's id.
    if (definition.questionId !== questionId) throw fail.idMismatch();

    const updated = await deps.db.transaction(async (tx) => {
      const current = await getQuestionVersion(tx, questionId, version);
      if (current === undefined) throw fail.versionNotFound();
      // Return the typed immutability error *before* the freeze trigger fires.
      if (current.status !== "draft") throw fail.immutable();

      const row = await updateDraftDefinition(tx, { questionId, version, definition });
      return row;
    });

    // The row existed and was a draft moments ago, inside the same transaction.
    if (updated === undefined) throw fail.versionNotFound();
    return c.json(toVersionView(updated), 200);
  };
}

// --- POST /admin/questions/:id/versions/:v/publish --------------------------

export function makePublishVersionHandler(
  deps: Deps,
): RouteHandler<typeof publishVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const questionId = requireQuestionId(id);
    const version = requireVersion(v);

    const published = await deps.db.transaction(async (tx) => {
      const current = await getQuestionVersion(tx, questionId, version);
      if (current === undefined) throw fail.versionNotFound();
      // Only a draft can be published (§4.2). A published/deprecated version is
      // a no-op-or-worse: report the invalid transition rather than re-stamping.
      if (current.status !== "draft") throw fail.invalidState(current.status, "publish");

      const row = await publishQuestionVersion(tx, { questionId, version });
      return row;
    });

    if (published === undefined) throw fail.versionNotFound();
    return c.json(toVersionView(published), 200);
  };
}

// --- POST /admin/questions/:id/versions/:v/deprecate ------------------------

export function makeDeprecateVersionHandler(
  deps: Deps,
): RouteHandler<typeof deprecateVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const questionId = requireQuestionId(id);
    const version = requireVersion(v);

    const deprecated = await deps.db.transaction(async (tx) => {
      const current = await getQuestionVersion(tx, questionId, version);
      if (current === undefined) throw fail.versionNotFound();
      // Deprecation soft-retires a published version (§4.2). A draft has nothing
      // to retire; an already-deprecated version is a no-op.
      if (current.status !== "published") throw fail.invalidState(current.status, "deprecate");

      const row = await deprecateQuestionVersion(tx, { questionId, version });
      return row;
    });

    if (deprecated === undefined) throw fail.versionNotFound();
    return c.json(toVersionView(deprecated), 200);
  };
}

// --- GET /admin/questions ---------------------------------------------------

export function makeListQuestionsHandler(
  deps: Deps,
): RouteHandler<typeof listQuestionsRoute, ApiEnv> {
  return async (c) => {
    const { status, type, search, versions } = c.req.valid("query");
    const summaries = await listQuestions(deps.db);

    const byStatus =
      status === undefined ? summaries : summaries.filter((s) => s.latestStatus === status);

    // `?versions=all` reads every version of every listed question in ONE query, and it
    // is what stops the form builder issuing `1 + N` HTTP calls to assemble the same
    // thing from the detail route (issue #684). It is loaded before the loop rather than
    // inside it for the same reason: a per-row read here would have moved the fan-out
    // from HTTP to SQL and called it a fix.
    const versionsById =
      versions === undefined
        ? undefined
        : groupByQuestion(
            await listVersionsForQuestions(
              deps.db,
              byStatus.map((s) => s.questionId),
            ),
          );

    // Load each latest definition for its label and type (display + label search
    // + type filter). One read per row is fine at launch admin scale; a JOIN or a
    // denormalized label is a Phase-4 optimization, not a launch need (R7).
    // Sequential so the reads never overlap on a shared connection handle.
    //
    // When the versions were asked for, that read is already done: the latest is one
    // entry of the list this row is about to carry, so the summary path costs nothing
    // extra and the per-row read is skipped entirely.
    const items = [];
    for (const s of byStatus) {
      const all = versionsById?.get(s.questionId);
      const latest =
        all === undefined
          ? await getQuestionVersion(deps.db, s.questionId, s.latestVersion)
          : all.find((row) => row.version === s.latestVersion);
      const label = latest === undefined ? null : labelOf(latest.definition);
      items.push({
        questionId: s.questionId,
        slug: s.slug,
        createdAt: s.createdAt.toISOString(),
        latestVersion: s.latestVersion,
        latestStatus: s.latestStatus,
        publishedAt: s.publishedAt === null ? null : s.publishedAt.toISOString(),
        label,
        type: latest === undefined ? null : typeOf(latest.definition),
        // Absent, not empty, when the caller did not ask: the two are different answers
        // and the schema keeps them so.
        ...(all === undefined ? {} : { versions: all.map(toVersionView) }),
      });
    }

    // The type filter is applied here rather than in the query above because the
    // type lives in the definition JSON these reads just fetched, not in the
    // summary row. A row whose latest version is missing has no type, so it can
    // never match a type filter.
    const byType = type === undefined ? items : items.filter((q) => q.type === type);

    const needle = search?.trim().toLowerCase();
    const questions =
      needle === undefined || needle === ""
        ? byType
        : byType.filter(
            (q) => q.slug.toLowerCase().includes(needle) || labelMatches(q.label, needle),
          );

    return c.json({ questions }, 200);
  };
}

/**
 * Partition one flat version read by question id, keeping the query's order within each
 * group (issue #684).
 *
 * The query orders by `(questionId, version)`, so appending in arrival order leaves every
 * group oldest first, which is the order the detail route already publishes and the order
 * a version list is read in.
 */
function groupByQuestion(rows: readonly QuestionVersionRow[]): Map<string, QuestionVersionRow[]> {
  const byQuestion = new Map<string, QuestionVersionRow[]>();
  for (const row of rows) {
    const group = byQuestion.get(row.questionId);
    if (group === undefined) byQuestion.set(row.questionId, [row]);
    else group.push(row);
  }
  return byQuestion;
}

/** Substring-match a needle against any locale value of a localized label. */
function labelMatches(label: unknown, needle: string): boolean {
  if (label === null || typeof label !== "object") return false;
  return Object.values(label as Record<string, unknown>).some(
    (v) => typeof v === "string" && v.toLowerCase().includes(needle),
  );
}

// --- GET /admin/questions/:id -----------------------------------------------

export function makeGetQuestionHandler(deps: Deps): RouteHandler<typeof getQuestionRoute, ApiEnv> {
  return async (c) => {
    const questionId = requireQuestionId(c.req.valid("param").id);

    const identity = await getQuestion(deps.db, questionId);
    if (identity === undefined) throw fail.questionNotFound();

    const versions = await listQuestionVersions(deps.db, questionId);

    return c.json(
      {
        questionId: identity.questionId,
        slug: identity.slug,
        createdAt: identity.createdAt.toISOString(),
        versions: versions.map(toVersionView),
      },
      200,
    );
  };
}

// --- GET /admin/questions/:id/versions/:v/preview ---------------------------

/**
 * The synthetic step id a preview document carries. A library question belongs
 * to no step, but the response is shaped like a served step document so the
 * shared renderer needs no preview-specific branch. It is never persisted and
 * never pinned, so it cannot collide with a real `stp_…` id (R6).
 */
const PREVIEW_STEP_ID = "stp_preview";

/**
 * The locale a preview falls back to: an unparseable (or absent) `?locale=`
 * resolves here rather than erroring. A preview is a display aid, so a stray
 * query param must never cost the author their preview. `en` is the launch
 * locale (R7 - no second locale before Phase 4); parsed through the kernel so
 * this constant is a real branded `LocaleCode`, not a cast.
 */
const PREVIEW_FALLBACK_LOCALE: LocaleCode = LocaleCode.parse("en");

/** Coerce the `?locale=` query param to a LocaleCode, falling back to `en`. */
function previewLocale(raw: string | undefined): LocaleCode {
  if (raw === undefined) return PREVIEW_FALLBACK_LOCALE;
  const parsed = parseLocaleCode(raw);
  return parsed.ok ? parsed.value : PREVIEW_FALLBACK_LOCALE;
}

/**
 * The preview's {@link TextResolver}: requested locale, then *any* locale the
 * text carries, then the empty string. Deliberately looser than the compiler's
 * own resolver (which throws when the form's defaultLocale is missing, publish
 * invariant I3): a draft under authoring is routinely incomplete, and an author
 * asking to look at it must get a preview back, not a 500.
 */
function previewTextResolver(locale: LocaleCode): TextResolver {
  return (text: LocalizedText) => text[locale] ?? Object.values(text)[0] ?? "";
}

/**
 * Compile ONE question version to a single-question A2UI document for the admin
 * preview pane (032). The admin app is a strict BFF (R2) and never imports the
 * compiler or the kernel: it renders this `root` through the same shared
 * renderer (028) the portal uses, so what an author sees is what a respondent
 * will get.
 *
 * **This is a preview recompilation of a possibly-unpublished draft**, which is
 * exactly why it lives on the admin group and is emphatically NOT the serving
 * path: the portal serves the *stored* compiled document from a pinned snapshot
 * and never a recompilation (ADR-18). Nothing here is stored.
 *
 * The wrapper mirrors `staticStepResolver` (`Form → Flex(column)`) so the
 * renderer needs no preview-specific branch, minus two things a real step
 * carries:
 *  - **no headings** - the form-title `h1` and step-title `h2` describe a step
 *    in a form, and a library question belongs to no form here;
 *  - **no honeypot** - the decoy is an abuse control for respondent-facing
 *    steps (026). An admin preview is authenticated and never submitted, so a
 *    decoy would be pure noise in the author's view, and shipping an abuse
 *    trap outside the surface it protects is a way to teach its shape.
 */
export function makePreviewQuestionVersionHandler(
  deps: Deps,
): RouteHandler<typeof previewQuestionVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const questionId = requireQuestionId(id);
    const version = requireVersion(v);
    const locale = previewLocale(c.req.valid("query").locale);

    // The question identity is checked separately from the version so a typo in
    // the id and a typo in the version stay distinguishable to the caller.
    const identity = await getQuestion(deps.db, questionId);
    if (identity === undefined) throw fail.questionNotFound();

    const row = await getQuestionVersion(deps.db, questionId, version);
    if (row === undefined) throw fail.versionNotFound();

    // Stored definitions are kernel-parsed on the way in (create/edit both go
    // through `requireQuestionDefinition`), so the row is a valid QuestionDefinition and
    // `questionToNode` is total over it - no re-validation here.
    const questionNode = questionToNode(row.definition, previewTextResolver(locale), locale);

    return c.json(
      {
        stepId: PREVIEW_STEP_ID,
        root: {
          type: "Form",
          children: [
            {
              type: "Flex",
              props: { direction: "column", gap: "md" },
              children: [questionNode],
            },
          ],
        },
        a2uiSpecVersion: A2UI_SPEC_VERSION,
        compilerVersion: COMPILER_VERSION,
      },
      200,
    );
  };
}
