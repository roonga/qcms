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
  getSharedWorkspace,
  listQuestions,
  listVersionsForQuestions,
  publishQuestionVersion,
  updateDraftDefinition,
} from "@roonga/qcms-db";
import type { QuestionStatus, QuestionVersionRow } from "@roonga/qcms-db";

import type { Deps } from "../../deps.js";
import { ApiError } from "../../errors.js";
import { type GrantContext, workspaceFilterFor } from "../membership/context.js";
import type { ApiEnv } from "../../openapi.js";
import { resolveWorkspaceForNewObject } from "../workspaces/resolve.js";
import {
  createQuestionWithFirstDraft,
  requireQuestionDefinition,
  requireUnusedQuestionId,
} from "./create.js";
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

function requireQuestionId(id: string): QuestionId {
  const parsed = parseQuestionId(id);
  if (!parsed.ok) throw fail.invalidId();
  return parsed.value;
}

/**
 * `question_versions.version` is an `int4` column; without this bound Postgres refuses the
 * parameter and a caller who typed too many digits gets a 500 instead of a 404.
 */
const MAX_VERSION = 2_147_483_647;

function requireVersion(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VERSION) throw fail.versionNotFound();
  return n;
}

function toVersionView(row: QuestionVersionRow): QuestionVersionView {
  return {
    questionId: row.questionId,
    version: row.version,
    status: row.status,
    definition: row.definition,
    publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
  };
}

function labelOf(definition: QuestionDefinition): unknown {
  return (definition as { label?: unknown }).label;
}

/** Read positionally: a stored definition is already kernel-valid, so its `type` is one of the seven. */
function typeOf(definition: QuestionDefinition): QuestionListItem["type"] {
  return (definition as { type: QuestionListItem["type"] }).type;
}

export function makeCreateQuestionHandler(
  deps: Deps,
): RouteHandler<typeof createQuestionRoute, ApiEnv> {
  return async (c) => {
    const body = c.req.valid("json");
    const definition = requireQuestionDefinition(body.definition);

    await requireUnusedQuestionId(deps.databases, definition.questionId);

    const workspaceId = await resolveWorkspaceForNewObject(
      deps.databases.control,
      body.workspaceId,
    );

    const created = await deps.databases.control.transaction((tx) =>
      createQuestionWithFirstDraft(tx, { definition, slug: body.slug, workspaceId }),
    );

    return c.json(
      {
        questionId: created.question.questionId,
        slug: created.question.slug,
        workspaceId: created.question.workspaceId,
        createdAt: created.question.createdAt.toISOString(),
        version: toVersionView(created.version),
      },
      201,
    );
  };
}

export function makeCreateVersionHandler(
  deps: Deps,
): RouteHandler<typeof createVersionRoute, ApiEnv> {
  return async (c) => {
    const questionId = requireQuestionId(c.req.valid("param").id);

    const created = await deps.databases.control.transaction(async (tx) => {
      const versions = await listQuestionVersions(tx, questionId);
      const latest = versions.at(-1);
      if (latest === undefined) throw fail.questionNotFound();

      const row = await createQuestionVersion(tx, {
        questionId,
        definition: latest.definition,
      });
      return row;
    });

    return c.json(toVersionView(created), 201);
  };
}

export function makeEditVersionHandler(deps: Deps): RouteHandler<typeof editVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const questionId = requireQuestionId(id);
    const version = requireVersion(v);
    const definition = requireQuestionDefinition(c.req.valid("json").definition);

    if (definition.questionId !== questionId) throw fail.idMismatch();

    const updated = await deps.databases.control.transaction(async (tx) => {
      const current = await getQuestionVersion(tx, questionId, version);
      if (current === undefined) throw fail.versionNotFound();
      // Typed 409 before the `question_versions_freeze_published` trigger fires, which
      // would surface as a 500.
      if (current.status !== "draft") throw fail.immutable();

      const row = await updateDraftDefinition(tx, { questionId, version, definition });
      return row;
    });

    if (updated === undefined) throw fail.versionNotFound();
    return c.json(toVersionView(updated), 200);
  };
}

export function makePublishVersionHandler(
  deps: Deps,
): RouteHandler<typeof publishVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const questionId = requireQuestionId(id);
    const version = requireVersion(v);

    const published = await deps.databases.control.transaction(async (tx) => {
      const current = await getQuestionVersion(tx, questionId, version);
      if (current === undefined) throw fail.versionNotFound();
      if (current.status !== "draft") throw fail.invalidState(current.status, "publish");

      const row = await publishQuestionVersion(tx, { questionId, version });
      return row;
    });

    if (published === undefined) throw fail.versionNotFound();
    return c.json(toVersionView(published), 200);
  };
}

export function makeDeprecateVersionHandler(
  deps: Deps,
): RouteHandler<typeof deprecateVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const questionId = requireQuestionId(id);
    const version = requireVersion(v);

    const deprecated = await deps.databases.control.transaction(async (tx) => {
      const current = await getQuestionVersion(tx, questionId, version);
      if (current === undefined) throw fail.versionNotFound();
      if (current.status !== "published") throw fail.invalidState(current.status, "deprecate");

      const row = await deprecateQuestionVersion(tx, { questionId, version });
      return row;
    });

    if (deprecated === undefined) throw fail.versionNotFound();
    return c.json(toVersionView(deprecated), 200);
  };
}

/**
 * The shared question library is a read surface to every other workspace (ADR-41), so it
 * is added to the caller's own workspaces here rather than inside the query helper.
 */
async function readableWorkspaces(
  deps: Deps,
  grant: GrantContext | undefined,
): Promise<{ workspaceIds?: readonly string[] }> {
  const filter = workspaceFilterFor(grant);
  const held = filter.workspaceIds;
  if (held === undefined) return {};
  const shared = await getSharedWorkspace(deps.databases.control);
  if (shared === undefined || held.includes(shared.id)) return { workspaceIds: held };
  return { workspaceIds: [...held, shared.id] };
}

export function makeListQuestionsHandler(
  deps: Deps,
): RouteHandler<typeof listQuestionsRoute, ApiEnv> {
  return async (c) => {
    const { status, type, search, versions } = c.req.valid("query");
    const summaries = await listQuestions(
      deps.databases.control,
      await readableWorkspaces(deps, c.get("grantContext")),
    );

    const byStatus =
      status === undefined ? summaries : summaries.filter((s) => s.latestStatus === status);

    const versionsById =
      versions === undefined
        ? undefined
        : groupByQuestion(
            await listVersionsForQuestions(
              deps.databases.control,
              byStatus.map((s) => s.questionId),
            ),
          );

    // Sequential so the per-row reads never overlap on a shared connection handle.
    const items = [];
    for (const s of byStatus) {
      const all = versionsById?.get(s.questionId);
      const latest =
        all === undefined
          ? await getQuestionVersion(deps.databases.control, s.questionId, s.latestVersion)
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
        ...(all === undefined ? {} : { versions: all.map(toVersionView) }),
      });
    }

    // Filtered here rather than in the query because the type lives in the definition
    // JSON these reads just fetched, not in the summary row.
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
 * The query orders by `(questionId, version)`, so appending in arrival order leaves every
 * group oldest first, which is the order the detail route publishes.
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

function labelMatches(label: unknown, needle: string): boolean {
  if (label === null || typeof label !== "object") return false;
  return Object.values(label as Record<string, unknown>).some(
    (v) => typeof v === "string" && v.toLowerCase().includes(needle),
  );
}

export function makeGetQuestionHandler(deps: Deps): RouteHandler<typeof getQuestionRoute, ApiEnv> {
  return async (c) => {
    const questionId = requireQuestionId(c.req.valid("param").id);

    const identity = await getQuestion(deps.databases.control, questionId);
    if (identity === undefined) throw fail.questionNotFound();

    const versions = await listQuestionVersions(deps.databases.control, questionId);

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

/** Never persisted and never pinned, so it cannot collide with a real `stp_…` id (R6). */
const PREVIEW_STEP_ID = "stp_preview";

/**
 * An unparseable or absent `?locale=` resolves here rather than erroring: a preview is a
 * display aid, so a stray query param must never cost the author their preview.
 */
const PREVIEW_FALLBACK_LOCALE: LocaleCode = LocaleCode.parse("en");

function previewLocale(raw: string | undefined): LocaleCode {
  if (raw === undefined) return PREVIEW_FALLBACK_LOCALE;
  const parsed = parseLocaleCode(raw);
  return parsed.ok ? parsed.value : PREVIEW_FALLBACK_LOCALE;
}

/**
 * Looser than the compiler's own resolver, which throws on a missing defaultLocale (I3): a
 * draft under authoring is routinely incomplete and must still preview rather than 500.
 */
function previewTextResolver(locale: LocaleCode): TextResolver {
  return (text: LocalizedText) => text[locale] ?? Object.values(text)[0] ?? "";
}

/**
 * A recompilation of a possibly-unpublished draft, never the serving path: the portal
 * serves the stored compiled document from a pinned snapshot (ADR-18), and nothing here is
 * stored. No honeypot either: the decoy is an abuse control for respondent-facing steps,
 * and shipping it outside the surface it protects teaches its shape.
 */
export function makePreviewQuestionVersionHandler(
  deps: Deps,
): RouteHandler<typeof previewQuestionVersionRoute, ApiEnv> {
  return async (c) => {
    const { id, v } = c.req.valid("param");
    const questionId = requireQuestionId(id);
    const version = requireVersion(v);
    const locale = previewLocale(c.req.valid("query").locale);

    // Checked separately from the version so a typo in the id and a typo in the version
    // stay distinguishable to the caller.
    const identity = await getQuestion(deps.databases.control, questionId);
    if (identity === undefined) throw fail.questionNotFound();

    const row = await getQuestionVersion(deps.databases.control, questionId, version);
    if (row === undefined) throw fail.versionNotFound();

    // Stored definitions are kernel-parsed on the way in, so `questionToNode` is total
    // over the row and needs no re-validation here.
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
