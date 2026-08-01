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

/** `PATCH /admin/forms/:id/settings` result: the settings as they now stand. */
export const FormSettingsResponse = z
  .object({ formId: z.string().openapi({ example: "frm_signup" }), settings: FormSettings })
  .openapi("FormSettingsResponse");

/** `POST .../draft/preview-condition` result: does the condition match, or why not. */
export const PreviewConditionResponse = z
  .object({
    ruleId: z.string().openapi({ example: "rul_accident_followup" }),
    /** The question ids the condition reads, in the draft's document order. */
    references: z.array(z.string()),
    /** `true`/`false` when the condition could be evaluated, `null` when it could not. */
    matches: z.boolean().nullable().openapi({ example: true }),
    /** The kernel's typed evaluation error, or `null`. Names ids, never values. */
    error: z
      .object({ code: z.string(), message: z.string() })
      .nullable()
      .openapi({ example: null }),
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
