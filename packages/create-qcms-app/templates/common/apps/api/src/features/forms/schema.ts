/**
 * Request/response schemas for the admin form-authoring slices (task 022).
 *
 * Zod is the single schema language (017's convention); these drive both the
 * request validation the routes perform and the generated OpenAPI documents
 * (027). The **form definition** itself is validated by the kernel
 * (`FormDefinition`, task 004) inside the handlers - not re-declared here - so a
 * malformed definition returns the kernel's coded issues through the error
 * envelope (422) with its paths intact. The request bodies therefore carry the
 * definition as an opaque object; the route schema guards only the envelope
 * around it.
 *
 * Publish issues (`PublishError[]` plus the slice-level `DEPRECATED_PIN`) are
 * likewise echoed as opaque JSON: the kernel's typed union (034 renders it
 * verbatim) is the source of truth, so re-declaring it here would only invite
 * drift.
 */

import { z } from "@hono/zod-openapi";

// --- params -----------------------------------------------------------------

/** `:id` path param - a `frm_…` form id (validated as a FormId in-handler). */
export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_signup" }),
});

/** `:id`/`:v` path params - version is parsed to a positive integer in-handler. */
export const FormVersionParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_signup" }),
  v: z.string().openapi({ param: { name: "v", in: "path" }, example: "1" }),
});

// --- request bodies ---------------------------------------------------------

/**
 * The form definition, opaque at the route boundary. The kernel
 * (`parseFormDefinition`, 004) validates its contents in the handler; here it is
 * any JSON object so a structurally-present-but-invalid definition still reaches
 * the handler and returns the kernel's 422 rather than a bare 400.
 */
const OpaqueDefinition = z
  .record(z.string(), z.unknown())
  .openapi("FormDefinitionInput", { description: "A form definition (kernel-validated)." });

/** `POST /admin/forms` - the identity to create with its empty first draft. */
export const CreateFormBody = z
  .object({
    formId: z.string().min(1).openapi({ example: "frm_signup" }),
    slug: z.string().min(1).openapi({ example: "signup" }),
    defaultLocale: z.string().min(1).openapi({ example: "en" }),
  })
  .openapi("CreateFormBody");

/** `PUT /admin/forms/:id/draft` and `POST .../draft/validate` - a full definition. */
export const DraftBody = z.object({ definition: OpaqueDefinition }).openapi("DraftBody");

/**
 * `POST /admin/forms/:id/draft/preview-condition` - the rule test bench (033).
 *
 * The unsaved draft travels with the request (like `DraftBody`) so the bench
 * answers the definition on the author's screen, not the last one persisted.
 *
 * `answers` is a `questionId -> AnswerValue` map of **hypothetical** answers the
 * author typed into the bench. They are answer-shaped, so they are handled under
 * the answer rules (SEC-13 / ADR-34): never logged, never persisted, never
 * echoed back in a response or an error message.
 */
export const PreviewConditionBody = z
  .object({
    definition: OpaqueDefinition,
    ruleId: z.string().min(1).openapi({ example: "rul_at_fault" }),
    answers: z
      .record(z.string(), z.unknown())
      .openapi({ description: "Hypothetical answers, keyed by questionId (never logged)." }),
  })
  .openapi("PreviewConditionBody");

/**
 * `POST /admin/forms/:id/draft/preview` - the live draft preview (034).
 *
 * The unsaved draft travels with the request, exactly as it does for validate and
 * for the rule test bench, so the preview shows the definition on the author's
 * screen rather than the last one persisted.
 *
 * `answers` is the author's walk-through state: a `questionId -> AnswerValue` map
 * they built by clicking through their own branches. It is answer-shaped, so it
 * is handled under the answer rules (SEC-13 / ADR-34): never logged, never
 * persisted, never echoed back in a response or an error message. It is optional
 * because the first render of the pane has no answers yet.
 */
export const PreviewDraftBody = z
  .object({
    definition: OpaqueDefinition,
    answers: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: "Walk-through answers, keyed by questionId (never logged)." }),
  })
  .openapi("PreviewDraftBody");

/**
 * The longest min-time floor a form may set, in milliseconds (one hour).
 *
 * An input guard, not a domain rule: the floor exists to make a bot's instant
 * submit fail (026), and a value past an hour stops being a floor and becomes a
 * lockout an author cannot have meant. Bounding it here keeps a mistyped field
 * from becoming a form nobody can submit.
 */
const MAX_MIN_SUBMIT_MS = 60 * 60 * 1000;

/**
 * `PATCH /admin/forms/:id/settings` - the per-form abuse-control settings (026,
 * ADR-24 tier 2), edited by the builder's settings panel (033).
 *
 * A **partial** body: an absent key leaves that setting alone, which is what lets
 * the panel save one control without echoing the other back. `minSubmitMs: null`
 * is a value rather than an omission and means "use the deployment's configured
 * floor", so the field is nullable *and* optional and the two mean different
 * things.
 */
export const UpdateFormSettingsBody = z
  .object({
    challengeRequired: z.boolean().optional().openapi({ example: true }),
    minSubmitMs: z
      .number()
      .int()
      .min(0)
      .max(MAX_MIN_SUBMIT_MS)
      .nullable()
      .optional()
      .openapi({ example: 3000 }),
  })
  // At least one field must be present. A partial body plus an all-absent body
  // would make the helper's return value ambiguous downstream: `undefined` would
  // mean either "no such form" (a 404) or "nothing asked for" (a 200), two
  // different answers behind one sentinel. Rejecting the empty patch at the
  // schema boundary keeps `undefined` meaning exactly "no such form", so the
  // handler needs no pre-read to tell the two apart.
  .refine(
    (body) => body.challengeRequired !== undefined || body.minSubmitMs !== undefined,
    "Provide at least one of challengeRequired or minSubmitMs",
  )
  .openapi("UpdateFormSettingsBody");

/** The per-form abuse-control settings, as every read and the patch return them. */
export const FormSettings = z
  .object({
    /** When true, start-session demands a passing challenge (026). */
    challengeRequired: z.boolean().openapi({ example: false }),
    /** Min-time floor override in ms; `null` means the deployment default applies. */
    minSubmitMs: z.number().int().nullable().openapi({ example: 3000 }),
  })
  .openapi("FormSettings");

/**
 * The deployment's configured challenge provider (`deps.config.flags`).
 *
 * Typed as a plain string rather than the config union on purpose: the admin
 * panel only needs to compare it against `"none"` to warn that a form's
 * `challengeRequired` is unenforceable (033's settings panel, task line 18).
 * Pinning the wire type to today's provider names would make adding a provider a
 * breaking API change for a field nobody switches on exhaustively.
 */
const ChallengeProvider = z.string().openapi({ example: "none" });

/** `PATCH /admin/forms/:id/settings` result: the settings as they now stand. */
export const FormSettingsResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    settings: FormSettings,
    challengeProvider: ChallengeProvider,
  })
  .openapi("FormSettingsResponse");

/**
 * `POST .../draft/preview-condition` result: did the condition match, or why the
 * bench could not answer.
 *
 * `outcome` is deliberately tri-state rather than a nullable boolean: "could not
 * evaluate" must not be readable as "no match". The bench is a read-only aid over
 * a draft that may be half-built, so being unable to answer is an ordinary,
 * frequent state that the panel has to render differently from a real `noMatch`.
 * `reason` is the single error channel and is present only when `outcome` is
 * `"unavailable"`.
 */
export const PreviewConditionResponse = z
  .object({
    ruleId: z.string().openapi({ example: "rul_accident_followup" }),
    /**
     * The question ids the condition reads: those the draft pins first, in the
     * draft's document order, then any it does not pin. The bench prompts for
     * these; an unpinned one has no resolvable version, so it reads as unanswered.
     */
    references: z.array(z.string()),
    outcome: z.enum(["match", "noMatch", "unavailable"]).openapi({ example: "match" }),
    /** Why the bench could not answer. Present only when `outcome` is `unavailable`. */
    reason: z
      .enum(["unparseableDraft", "ruleNotFound", "noTarget", "unresolvedAnswers"])
      .optional()
      .openapi({ example: "ruleNotFound" }),
  })
  .openapi("PreviewConditionResponse");

// --- responses --------------------------------------------------------------

const FormStatus = z.enum(["open", "closed"]);

/** A publish issue: the kernel's `PublishError` union, plus `DEPRECATED_PIN`. */
const PublishIssue = z.unknown();

/** `POST /admin/forms` result: the created identity and its empty draft. */
export const CreatedFormResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    slug: z.string().openapi({ example: "signup" }),
    defaultLocale: z.string().openapi({ example: "en" }),
    status: FormStatus.openapi({ example: "open" }),
    /** The seeded empty draft definition (no steps yet). */
    draft: z.unknown(),
  })
  .openapi("CreatedFormResponse");

/** One row in the form library list: identity plus draft/published state. */
export const FormListItem = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    slug: z.string().openapi({ example: "signup" }),
    defaultLocale: z.string().openapi({ example: "en" }),
    status: FormStatus.openapi({ example: "open" }),
    /** Whether an open draft exists (unpublished working state). */
    hasDraft: z.boolean().openapi({ example: true }),
    /** The newest published version number, or `null` if never published. */
    latestVersion: z.number().int().positive().nullable().openapi({ example: 2 }),
    /** When the newest version was published, or `null`. */
    publishedAt: z.iso.datetime().nullable(),
  })
  .openapi("FormListItem");

export const ListFormsResponse = z
  .object({ forms: z.array(FormListItem) })
  .openapi("ListFormsResponse");

/** A version summary row (no full snapshot - see the versions/:v route). */
export const FormVersionSummary = z
  .object({
    version: z.number().int().positive().openapi({ example: 1 }),
    publishedAt: z.iso.datetime(),
    compilerVersion: z.string().openapi({ example: "0.1.0" }),
    a2uiSpecVersion: z.string().openapi({ example: "0.1.0" }),
    semanticsVersion: z.string().openapi({ example: "1" }),
  })
  .openapi("FormVersionSummary");

/** `GET /admin/forms/:id`: identity, current draft (open or seeded), versions. */
export const FormDetailResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    slug: z.string().openapi({ example: "signup" }),
    defaultLocale: z.string().openapi({ example: "en" }),
    status: FormStatus.openapi({ example: "open" }),
    /** The open draft, else the latest published definition (seed), else null. */
    draft: z.unknown(),
    /** Where `draft` came from: an open draft, a seed, or none. */
    draftSource: z.enum(["open", "seeded", "none"]).openapi({ example: "open" }),
    versions: z.array(FormVersionSummary),
    /** The per-form abuse-control settings (026), which the builder panel edits (033). */
    settings: FormSettings,
    /**
     * The deployment's challenge provider. Carried on the detail read, not only
     * on a settings write, because the panel has to warn that `challengeRequired`
     * is unenforceable while the provider is `"none"` the moment the form opens.
     */
    challengeProvider: ChallengeProvider,
  })
  .openapi("FormDetailResponse");

/** `PUT /admin/forms/:id/draft`: the saved draft plus advisory issues. */
export const SavedDraftResponse = z
  .object({
    draft: z.unknown(),
    /** Advisory validation issues; they do not block saving, but block publish. */
    issues: z.array(PublishIssue),
  })
  .openapi("SavedDraftResponse");

/** `POST /admin/forms/:id/draft/validate`: dry-run issues only (no save). */
export const ValidateDraftResponse = z
  .object({
    valid: z.boolean().openapi({ example: false }),
    issues: z.array(PublishIssue),
  })
  .openapi("ValidateDraftResponse");

/**
 * `POST /admin/forms/:id/draft/preview`: the dry-run compile of the draft (034).
 *
 * The payload is 011's `CompiledForm` (documents + both version stamps) plus the
 * forward-pass projection for the answers that came with the request. It is the
 * same pair of things the portal's serve-step hands a respondent - full compiled
 * document, authoritative visible set - which is what lets the admin project and
 * render it through exactly the portal's code path (ARCHITECTURE §6).
 *
 * Nothing here is persisted and nothing recompiles at serve time: this is the
 * admin-side dry run, and ADR-18's stored audit copy is written only by publish.
 */
export const PreviewDraftResponse = z
  .object({
    /** One compiled A2UI document per step, in the draft's own step order. */
    documents: z.array(
      z.object({
        stepId: z.string().openapi({ example: "stp_driver" }),
        /** The A2UI node tree, opaque here: the renderer's registry reads it. */
        root: z.unknown(),
      }),
    ),
    compilerVersion: z.string().openapi({ example: "0.1.0" }),
    a2uiSpecVersion: z.string().openapi({ example: "0.1.0" }),
    /** The forward-pass result (ADR-16) for the supplied answers. */
    flow: z.object({
      visibleSteps: z.array(z.string()),
      visibleQuestions: z.array(z.string()),
      complete: z.boolean(),
    }),
  })
  .openapi("PreviewDraftResponse");

/** `POST /admin/forms/:id/publish`: the new version and when it was frozen. */
export const PublishedResponse = z
  .object({
    version: z.number().int().positive().openapi({ example: 1 }),
    publishedAt: z.iso.datetime(),
  })
  .openapi("PublishedResponse");

/** `POST /admin/forms/:id/close|reopen`: the resulting lifecycle status. */
export const FormStatusResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    status: FormStatus.openapi({ example: "closed" }),
  })
  .openapi("FormStatusResponse");

/** `GET /admin/forms/:id/versions/:v`: the full immutable snapshot (034). */
export const FormVersionSnapshotResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    version: z.number().int().positive().openapi({ example: 1 }),
    publishedAt: z.iso.datetime(),
    compilerVersion: z.string().openapi({ example: "0.1.0" }),
    a2uiSpecVersion: z.string().openapi({ example: "0.1.0" }),
    semanticsVersion: z.string().openapi({ example: "1" }),
    /** The frozen form definition (R1). */
    definition: z.unknown(),
    /** The compiled A2UI documents, served verbatim by the portal (ADR-18). */
    compiled: z.unknown(),
  })
  .openapi("FormVersionSnapshotResponse");
