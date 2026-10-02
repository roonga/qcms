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

import { LIBRARY_SEARCH_MAX_LENGTH } from "../../openapi.js";

/**
 * Whether a form accepts new sessions. Declared here rather than beside the response
 * schemas because the list route's `status` filter needs it before them (issue 686).
 */
const FormLifecycle = z.enum(["open", "closed"]);

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

// --- query -------------------------------------------------------------------

/**
 * `GET /admin/forms` - the library list's search, status filter and sort (issue 686).
 *
 * The shape is `ListQuestionsQuery`'s, one route over, because the two library screens
 * are the same screen twice and the admin sends the same GET form to both: the filters
 * live in the URL, the API owns them, and the BFF only proxies them (R2).
 *
 * `sort` is an enum rather than a free `field:direction` pair so the set of orders the
 * API is willing to guarantee is written down in one place, and so a caller cannot ask
 * for an order over a column that is not indexed or not stable.
 */
export const ListFormsQuery = z.object({
  status: FormLifecycle.optional().openapi({
    param: { name: "status", in: "query" },
    example: "open",
  }),
  /**
   * Bounded at {@link LIBRARY_SEARCH_MAX_LENGTH}, the cap both library lists share: a
   * search term is a substring matched per row in the handler, so an unbounded one is
   * unbounded work, and past the cap the route answers 400 rather than doing the work.
   *
   * This was the bounded half of a pair for a while - the question library's equivalent
   * had no bound at all until issue #862 - which is why the constant is now shared
   * rather than written out in each slice.
   */
  search: z
    .string()
    .max(LIBRARY_SEARCH_MAX_LENGTH)
    .optional()
    .openapi({
      param: { name: "search", in: "query" },
      example: "vehicle",
    }),
  sort: z
    .enum(["slug-asc", "slug-desc", "published-desc", "published-asc"])
    .optional()
    .openapi({ param: { name: "sort", in: "query" }, example: "slug-asc" }),
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
  .strictObject({
    formId: z.string().min(1).openapi({ example: "frm_signup" }),
    slug: z.string().min(1).openapi({ example: "signup" }),
    defaultLocale: z.string().min(1).openapi({ example: "en" }),
  })
  .openapi("CreateFormBody");

/** `PUT /admin/forms/:id/draft` and `POST .../draft/validate` - a full definition. */
export const DraftBody = z
  .strictObject({
    definition: OpaqueDefinition,
    /**
     * Set when this save is accepting an agent-assisted proposal (041, ADR-25).
     * Sticky on the stored draft: it marks provenance for the human who will
     * publish, and an ordinary later save never clears it.
     */
    agentAssisted: z.boolean().optional(),
  })
  .openapi("DraftBody");

/**
 * The HYPOTHETICAL ROSTER both admin preview routes take (074, ADR-42).
 *
 * A group id mapped to the instance ids the author's screen is showing. Neither route has a
 * session, so neither has a roster: the admin mints one locally from the group's own `min`
 * or from a count the author types, and sends it. That is the whole of what makes a repeating
 * group previewable in the builder - `evaluateRules` takes the live roster as its own
 * parameter precisely because a roster is state the server owns at serve time, and in a
 * preview nobody owns it.
 *
 * **The caller mints the ids rather than the API** because the same request carries ANSWERS
 * keyed by them (`ins_i2/q_passport`). A server that minted its own would have to hand them
 * back before any answer could be typed against them, which is a second round trip for a
 * panel whose whole job is to be instant. The ids are still parsed as `InstanceId`s here, so
 * nothing but a well-formed `ins_` id reaches the evaluator.
 *
 * Nothing is stored and no id here is a session's: these instances exist for one request.
 */
const HypotheticalRosters = z
  .record(z.string(), z.array(z.string()))
  .optional()
  .openapi({
    description:
      "Hypothetical instance ids per groupId, minted by the caller. Absent means every group has no instance.",
    example: { grp_passengers: ["ins_i1", "ins_i2"] },
  });

/** The roster an evaluation actually used, per group, in document order of the groups. */
const RosterProjection = z.array(
  z.object({
    groupId: z.string().openapi({ example: "grp_passengers" }),
    instances: z.array(z.string()),
  }),
);

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
  .strictObject({
    definition: OpaqueDefinition,
    ruleId: z.string().min(1).openapi({ example: "rul_at_fault" }),
    answers: z.record(z.string(), z.unknown()).openapi({
      description:
        "Hypothetical answers, keyed by answer key: a bare questionId, or `instanceId/questionId` for a question inside a repeating group (never logged).",
    }),
    instances: HypotheticalRosters,
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
  .strictObject({
    definition: OpaqueDefinition,
    answers: z.record(z.string(), z.unknown()).optional().openapi({
      description:
        "Walk-through answers, keyed by answer key: a bare questionId, or `instanceId/questionId` inside a repeating group (never logged).",
    }),
    instances: HypotheticalRosters,
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
  .strictObject({
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
  // `minProperties: 1` is the JSON Schema expression of the `.refine()` above
  // (issue #242). A refinement is a predicate the generator cannot read, so
  // without this the published schema showed two optional fields and no `required`
  // array: nothing in `docs/openapi/admin.json` said an all-absent body is a 400,
  // and a client generated from the document alone could not know it.
  //
  // Stated as metadata rather than by re-shaping the body into a union of the
  // single-field variants. The union would also generate the constraint, as an
  // `anyOf` branch per field, but "at least one of N" needs a branch per field and
  // per-form settings are an ADR-24 tier-2 surface that gains fields over time, so
  // that cost grows while this one does not. The `.refine()` stays the enforcement;
  // this only makes it visible, and the two are pinned together by the contract
  // test in `src/openapi-document.test.ts` and the integration test that sends `{}`.
  .openapi("UpdateFormSettingsBody", {
    minProperties: 1,
    description:
      "A partial patch. At least one of `challengeRequired` or `minSubmitMs` must be present: " +
      "an all-absent body is refused at the schema with a 400 `INVALID_REQUEST` envelope.",
  });

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
 * Whether a challenge this deployment can actually verify stands behind a form's
 * `challengeRequired` (ADR-24, amended 2026-08-31, issue #725).
 *
 * A boolean derived from `deps.config.flags`, never the flag value itself. The
 * response used to echo the raw provider name so the panel could compare it
 * against `"none"`; that was a standing exception to "clients receive behavior,
 * not flag values", and the Code Owner removed it. The panel needs exactly one
 * fact - is ticking the box going to protect anything - and adding or renaming a
 * provider now changes nothing on the wire or in the admin.
 */
const ChallengeEnforceable = z.boolean().openapi({ example: false });

/** `PATCH /admin/forms/:id/settings` result: the settings as they now stand. */
export const FormSettingsResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    settings: FormSettings,
    challengeEnforceable: ChallengeEnforceable,
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
    /**
     * The groups the bench evaluated, with the hypothetical roster it used for each (074).
     *
     * Echoed so the bench can state what it answered ABOUT. A verdict computed against three
     * passengers beside a panel that has since been set to five is the one wrong thing a
     * bench must never show, and the roster is what lets the panel tell.
     */
    rosters: RosterProjection,
    /**
     * The group the rule's target sits inside, when it sits in one.
     *
     * Present exactly when the rule is evaluated PER INSTANCE, which is the fact an author
     * most often comes to the bench to discover: scope is implicit by position (ADR-42
     * §3.4), so nothing in the condition they wrote says it.
     */
    targetGroupId: z.string().optional().openapi({ example: "grp_passengers" }),
    /**
     * One verdict per live instance of {@link targetGroupId}, in roster order.
     *
     * Present only for a per-instance rule, and **empty rather than absent** when that group
     * has no instance: an empty list is the honest answer for a roster with nothing in it,
     * and it is what the zero-instance case looks like from the panel's side.
     *
     * The top-level `outcome` stays the rule's own answer - `match` when any instance matched
     * - so a caller that does not care about instances reads exactly what it always read.
     */
    instanceOutcomes: z
      .array(
        z.object({
          instanceId: z.string().openapi({ example: "ins_i2" }),
          outcome: z.enum(["match", "noMatch"]),
        }),
      )
      .optional(),
  })
  .openapi("PreviewConditionResponse");

// --- responses --------------------------------------------------------------

/** The form lifecycle status, in responses and as the list route's filter. */
const FormStatus = FormLifecycle;

/** A publish issue: the kernel's `PublishError` union, plus `DEPRECATED_PIN`. */
const PublishIssue = z.unknown();

/**
 * A publish warning: the kernel's `PublishWarning` union (issue #123).
 *
 * Opaque here for the same reason `PublishIssue` is - the kernel owns the
 * union, and restating it in the route schema would be a second declaration to
 * keep in step. A warning never blocks a publish; it rides beside the issues so
 * the author sees it before deciding.
 */
const PublishWarningEntry = z.unknown();

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
    /**
     * Whether the open draft carries agent-assisted changes (041, ADR-25). The
     * builder header and the publish confirmation show it, so the human
     * publishing knows what they are signing. Always false for a seeded draft.
     */
    draftAgentAssisted: z.boolean().openapi({ example: false }),
    /** The open draft's state token, or null; the 041 assist request echoes it. */
    draftUpdatedAt: z.string().nullable(),
    versions: z.array(FormVersionSummary),
    /** The per-form abuse-control settings (026), which the builder panel edits (033). */
    settings: FormSettings,
    /**
     * Whether a challenge can be verified here. Carried on the detail read, not
     * only on a settings write, because the panel has to warn that
     * `challengeRequired` is unenforceable the moment the form opens.
     */
    challengeEnforceable: ChallengeEnforceable,
  })
  .openapi("FormDetailResponse");

/** `PUT /admin/forms/:id/draft`: the saved draft plus advisory issues. */
export const SavedDraftResponse = z
  .object({
    draft: z.unknown(),
    /** Advisory validation issues; they do not block saving, but block publish. */
    issues: z.array(PublishIssue),
    /**
     * Non-blocking publish warnings. Empty whenever the **kernel** reports
     * errors, which is narrower than "empty whenever `issues` is not": a
     * `DEPRECATED_PIN` finding comes from the API layer and can stand beside a
     * warning about the same draft.
     */
    warnings: z.array(PublishWarningEntry),
    /** Whether this draft carries agent-assisted changes (041). */
    agentAssisted: z.boolean().openapi({ example: false }),
    /** The draft's current state token, for the 041 assist request. */
    updatedAt: z.string().openapi({ example: "2026-08-01T09:00:00.000Z" }),
  })
  .openapi("SavedDraftResponse");

/** `POST /admin/forms/:id/draft/validate`: dry-run issues only (no save). */
export const ValidateDraftResponse = z
  .object({
    /** Errors only: a warning describes a draft that would publish. */
    valid: z.boolean().openapi({ example: false }),
    issues: z.array(PublishIssue),
    /**
     * Non-blocking publish warnings. Empty whenever the **kernel** reports
     * errors; a `DEPRECATED_PIN` finding is raised by the API layer and can
     * stand beside a warning, so a non-empty `issues` does not imply an empty
     * `warnings`.
     */
    warnings: z.array(PublishWarningEntry),
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
      /**
       * The visible fields as ANSWER KEYS: a bare `questionId` outside every repeating
       * group, byte-identically to what this always sent, and `instanceId/questionId` inside
       * one (ADR-42, ADR-43).
       *
       * The qualified form is not optional detail. A rule targeting inside a group is
       * evaluated once per live instance, so a member question can be visible in one
       * instance and hidden in another, and only the qualified key can say which - which is
       * why `documentForVisible` skips a repeat template and the renderer's expansion prunes
       * each clone against this same set. It is the identical projection the portal's
       * serve-step returns, which is what keeps the preview's DOM the portal's DOM.
       */
      visibleQuestions: z.array(z.string()),
      complete: z.boolean(),
      /** The hypothetical roster this projection was computed with, per group (074). */
      rosters: RosterProjection,
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
