import { z } from "@hono/zod-openapi";

import { LIBRARY_SEARCH_MAX_LENGTH } from "../../openapi.js";

const FormLifecycle = z.enum(["open", "closed"]);

export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_signup" }),
});

export const FormVersionParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_signup" }),
  v: z.string().openapi({ param: { name: "v", in: "path" }, example: "1" }),
});

/**
 * `sort` is an enum rather than a free `field:direction` pair so a caller cannot ask for
 * an order over a column that is not indexed or not stable.
 */
export const ListFormsQuery = z.object({
  status: FormLifecycle.optional().openapi({
    param: { name: "status", in: "query" },
    example: "open",
  }),
  /**
   * Bounded because the term is substring-matched per row in the handler, so an
   * unbounded one is unbounded work.
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

/**
 * Any JSON object, so an invalid definition reaches the handler and returns the kernel's
 * coded 422 rather than a bare 400.
 */
const OpaqueDefinition = z
  .record(z.string(), z.unknown())
  .openapi("FormDefinitionInput", { description: "A form definition (kernel-validated)." });

export const CreateFormBody = z
  .strictObject({
    formId: z.string().min(1).openapi({ example: "frm_signup" }),
    slug: z.string().min(1).openapi({ example: "signup" }),
    defaultLocale: z.string().min(1).openapi({ example: "en" }),
    /**
     * Optional on the request, required on the row: omitted it resolves to the single
     * workspace, and is refused when more than one exists.
     */
    workspaceId: z.string().min(1).optional().openapi({ example: "org_default_workspace" }),
  })
  .openapi("CreateFormBody");

export const DraftBody = z
  .strictObject({
    definition: OpaqueDefinition,
    /** Sticky provenance for the human who publishes: an ordinary later save never clears it. */
    agentAssisted: z.boolean().optional(),
  })
  .openapi("DraftBody");

/**
 * The caller mints the instance ids rather than the API because the same request carries
 * answers keyed by them; nothing here is stored and no id is a session's.
 */
const HypotheticalRosters = z
  .record(z.string(), z.array(z.string()))
  .optional()
  .openapi({
    description:
      "Hypothetical instance ids per groupId, minted by the caller. Absent means every group has no instance.",
    example: { grp_passengers: ["ins_i1", "ins_i2"] },
  });

const RosterProjection = z.array(
  z.object({
    groupId: z.string().openapi({ example: "grp_passengers" }),
    instances: z.array(z.string()),
  }),
);

/**
 * `answers` is answer-shaped, so it falls under the answer rules (SEC-13 / ADR-34):
 * never logged, never persisted, never echoed back.
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
 * `answers` is answer-shaped, so it falls under the answer rules (SEC-13 / ADR-34):
 * never logged, never persisted, never echoed back.
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

/** An input guard: past an hour the floor becomes a lockout a mistyped field cannot undo. */
const MAX_MIN_SUBMIT_MS = 60 * 60 * 1000;

/**
 * A partial body. `minSubmitMs: null` is a value, not an omission, and means "use the
 * deployment's configured floor", so the field is both nullable and optional.
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
  // Refusing the empty patch here keeps the helper's `undefined` meaning exactly "no such
  // form", so the handler needs no pre-read to tell that from "nothing asked for".
  .refine(
    (body) => body.challengeRequired !== undefined || body.minSubmitMs !== undefined,
    "Provide at least one of challengeRequired or minSubmitMs",
  )
  // `minProperties: 1` restates the `.refine()` above for the generator, which cannot
  // read a predicate; the refinement stays the enforcement.
  .openapi("UpdateFormSettingsBody", {
    minProperties: 1,
    description:
      "A partial patch. At least one of `challengeRequired` or `minSubmitMs` must be present: " +
      "an all-absent body is refused at the schema with a 400 `INVALID_REQUEST` envelope.",
  });

export const FormSettings = z
  .object({
    challengeRequired: z.boolean().openapi({ example: false }),
    /** `null` means the deployment default applies. */
    minSubmitMs: z.number().int().nullable().openapi({ example: 3000 }),
  })
  .openapi("FormSettings");

/**
 * Derived from `deps.config.flags`, never the flag value itself: clients receive behavior,
 * not flag values (ADR-24).
 */
const ChallengeEnforceable = z.boolean().openapi({ example: false });

export const FormSettingsResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    settings: FormSettings,
    challengeEnforceable: ChallengeEnforceable,
  })
  .openapi("FormSettingsResponse");

/**
 * `outcome` is tri-state rather than a nullable boolean so "could not evaluate" cannot be
 * read as "no match".
 */
export const PreviewConditionResponse = z
  .object({
    ruleId: z.string().openapi({ example: "rul_accident_followup" }),
    /** Pinned ids first, in document order; an unpinned one reads as unanswered. */
    references: z.array(z.string()),
    outcome: z.enum(["match", "noMatch", "unavailable"]).openapi({ example: "match" }),
    /** Present only when `outcome` is `unavailable`. */
    reason: z
      .enum(["unparseableDraft", "ruleNotFound", "noTarget", "unresolvedAnswers"])
      .optional()
      .openapi({ example: "ruleNotFound" }),
    /** Echoed so the panel can tell whether a verdict was computed against its own roster. */
    rosters: RosterProjection,
    /** Present exactly when the rule is evaluated per instance; scope is implicit by position. */
    targetGroupId: z.string().optional().openapi({ example: "grp_passengers" }),
    /**
     * Per-instance verdicts in roster order, empty rather than absent for a group with no
     * instance. The top-level `outcome` stays the rule's own answer.
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

/**
 * Derived per environment, not a stored column: the same form reads `open` on one admin
 * screen and `closed` on the next when the environment switcher moves.
 */
const FormStatus = FormLifecycle;

/** Opaque: the kernel owns the `PublishError` union, plus the API's `DEPRECATED_PIN`. */
const PublishIssue = z.unknown();

/** Opaque: the kernel owns the `PublishWarning` union. */
const PublishWarningEntry = z.unknown();

export const CreatedFormResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    slug: z.string().openapi({ example: "signup" }),
    /** Echoed because the request may not have named it. */
    workspaceId: z.string().openapi({ example: "org_default_workspace" }),
    defaultLocale: z.string().openapi({ example: "en" }),
    status: FormStatus.openapi({ example: "open" }),
    draft: z.unknown(),
  })
  .openapi("CreatedFormResponse");

export const FormListItem = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    slug: z.string().openapi({ example: "signup" }),
    defaultLocale: z.string().openapi({ example: "en" }),
    status: FormStatus.openapi({ example: "open" }),
    hasDraft: z.boolean().openapi({ example: true }),
    latestVersion: z.number().int().positive().nullable().openapi({ example: 2 }),
    publishedAt: z.iso.datetime().nullable(),
  })
  .openapi("FormListItem");

export const ListFormsResponse = z
  .object({ forms: z.array(FormListItem) })
  .openapi("ListFormsResponse");

export const FormVersionSummary = z
  .object({
    version: z.number().int().positive().openapi({ example: 1 }),
    publishedAt: z.iso.datetime(),
    compilerVersion: z.string().openapi({ example: "0.1.0" }),
    a2uiSpecVersion: z.string().openapi({ example: "0.1.0" }),
    semanticsVersion: z.string().openapi({ example: "1" }),
    /**
     * The author the two-person release rule compares against; carried here so a screen can
     * say "you published this one" before the operator acts rather than after a refusal.
     */
    publishedBy: z.string().nullable().openapi({ example: "usr_alice" }),
  })
  .openapi("FormVersionSummary");

export const FormDetailResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    slug: z.string().openapi({ example: "signup" }),
    defaultLocale: z.string().openapi({ example: "en" }),
    status: FormStatus.openapi({ example: "open" }),
    /** The open draft, else the latest published definition as a seed, else null. */
    draft: z.unknown(),
    releasedDefinition: z.unknown(),
    draftSource: z.enum(["open", "seeded", "none"]).openapi({ example: "open" }),
    /** Always false for a seeded draft. */
    draftAgentAssisted: z.boolean().openapi({ example: false }),
    /**
     * Bumped on every save, and null when there is no open draft. A publish confirmation
     * carries it back, so a draft saved in between is refused rather than published unseen.
     */
    draftRevision: z.number().int().positive().nullable(),
    draftUpdatedAt: z.string().nullable(),
    versions: z.array(FormVersionSummary),
    settings: FormSettings,
    /**
     * On the detail read, not only on a settings write, because the panel must warn that
     * `challengeRequired` is unenforceable the moment the form opens.
     */
    challengeEnforceable: ChallengeEnforceable,
    /**
     * Carried here because an approver holds no grant on the workspace membership screens,
     * so nothing else can tell them the second-approver rule applies before a 403.
     */
    requiresSecondApprover: z.boolean().openapi({ example: false }),
    /**
     * Whether the caller holds `form: write` on this form in the request's environment,
     * and nothing else. Independent of the deprecated `workflow` object, so a reader of
     * this field is not also reading a workflow verdict.
     */
    canWriteDraft: z.boolean().openapi({ example: true }),
    // Deprecated: `POST /admin/forms/{id}/release-review` answers per target rather than
    // for whichever environment the switcher held. Nothing new should read this.
    workflow: z
      .object({
        enabled: z.boolean(),
        environment: z.string(),
        canEdit: z.boolean(),
        canPublish: z.boolean(),
        canRelease: z.boolean(),
        eligibleVersions: z.array(z.number().int().positive()),
        preferredVersion: z.number().int().positive().nullable(),
        currentVersion: z.number().int().positive().nullable(),
      })
      .openapi({ deprecated: true }),
  })
  .openapi("FormDetailResponse");

export const SavedDraftResponse = z
  .object({
    draft: z.unknown(),
    /** Advisory: they do not block saving, but block publish. */
    issues: z.array(PublishIssue),
    /**
     * Empty whenever the kernel reports errors, which is narrower than "empty whenever
     * `issues` is not": a `DEPRECATED_PIN` finding comes from the API layer.
     */
    warnings: z.array(PublishWarningEntry),
    agentAssisted: z.boolean().openapi({ example: false }),
    updatedAt: z.string().openapi({ example: "2026-08-01T09:00:00.000Z" }),
  })
  .openapi("SavedDraftResponse");

export const ValidateDraftResponse = z
  .object({
    /** Errors only: a warning describes a draft that would publish. */
    valid: z.boolean().openapi({ example: false }),
    issues: z.array(PublishIssue),
    /**
     * Empty whenever the kernel reports errors; a `DEPRECATED_PIN` finding comes from the
     * API layer, so a non-empty `issues` does not imply an empty `warnings`.
     */
    warnings: z.array(PublishWarningEntry),
  })
  .openapi("ValidateDraftResponse");

/** Nothing here is persisted: ADR-18's stored audit copy is written only by publish. */
export const PreviewDraftResponse = z
  .object({
    documents: z.array(
      z.object({
        stepId: z.string().openapi({ example: "stp_driver" }),
        root: z.unknown(),
      }),
    ),
    compilerVersion: z.string().openapi({ example: "0.1.0" }),
    a2uiSpecVersion: z.string().openapi({ example: "0.1.0" }),
    flow: z.object({
      visibleSteps: z.array(z.string()),
      /**
       * Answer keys: a bare `questionId` outside a repeating group, `instanceId/questionId`
       * inside one, since a member question can be visible in one instance and hidden in
       * another and only the qualified key can say which.
       */
      visibleQuestions: z.array(z.string()),
      complete: z.boolean(),
      rosters: RosterProjection,
      /** Present exactly when the draft holds a repeating group, as the kernel's field is. */
      visibleStepViews: z
        .array(z.object({ stepId: z.string(), instanceId: z.string().nullable() }))
        .optional(),
    }),
  })
  .openapi("PreviewDraftResponse");

export const PublishedResponse = z
  .object({
    version: z.number().int().positive().openapi({ example: 1 }),
    publishedAt: z.iso.datetime(),
  })
  .openapi("PublishedResponse");

/**
 * The body is the environment and nothing else: the version is the one this call creates,
 * and a first release has no source environment.
 */
export const PublishAndReleaseBody = z
  .strictObject({
    environment: z
      .string()
      .min(1)
      .max(53)
      .regex(/^[a-z][a-z0-9]*$/)
      .openapi({ example: "test" }),
  })
  .openapi("PublishAndReleaseBody");

export const PublishedAndReleasedResponse = z
  .object({
    version: z.number().int().positive().openapi({ example: 1 }),
    publishedAt: z.iso.datetime(),
    environment: z.string().openapi({ example: "test" }),
    releasedAt: z.iso.datetime(),
  })
  .openapi("PublishedAndReleasedResponse");

/**
 * Required with no default, and in the body rather than taken from the environment
 * switcher's header: closing intake is an operational act, so the caller states the
 * environment rather than inheriting one it may not have been looking at.
 */
export const FormEnvironmentBody = z
  .strictObject({
    environment: z
      .string()
      .min(1)
      .max(53)
      .regex(/^[a-z][a-z0-9]*$/)
      .openapi({ example: "prod" }),
  })
  .openapi("FormEnvironmentBody");

/**
 * `environment` is echoed because the status is only meaningful beside it: one form can be
 * closed in `prod` and open in `test`.
 */
export const FormStatusResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    environment: z.string().openapi({ example: "prod" }),
    status: FormStatus.openapi({ example: "closed" }),
  })
  .openapi("FormStatusResponse");

export const FormVersionSnapshotResponse = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    version: z.number().int().positive().openapi({ example: 1 }),
    publishedAt: z.iso.datetime(),
    compilerVersion: z.string().openapi({ example: "0.1.0" }),
    a2uiSpecVersion: z.string().openapi({ example: "0.1.0" }),
    semanticsVersion: z.string().openapi({ example: "1" }),
    definition: z.unknown(),
    /** Served verbatim by the portal: nothing recompiles at serve time (ADR-18). */
    compiled: z.unknown(),
  })
  .openapi("FormVersionSnapshotResponse");
