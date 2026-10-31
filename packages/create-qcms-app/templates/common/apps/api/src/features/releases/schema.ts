import { z } from "@hono/zod-openapi";

export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_signup" }),
});

/**
 * The authority is still the live set, which the handler checks: a well-formed name this
 * deployment does not serve is refused too.
 */
const EnvironmentName = z
  .string()
  .min(1)
  .max(53)
  .regex(/^[a-z][a-z0-9]*$/)
  .openapi({ example: "test" });

/**
 * `fromEnvironment` records the path and authorises nothing (Q4): there is no ordering
 * requirement, so a hotfix straight to `prod` carries no source and is allowed.
 */
export const ReleaseVersionBody = z
  .strictObject({
    environment: EnvironmentName,
    version: z.number().int().positive().openapi({ example: 3 }),
    fromEnvironment: EnvironmentName.optional(),
  })
  .openapi("ReleaseVersionBody");

export const PublishAndReleaseBody = z
  .strictObject({
    environment: EnvironmentName,
  })
  .openapi("PublishAndReleaseBody");

export const ReleaseRecord = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    environment: EnvironmentName,
    version: z.number().int().positive().openapi({ example: 3 }),
    sequence: z.number().int().positive().openapi({ example: 2 }),
    fromEnvironment: EnvironmentName.nullable(),
    releasedBy: z.string().openapi({ example: "usr_01H..." }),
    releasedAt: z.iso.datetime(),
    approvedBy: z.string().nullable(),
    replacedVersion: z.number().int().positive().nullable(),
    /** Derived from the row and its predecessor, never sent by the client. */
    rollback: z.boolean(),
    /**
     * Closing and reopening append rows here, so a reader needs this to tell the three
     * acts apart: a release changes `version`, a close sets this, a reopen clears it.
     */
    closed: z.boolean(),
  })
  .openapi("ReleaseRecord");

export const ReleaseHistoryResponse = z
  .object({ releases: z.array(ReleaseRecord) })
  .openapi("ReleaseHistoryResponse");

export const ReleasedResponse = z
  .object({
    release: ReleaseRecord,
    version: z.number().int().positive().openapi({ example: 3 }),
  })
  .openapi("ReleasedResponse");

/**
 * The source a review considers: the draft, or one exact immutable version.
 *
 * It names no environment, because the review answers every target the caller may release
 * into rather than one the request chose.
 */
export const ReleaseReviewBody = z
  .strictObject({
    source: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("draft") }),
      z.strictObject({ kind: z.literal("version"), version: z.number().int().positive() }),
    ]),
  })
  .openapi("ReleaseReviewBody");

const ReleaseBlocker = z
  .object({
    // `TEST_RELEASE_REQUIRED` while the workflow is the derived default;
    // `ALREADY_RELEASED`, `DRAFT_PUBLISH_NOT_ALLOWED`, `APPROVER_IS_AUTHOR` and
    // `APPROVER_UNKNOWN_AUTHOR` otherwise.
    code: z.string().openapi({ example: "TEST_RELEASE_REQUIRED" }),
    // Environments any one of which would satisfy a prerequisite; empty otherwise.
    requiresAnyOf: z.array(z.string()),
  })
  .openapi("ReleaseBlocker");

/** A committed release row that satisfied a target's prerequisite. */
const ReleaseEvidence = z
  .object({
    environment: z.string(),
    version: z.number().int().positive(),
    sequence: z.number().int().positive(),
    releasedAt: z.iso.datetime(),
  })
  .openapi("ReleaseEvidence");

export const ReleaseReviewResponse = z
  .object({
    source: z.discriminatedUnion("kind", [
      // The revision a confirmation carries back, so a draft saved between review and
      // confirmation is refused rather than published unseen.
      z.object({ kind: z.literal("draft"), draftRevision: z.number().int().positive() }),
      z.object({
        kind: z.literal("version"),
        version: z.number().int().positive(),
        publishedBy: z.string().nullable(),
      }),
    ]),
    // Null while no workflow revision is configured, which reports `workflowSource:
    // "default"` and today's derived behaviour.
    workflowRevision: z.number().int().nullable(),
    workflowSource: z.enum(["default", "configured"]),
    // One entry per environment the caller holds `release: create` in, and no others.
    targets: z.array(
      z.object({
        environment: z.string(),
        currentVersion: z.number().int().positive().nullable(),
        currentSequence: z.number().int().positive().nullable(),
        closed: z.boolean(),
        evidence: z.array(ReleaseEvidence),
        blockers: z.array(ReleaseBlocker),
        twoPerson: z.object({
          applies: z.boolean(),
          // True when this caller published the candidate.
          refusedAsAuthor: z.boolean(),
        }),
        protected: z.boolean(),
      }),
    ),
  })
  .openapi("ReleaseReviewResponse");

/**
 * One destination. `expectedSequence` is the newest release-state sequence the review
 * reported, so it covers the released version and the intake state together: a close and a
 * reopen each append a row. `fromEnvironment` records the path and authorises nothing (F7).
 */
const BatchTarget = z
  .strictObject({
    environment: EnvironmentName,
    expectedSequence: z.number().int().positive().nullable(),
    fromEnvironment: EnvironmentName.optional(),
  })
  .openapi("ReleaseBatchTarget");

const IdempotencyKey = z.uuid().openapi({ example: "6f9619ff-8b86-d011-b42d-00c04fc964ff" });

/**
 * Null means "no revision is configured", which is the derived default. A commit carrying
 * the wrong expectation is refused and writes nothing.
 */
const ExpectedWorkflowRevision = z.number().int().positive().nullable();

export const ReleaseBatchBody = z
  .strictObject({
    idempotencyKey: IdempotencyKey,
    expectedWorkflowRevision: ExpectedWorkflowRevision,
    source: z.strictObject({
      kind: z.literal("version"),
      version: z.number().int().positive(),
    }),
    targets: z.array(BatchTarget).min(1),
  })
  .openapi("ReleaseBatchBody");

export const PublishBatchBody = z
  .strictObject({
    idempotencyKey: IdempotencyKey,
    expectedWorkflowRevision: ExpectedWorkflowRevision,
    source: z.strictObject({
      kind: z.literal("draft"),
      draftRevision: z.number().int().positive(),
    }),
    /** Empty is "create a version without releasing it", which needs `form: publish` alone. */
    targets: z.array(BatchTarget),
  })
  .openapi("PublishBatchBody");

export const ReleaseBatchResponse = z
  .object({
    version: z.number().int().positive(),
    releases: z.array(ReleaseRecord),
    /** True when this answer is the stored result of an earlier attempt with the same key. */
    replayed: z.boolean(),
    /**
     * True when the confirmation froze the version it reports, false when it released a
     * version that already existed. Recorded, so a lookup answers it too.
     */
    froze: z.boolean(),
  })
  .openapi("ReleaseBatchResponse");

export const IdempotencyKeyParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_signup" }),
  key: z.string().openapi({ param: { name: "key", in: "path" } }),
});

/** One destination's rule, as the configuration reads and writes it. */
const ReleaseWorkflowRule = z
  .strictObject({
    environment: EnvironmentName,
    requiresPriorReleaseIn: z.array(EnvironmentName),
    allowsDraftPublish: z.boolean(),
    allowsInBatch: z.boolean(),
  })
  .openapi("ReleaseWorkflowRule");

export const ReleaseWorkflowResponse = z
  .object({
    revision: z.number().int().positive().nullable(),
    source: z.enum(["default", "configured"]),
    environments: z.array(
      z.object({
        name: EnvironmentName,
        position: z.number().int().positive(),
        /**
         * True for the production environment alone, and read-only: it reports the role
         * split and the workspace second-approver switch, which this configuration cannot
         * alter whatever its rules say.
         */
        protected: z.boolean(),
        requiresPriorReleaseIn: z.array(EnvironmentName),
        allowsDraftPublish: z.boolean(),
        allowsInBatch: z.boolean(),
      }),
    ),
  })
  .openapi("ReleaseWorkflowResponse");

export const ReleaseWorkflowBody = z
  .strictObject({
    expectedRevision: z.number().int().positive().nullable(),
    rules: z.array(ReleaseWorkflowRule),
    note: z.string().max(500).optional(),
  })
  .openapi("ReleaseWorkflowBody");

export const ReleaseHistoryQuery = z.object({
  environment: EnvironmentName.optional().openapi({
    param: { name: "environment", in: "query" },
  }),
});

export const EnvironmentSetResponse = z
  .object({
    environments: z.array(
      z.object({
        name: EnvironmentName,
        position: z.number().int().positive().openapi({ example: 1 }),
      }),
    ),
  })
  .openapi("EnvironmentSetResponse");
