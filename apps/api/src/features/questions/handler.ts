/**
 * Admin question-authoring handlers (task 021) - honest transaction scripts (R5).
 *
 * The question library, headless: create a question with a first draft version,
 * seed new draft versions, edit drafts, publish, deprecate, and read. The kernel
 * (`QuestionDefinition`, 003) validates every definition; the `@qcms/db` helpers
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
  parseQuestionDefinition,
  parseQuestionId,
  type QuestionDefinition,
  type QuestionDefinitionError,
  type QuestionId,
} from "@qcms/core";
import {
  createQuestion,
  createQuestionVersion,
  deprecateQuestionVersion,
  getQuestion,
  getQuestionVersion,
  isQuestionIdTaken,
  listQuestionVersions,
  listQuestions,
  publishQuestionVersion,
  updateDraftDefinition,
} from "@qcms/db";
import type { Executor } from "@qcms/db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import type { ApiEnv } from "../../openapi.js";
import type {
  createQuestionRoute,
  createVersionRoute,
  deprecateVersionRoute,
  editVersionRoute,
  getQuestionRoute,
  listQuestionsRoute,
  publishVersionRoute,
} from "./route.js";
import type { QuestionVersionView } from "./schema.js";

// --- issue #5 launder --------------------------------------------------------
// `@qcms/db`'s row types resolve to a TypeScript *error* type through the
// package's emitted `.d.ts` - the `$inferSelect` + `PgEnumColumn` interaction
// that `skipLibCheck` hides from `tsc` but typed-lint surfaces as unsafe (issue
// #5). Reading each row through a narrow local view with a single cast on an
// *unannotated* const keeps this slice fully typed - the identical pattern to
// responses' `SessionView` (018/019/020). Do not "fix" @qcms/db here.
type VersionStatus = "draft" | "published" | "deprecated";
interface VersionRowView {
  readonly questionId: QuestionId;
  readonly version: number;
  readonly status: VersionStatus;
  readonly definition: QuestionDefinition;
  readonly publishedAt: Date | null;
}
interface QuestionRowView {
  readonly questionId: QuestionId;
  readonly slug: string;
  readonly createdAt: Date;
}
interface SummaryView {
  readonly questionId: QuestionId;
  readonly slug: string;
  readonly createdAt: Date;
  readonly latestVersion: number;
  readonly latestStatus: VersionStatus;
  readonly publishedAt: Date | null;
}

// --- typed failures (envelope codes the admin app keys off, 032) -------------

const fail = {
  invalidId: (): ApiError => new ApiError("INVALID_QUESTION_ID", 400, "Malformed question id"),
  invalidDefinition: (issues: readonly QuestionDefinitionError[]): ApiError =>
    new ApiError("INVALID_QUESTION_DEFINITION", 422, "The question definition is invalid", {
      issues,
    }),
  idMismatch: (): ApiError =>
    new ApiError(
      "QUESTION_ID_MISMATCH",
      422,
      "The definition's questionId does not match the path id (identity is fixed, R6)",
    ),
  idReused: (): ApiError =>
    new ApiError(
      "QUESTION_ID_REUSED",
      409,
      "This questionId has been used before; ids are never reused (R6)",
    ),
  slugTaken: (): ApiError => new ApiError("SLUG_TAKEN", 409, "That slug is already in use"),
  questionNotFound: (): ApiError => new ApiError("QUESTION_NOT_FOUND", 404, "No such question"),
  versionNotFound: (): ApiError =>
    new ApiError("VERSION_NOT_FOUND", 404, "No such question version"),
  immutable: (): ApiError =>
    new ApiError(
      "VERSION_IMMUTABLE",
      409,
      "Only draft versions can be edited; publish creates immutable content (R1/I1)",
    ),
  invalidState: (from: VersionStatus, action: string): ApiError =>
    new ApiError("INVALID_VERSION_STATE", 409, `Cannot ${action} a ${from} version`),
} as const;

// --- shared helpers ---------------------------------------------------------

/** Parse a `:id` path param to a QuestionId, or 400. */
function requireQuestionId(id: string): QuestionId {
  const parsed = parseQuestionId(id);
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
function requireDefinition(value: unknown): QuestionDefinition {
  const parsed = parseQuestionDefinition(value);
  if (!parsed.ok) throw fail.invalidDefinition(parsed.error);
  return parsed.value;
}

/** Shape a stored version row into its response view. */
function toVersionView(row: VersionRowView): QuestionVersionView {
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
 * True for a Postgres unique-violation (SQLSTATE 23505). drizzle wraps the pg
 * error, so the code can sit on the error or on its `cause` - check both.
 */
function isUniqueViolation(err: unknown): boolean {
  const codeOf = (e: unknown): string | undefined =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return codeOf(err) === "23505" || codeOf((err as { cause?: unknown }).cause) === "23505";
}

/** Insert the library identity, mapping a slug-unique collision to a clean 409. */
async function insertQuestionRow(
  exec: Executor,
  questionId: QuestionId,
  slug: string,
): Promise<QuestionRowView> {
  try {
    const row = (await createQuestion(exec, { questionId, slug })) as QuestionRowView;
    return row;
  } catch (err: unknown) {
    if (isUniqueViolation(err)) throw fail.slugTaken();
    throw err;
  }
}

// --- POST /admin/questions --------------------------------------------------

export function makeCreateQuestionHandler(
  deps: Deps,
): RouteHandler<typeof createQuestionRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const definition = requireDefinition(body.definition);
    const questionId = definition.questionId;

    const created = await deps.db.transaction(async (tx) => {
      // R6: reject any id ever used - including a deprecated/erased one.
      if (await isQuestionIdTaken(tx, questionId)) throw fail.idReused();

      // R6 passed: insert the identity (slug collision → clean 409) then its
      // first draft version.
      const question = await insertQuestionRow(tx, questionId, body.slug);
      const version = (await createQuestionVersion(tx, {
        questionId,
        definition,
      })) as VersionRowView;

      return { question, version };
    });

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
      const versions = (await listQuestionVersions(tx, questionId)) as VersionRowView[];
      const latest = versions.at(-1);
      if (latest === undefined) throw fail.questionNotFound();

      // Seed the new draft from the latest version's definition (the author
      // then edits it via PUT). A fresh draft is always editable.
      const row = (await createQuestionVersion(tx, {
        questionId,
        definition: latest.definition,
      })) as VersionRowView;
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
    const definition = requireDefinition(c.req.valid("json").definition);

    // Identity is fixed (R6): a draft edit cannot repoint the version's id.
    if (definition.questionId !== questionId) throw fail.idMismatch();

    const updated = await deps.db.transaction(async (tx) => {
      const current = (await getQuestionVersion(tx, questionId, version)) as
        VersionRowView | undefined;
      if (current === undefined) throw fail.versionNotFound();
      // Return the typed immutability error *before* the freeze trigger fires.
      if (current.status !== "draft") throw fail.immutable();

      const row = (await updateDraftDefinition(tx, { questionId, version, definition })) as
        VersionRowView | undefined;
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
      const current = (await getQuestionVersion(tx, questionId, version)) as
        VersionRowView | undefined;
      if (current === undefined) throw fail.versionNotFound();
      // Only a draft can be published (§4.2). A published/deprecated version is
      // a no-op-or-worse: report the invalid transition rather than re-stamping.
      if (current.status !== "draft") throw fail.invalidState(current.status, "publish");

      const row = (await publishQuestionVersion(tx, { questionId, version })) as
        VersionRowView | undefined;
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
      const current = (await getQuestionVersion(tx, questionId, version)) as
        VersionRowView | undefined;
      if (current === undefined) throw fail.versionNotFound();
      // Deprecation soft-retires a published version (§4.2). A draft has nothing
      // to retire; an already-deprecated version is a no-op.
      if (current.status !== "published") throw fail.invalidState(current.status, "deprecate");

      const row = (await deprecateQuestionVersion(tx, { questionId, version })) as
        VersionRowView | undefined;
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
    const { status, search } = c.req.valid("query");
    const summaries = (await listQuestions(deps.db)) as SummaryView[];

    const byStatus =
      status === undefined ? summaries : summaries.filter((s) => s.latestStatus === status);

    // Load each latest definition for its label (display + label search). One
    // read per row is fine at launch admin scale; a JOIN/denormalized label is
    // a Phase-4 optimization, not a launch need (R7). Sequential so the reads
    // never overlap on a shared connection handle.
    const items = [];
    for (const s of byStatus) {
      const latest = (await getQuestionVersion(deps.db, s.questionId, s.latestVersion)) as
        VersionRowView | undefined;
      const label = latest === undefined ? null : labelOf(latest.definition);
      items.push({
        questionId: s.questionId,
        slug: s.slug,
        createdAt: s.createdAt.toISOString(),
        latestVersion: s.latestVersion,
        latestStatus: s.latestStatus,
        publishedAt: s.publishedAt === null ? null : s.publishedAt.toISOString(),
        label,
      });
    }

    const needle = search?.trim().toLowerCase();
    const questions =
      needle === undefined || needle === ""
        ? items
        : items.filter(
            (q) => q.slug.toLowerCase().includes(needle) || labelMatches(q.label, needle),
          );

    return c.json({ questions }, 200);
  };
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

    const identity = (await getQuestion(deps.db, questionId)) as QuestionRowView | undefined;
    if (identity === undefined) throw fail.questionNotFound();

    const versions = (await listQuestionVersions(deps.db, questionId)) as VersionRowView[];

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
