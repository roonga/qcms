import { cache } from "react";

import type { PreviewOutcome, PreviewReason } from "../forms/builder-state.ts";
import { parseIssues } from "../forms/issues.ts";
import type {
  CompiledStep,
  DraftForm,
  DraftPreview,
  FormDetail,
  FormIssue,
  FormListItem,
  FormSettings,
  FormVersionSnapshot,
  FormVersionSummary,
  PinnableQuestion,
} from "../forms/types.ts";
import type { QuestionListItem } from "../questions/types.ts";

import { adminApiFetch } from "./api.ts";
import type { ApiResult } from "./api-result.ts";
import { readResult as read } from "./api-result.ts";
import type { AdminSession } from "./session.ts";

/**
 * The form builder's calls into the API's `/admin` group (task 033, R2).
 *
 * The same proxy this app's questions client is: build a path, hand it to the one
 * credentialed client (`api.ts`), read the answer. Nothing here decides whether a draft is
 * legal, whether a target is reachable, or whether a pin may point where it points. Those
 * are the kernel's answers and they arrive as `issues`; the admin takes no `@roonga/qcms-core`
 * value import at all and `r2-import-surface.test.ts` is what keeps that true.
 *
 * Two normalisations happen here, and both are presentation rather than authority:
 *
 * - **`ApiResult`**, the shape `questions.ts` settled on and `api-result.ts` now owns, so
 *   every screen has one error shape to render instead of re-deriving the API's two
 *   envelopes.
 * - **Reading the `unknown`s.** The route schemas type `draft` and `issues[]` as
 *   `unknown`, because the kernel owns those shapes and the API declines to restate them.
 *   A screen still has to render them, so they are read into the view types here, in one
 *   place, tolerantly: an issue with an unfamiliar `code` is carried through untouched
 *   rather than dropped.
 */

export type { ApiResult };

// --- the form library -------------------------------------------------------

/** `GET /admin/forms` - every form, with its draft and published state. */
export async function listForms(
  session: AdminSession,
): Promise<ApiResult<readonly FormListItem[]>> {
  const result = await read<{ forms: FormListItem[] }>(await adminApiFetch(session, "/forms"));
  return result.ok ? { ok: true, data: result.data.forms } : result;
}

/** `POST /admin/forms` - the identity and its empty first draft, in one call. */
export async function createForm(
  session: AdminSession,
  body: { readonly formId: string; readonly slug: string; readonly defaultLocale: string },
): Promise<ApiResult<{ readonly formId: string }>> {
  return read<{ formId: string }>(await adminApiFetch(session, "/forms", { method: "POST", body }));
}

// --- the working draft ------------------------------------------------------

/**
 * `GET /admin/forms/{id}` - identity, draft, versions, settings, challenge enforceability.
 *
 * `challengeEnforceable` is defaulted to `false` when the payload does not carry it, and
 * the direction of that default is deliberate: `false` is the state in which the settings
 * panel *warns* that `challengeRequired` is unenforceable, so a build talking to an API
 * that has not started sending the field errs towards telling the author more rather than
 * towards a switch that silently promises protection it may not have (ADR-24).
 *
 * ## Once per request, not once per tree (issue #626)
 *
 * `cache()` for the reason `currentAdminSession` carries it: a form-scoped screen is a
 * page and a `@rail` slot rendered from one request, neither can hand the other a
 * value, and both need the form, so the same `GET /admin/forms/{id}` went out twice per
 * render. `lib/server/form-rail.ts` and `lib/server/question-rail.ts` both stated that
 * cost in prose and named this as the place to change if it ever needed a cache.
 *
 * **The memo key is the argument list, by identity.** `session` is an object, so the
 * dedupe holds only because `currentAdminSession` is memoized too and every caller in
 * a request therefore holds the *same* session object. The two changes are one change,
 * and the test that counts a render's reads is what keeps them together.
 *
 * Per request and no longer, so nothing here can serve a form a mutation has already
 * changed: a server action runs before the re-render it triggers, and no action reads a
 * form. Across requests this memo does not exist.
 */
export const getForm: (session: AdminSession, formId: string) => Promise<ApiResult<FormDetail>> =
  cache(async (session: AdminSession, formId: string): Promise<ApiResult<FormDetail>> => {
    const result = await read<Record<string, unknown>>(
      await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}`),
    );
    if (!result.ok) return result;
    const raw = result.data;
    const defaultLocale = asString(raw["defaultLocale"], "en");
    return {
      ok: true,
      data: {
        formId: asString(raw["formId"], formId),
        slug: asString(raw["slug"], formId),
        defaultLocale,
        status: raw["status"] === "closed" ? "closed" : "open",
        draft: parseDraft(raw["draft"], formId, defaultLocale),
        draftSource: parseDraftSource(raw["draftSource"]),
        versions: parseVersions(raw["versions"]),
        settings: parseSettings(raw["settings"]),
        challengeEnforceable: raw["challengeEnforceable"] === true,
        // Task 041's provenance marker. Absent on a build talking to a pre-041 API,
        // which is why both default towards "nothing to disclose" rather than towards
        // showing a tag the API never actually promised.
        draftAgentAssisted: raw["draftAgentAssisted"] === true,
        draftUpdatedAt: typeof raw["draftUpdatedAt"] === "string" ? raw["draftUpdatedAt"] : null,
      },
    };
  });

/**
 * `PUT /admin/forms/{id}/draft` - advisory save: an inconsistent draft still stores.
 *
 * `agentAssisted` is omitted rather than sent `false` on every ordinary keystroke
 * autosave - task 041's marker is something the accept path asserts, not something
 * every ordinary edit disclaims. The response's own `agentAssisted` and `updatedAt`
 * are read back rather than assumed: whether this draft still carries the marker (and
 * what its fresh `clientState` token is, for the next assist call) is the server's
 * answer, not this app's guess.
 *
 * **One accept carrying proposed questions goes to a different endpoint** (issue
 * #823): `POST .../draft/assist/accept` stores the draft and creates those question
 * drafts in one transaction, because a draft that pins a question nothing created is
 * the defect that route exists to close. Choosing between the two here is proxy
 * routing, not business logic (R2) - which endpoint answers "save this accept" is a
 * fact about the API, and both answer with the same body.
 */
export async function saveDraft(
  session: AdminSession,
  formId: string,
  definition: DraftForm,
  agentAssisted?: boolean,
  newQuestions?: readonly unknown[],
): Promise<
  ApiResult<{
    readonly issues: readonly FormIssue[];
    readonly warnings: readonly FormIssue[];
    readonly agentAssisted: boolean;
    readonly updatedAt: string;
  }>
> {
  const accepting = newQuestions !== undefined && newQuestions.length > 0;
  const draftPath = `/forms/${encodeURIComponent(formId)}/draft` as const;

  const result = await read<{
    issues?: unknown;
    warnings?: unknown;
    agentAssisted?: unknown;
    updatedAt?: unknown;
  }>(
    accepting
      ? await adminApiFetch(session, `${draftPath}/assist/accept`, {
          method: "POST",
          body: {
            definition,
            newQuestions: newQuestions.map((question) => ({ definition: question })),
          },
        })
      : await adminApiFetch(session, draftPath, {
          method: "PUT",
          body: agentAssisted === undefined ? { definition } : { definition, agentAssisted },
        }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      issues: parseIssues(result.data.issues),
      warnings: parseIssues(result.data.warnings),
      agentAssisted: result.data.agentAssisted === true,
      updatedAt: asString(result.data.updatedAt, ""),
    },
  };
}

/**
 * `POST /admin/forms/{id}/draft/assist` - task 041's SSE turn.
 *
 * Returns the raw upstream `Response`, exactly as {@link exportResponses} does in
 * `lib/server/responses.ts`: the product of this call is an event stream for the
 * route handler to relay unbuffered, not a value for this module to parse. Parsing an
 * SSE body is `lib/forms/assist-stream.ts`'s job, and it runs in the browser, not
 * here - buffering the whole turn in this process just to re-serialize it would turn
 * a stream into a wait.
 */
export function assist(
  session: AdminSession,
  formId: string,
  body: {
    readonly conversation: readonly {
      readonly role: "user" | "assistant";
      readonly content: string;
    }[];
    readonly clientState?: string;
  },
): Promise<Response> {
  return adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/assist`, {
    method: "POST",
    body,
  });
}

/** `POST /admin/forms/{id}/draft/validate` - dry run, no save. */
export async function validateDraft(
  session: AdminSession,
  formId: string,
  definition: DraftForm,
): Promise<
  ApiResult<{
    readonly valid: boolean;
    readonly issues: readonly FormIssue[];
    readonly warnings: readonly FormIssue[];
  }>
> {
  const result = await read<{ valid?: unknown; issues?: unknown; warnings?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/validate`, {
      method: "POST",
      body: { definition },
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      valid: result.data.valid === true,
      issues: parseIssues(result.data.issues),
      // Same wire shape as an issue (code, message, structured path), so the same
      // reader parses it and the panel renders it through the same entry (#123).
      warnings: parseIssues(result.data.warnings),
    },
  };
}

/**
 * `PATCH /admin/forms/{id}/settings` - a **partial** patch of the abuse-control settings.
 *
 * Partial matters here twice over. `minSubmitMs: null` means "use the deployment's
 * configured floor" and is a value, while omitting the key means "leave it alone"; and the
 * route's schema refuses a patch carrying neither key, so the caller assembles only what
 * changed rather than sending both controls every time (`actions.ts` is where that guard
 * sits, because it is the last place that knows what the author actually touched).
 */
export async function updateSettings(
  session: AdminSession,
  formId: string,
  patch: { readonly challengeRequired?: boolean; readonly minSubmitMs?: number | null },
): Promise<ApiResult<{ readonly settings: FormSettings; readonly challengeEnforceable: boolean }>> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/settings`, {
      method: "PATCH",
      body: patch,
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      settings: parseSettings(result.data["settings"]),
      challengeEnforceable: result.data["challengeEnforceable"] === true,
    },
  };
}

/**
 * `POST /admin/forms/{id}/draft/preview-condition` - the rule test bench.
 *
 * The unsaved draft travels with the request, so the bench answers the definition on the
 * author's screen rather than the last one persisted. The hypothetical answers are
 * answer-shaped and are handled under the answer rules (SEC-13, ADR-34): they go up, a
 * verdict comes back, and nothing here logs, stores or echoes them.
 */
export async function previewCondition(
  session: AdminSession,
  formId: string,
  request: {
    readonly definition: DraftForm;
    readonly ruleId: string;
    readonly answers: Readonly<Record<string, unknown>>;
  },
): Promise<
  ApiResult<{
    readonly outcome: PreviewOutcome;
    readonly reason: PreviewReason | undefined;
    readonly references: readonly string[];
  }>
> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/preview-condition`, {
      method: "POST",
      body: request,
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      outcome: parseOutcome(result.data["outcome"]),
      reason: parseReason(result.data["reason"]),
      references: asStringList(result.data["references"]),
    },
  };
}

// --- publish, preview, versions and lifecycle (task 034) --------------------

/**
 * `POST /admin/forms/{id}/publish` - freeze a version.
 *
 * The failure this screen exists to render is a 422 whose `details.issues` is the
 * kernel's `PublishError[]` verbatim, which `readFailure` already lifts into
 * `result.issues`. Nothing is decided here and nothing is filtered: publish either
 * happened, or the author gets every reason it did not.
 */
export async function publishForm(
  session: AdminSession,
  formId: string,
): Promise<ApiResult<{ readonly version: number; readonly publishedAt: string }>> {
  const result = await read<{ version?: unknown; publishedAt?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/publish`, {
      method: "POST",
    }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      version: typeof result.data.version === "number" ? result.data.version : 0,
      publishedAt: asString(result.data.publishedAt, ""),
    },
  };
}

/**
 * `POST /admin/forms/{id}/draft/preview` - the dry-run compile the preview pane renders.
 *
 * The draft on the author's screen travels with the request (like validate and like the
 * rule bench) so the pane previews the unsaved edit rather than the last one persisted.
 * `answers` is the author's walk-through state and is handled under the answer rules
 * (SEC-13 / ADR-34): forwarded, never logged here, never stored, never echoed back.
 */
export async function previewDraft(
  session: AdminSession,
  formId: string,
  request: {
    readonly definition: DraftForm;
    readonly answers: Readonly<Record<string, unknown>>;
  },
): Promise<ApiResult<DraftPreview>> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/draft/preview`, {
      method: "POST",
      body: request,
    }),
  );
  if (!result.ok) return result;
  const raw = result.data;
  const flow = (raw["flow"] ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      documents: parseCompiledSteps(raw["documents"]),
      compilerVersion: asString(raw["compilerVersion"], ""),
      a2uiSpecVersion: asString(raw["a2uiSpecVersion"], ""),
      flow: {
        visibleSteps: asStringList(flow["visibleSteps"]),
        visibleQuestions: asStringList(flow["visibleQuestions"]),
        complete: flow["complete"] === true,
      },
    },
  };
}

/**
 * `GET /admin/forms/{id}/versions/{v}` - one frozen snapshot, whole.
 *
 * The compiled documents come back out of the version's JSONB, which is the entire point
 * of the history screen: it renders the **stored** audit copy, so what it shows is what
 * respondents on that version actually saw (ADR-18). There is deliberately no call to the
 * draft-preview endpoint anywhere on this path.
 */
export async function getFormVersion(
  session: AdminSession,
  formId: string,
  version: number,
): Promise<ApiResult<FormVersionSnapshot>> {
  const result = await read<Record<string, unknown>>(
    await adminApiFetch(
      session,
      `/forms/${encodeURIComponent(formId)}/versions/${encodeURIComponent(String(version))}`,
    ),
  );
  if (!result.ok) return result;
  const raw = result.data;
  const compiled = (raw["compiled"] ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    data: {
      formId: asString(raw["formId"], formId),
      version: typeof raw["version"] === "number" ? raw["version"] : version,
      publishedAt: asString(raw["publishedAt"], ""),
      compilerVersion: asString(raw["compilerVersion"], ""),
      a2uiSpecVersion: asString(raw["a2uiSpecVersion"], ""),
      semanticsVersion: asString(raw["semanticsVersion"], ""),
      definition: raw["definition"],
      documents: parseCompiledSteps(compiled["documents"]),
    },
  };
}

/**
 * `POST /admin/forms/{id}/close` and `/reopen` - the door for *new* sessions only.
 *
 * R1 is the thing the UI copy has to teach here: closing stops new sessions and leaves
 * every in-flight one to finish on the version it pinned. This proxy just forwards.
 */
export async function setFormStatus(
  session: AdminSession,
  formId: string,
  action: "close" | "reopen",
): Promise<ApiResult<{ readonly status: "open" | "closed" }>> {
  const result = await read<{ status?: unknown }>(
    await adminApiFetch(session, `/forms/${encodeURIComponent(formId)}/${action}`, {
      method: "POST",
    }),
  );
  if (!result.ok) return result;
  return { ok: true, data: { status: result.data.status === "closed" ? "closed" : "open" } };
}

// --- the pinnable library ---------------------------------------------------

/**
 * Every question the builder can pin, with every version it could pin to: **one read**
 * (issue #684).
 *
 * The list route's default summary reports only the **latest** version and its status
 * (`types.ts` explains why that is not enough): a question whose latest version is a
 * draft on top of a published v1 would otherwise look unpinnable while v1 sits there,
 * pinnable. `?versions=all` is the route answering that question directly, and the whole
 * library arrives in one round trip.
 *
 * ## What this replaced, and why the shape was the defect rather than the code
 *
 * This used to be the list read plus a **detail read per question**, run together with
 * `Promise.all` and carefully degraded. `1 + N` API calls on every builder page load,
 * with N the size of the entire library and no filter, no limit and no pagination in
 * sight - so a three-hundred-question library meant three hundred and one round trips
 * before the author had opened the picker at all. The API-side fan-out was the same shape
 * one layer down: `listVersionsForQuestions` now reads every version in one query.
 *
 * The reasoning for the old shape was correct and its failure handling was careful; what
 * was missing was a route that could answer the question. `add-question-poc.html` names
 * the same defect from the design side ("ships the whole library to the browser and
 * filters it client-side, which does not hold up against a library of several hundred
 * questions") and assumes a server-driven picker. This is the half of that which removes
 * the round trips; the picker's own search is still client-side over what it is given,
 * and that is issue #660's ground rather than this one's.
 *
 * ## Tolerance is kept, and it moves with the read
 *
 * A question the response carries **without** a version list is dropped rather than
 * failing the whole screen, exactly as a failed detail read was: a library the author can
 * mostly use beats a builder that will not open. Only a failure of the read itself fails
 * the call, because that one leaves nothing to show.
 */
export async function loadPinnableQuestions(
  session: AdminSession,
): Promise<ApiResult<readonly PinnableQuestion[]>> {
  const list = await read<{ questions: QuestionListItem[] }>(
    await adminApiFetch(session, "/questions?versions=all"),
  );
  if (!list.ok) return list;

  const pinnable: PinnableQuestion[] = [];
  for (const question of list.data.questions) {
    const versions = question.versions;
    if (versions === undefined) continue;
    pinnable.push({
      questionId: question.questionId,
      slug: question.slug,
      label: question.label,
      type: question.type,
      versions: versions.map((version) => ({
        version: version.version,
        status: version.status,
        definition: version.definition,
      })),
    });
  }
  return { ok: true, data: pinnable };
}

// --- reading the API's `unknown`s -------------------------------------------

function asString(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw !== "" ? raw : fallback;
}

function asStringList(raw: unknown): readonly string[] {
  return Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseDraftSource(raw: unknown): FormDetail["draftSource"] {
  return raw === "open" || raw === "seeded" ? raw : "none";
}

function parseSettings(raw: unknown): FormSettings {
  const source = (raw ?? {}) as { challengeRequired?: unknown; minSubmitMs?: unknown };
  return {
    challengeRequired: source.challengeRequired === true,
    minSubmitMs: typeof source.minSubmitMs === "number" ? source.minSubmitMs : null,
  };
}

function parseOutcome(raw: unknown): PreviewOutcome {
  return raw === "match" || raw === "noMatch" ? raw : "unavailable";
}

const PREVIEW_REASONS: readonly PreviewReason[] = [
  "unparseableDraft",
  "ruleNotFound",
  "noTarget",
  "unresolvedAnswers",
];

function parseReason(raw: unknown): PreviewReason | undefined {
  return PREVIEW_REASONS.find((reason) => reason === raw);
}

/** Only entries that are objects carrying the field this parser keys on survive. */
function objectsWith(raw: unknown, key: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
    )
    .filter((entry) => entry[key] !== undefined);
}

/**
 * Read the compiled documents out of a preview payload or a stored snapshot.
 *
 * `root` is carried through untouched: this app cannot validate an A2UI node tree and
 * must not try, because the only thing that knows what a node means is the renderer's
 * registry. A document with no `stepId` is dropped rather than rendered nameless.
 */
function parseCompiledSteps(raw: unknown): readonly CompiledStep[] {
  return objectsWith(raw, "stepId")
    .filter((entry) => typeof entry["stepId"] === "string")
    .map((entry) => ({ stepId: entry["stepId"] as string, root: entry["root"] }));
}

function parseVersions(raw: unknown): readonly FormVersionSummary[] {
  return objectsWith(raw, "version")
    .filter((entry) => typeof entry["version"] === "number")
    .map((entry) => ({
      version: entry["version"] as number,
      publishedAt: asString(entry["publishedAt"], ""),
      compilerVersion: asString(entry["compilerVersion"], ""),
      a2uiSpecVersion: asString(entry["a2uiSpecVersion"], ""),
      semanticsVersion: asString(entry["semanticsVersion"], ""),
    }));
}

/**
 * Read the stored draft into the builder's working shape.
 *
 * Tolerant on purpose. The draft may be an open working document, a seed copied from the
 * newest published version, or the empty one `POST /forms` writes, and the builder has to
 * open on all three. Anything structurally unreadable becomes an empty draft rather than a
 * crash: an author who can see an empty builder can rebuild, and one looking at a stack
 * trace cannot.
 */
function parseDraft(raw: unknown, formId: string, defaultLocale: string): DraftForm | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  return {
    formId: asString(source["formId"], formId),
    defaultLocale: asString(source["defaultLocale"], defaultLocale),
    title: (source["title"] ?? {}) as DraftForm["title"],
    steps: parseSteps(source["steps"]),
    rules: parseRules(source["rules"]),
  };
}

function parseSteps(raw: unknown): DraftForm["steps"] {
  return objectsWith(raw, "stepId")
    .filter((entry) => typeof entry["stepId"] === "string")
    .map((entry) => ({
      stepId: entry["stepId"] as string,
      title: (entry["title"] ?? {}) as DraftForm["title"],
      items: parsePins(entry["items"]),
    }));
}

function parsePins(raw: unknown): DraftForm["steps"][number]["items"] {
  return objectsWith(raw, "questionId")
    .filter(
      (entry) => typeof entry["questionId"] === "string" && typeof entry["version"] === "number",
    )
    .map((entry) => ({
      questionId: entry["questionId"] as string,
      version: entry["version"] as number,
    }));
}

function parseRules(raw: unknown): DraftForm["rules"] {
  return objectsWith(raw, "ruleId")
    .filter((entry) => typeof entry["ruleId"] === "string" && typeof entry["when"] === "object")
    .map((entry) => ({
      ruleId: entry["ruleId"] as string,
      when: entry["when"] as DraftForm["rules"][number]["when"],
      show: asStringList(entry["show"]),
    }));
}
