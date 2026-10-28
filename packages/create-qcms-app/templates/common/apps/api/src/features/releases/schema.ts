/**
 * Request and response schemas for releases and promotion (ADR-40, task 065).
 *
 * Zod only, no logic. The one thing worth reading twice is what is **not** here: there is
 * no "rollback" field on the request. Rolling back is releasing an earlier version and
 * there is no second mechanism (ADR-40), so the client sends the same body it sends for
 * any other release and the history derives the reading from the row.
 */

import { z } from "@hono/zod-openapi";

/** `:id` on every `/forms/{id}/...` route in this slice. */
export const FormIdParam = z.object({
  id: z.string().openapi({ param: { name: "id", in: "path" }, example: "frm_signup" }),
});

/**
 * An environment name as a path-free value: `^[a-z][a-z0-9]*$` (Q42).
 *
 * The pattern is here as well as in the operator command because this is the edge the
 * name arrives at over HTTP, and a 400 from a schema is a better answer than a refusal
 * from a foreign key. The **authority** is still the live set, which the handler checks:
 * a well-formed name this deployment does not serve is refused too.
 */
const EnvironmentName = z
  .string()
  .min(1)
  .max(53)
  .regex(/^[a-z][a-z0-9]*$/)
  .openapi({ example: "test" });

/**
 * Release a published version into one environment, or promote it there.
 *
 * `fromEnvironment` records the path and authorises nothing (Q4): there is **no ordering
 * requirement**, so a hotfix straight to `prod` is a body with no `fromEnvironment` and
 * is allowed. Sending the environment being released to as the source is refused, because
 * "promoted from itself" is not a path.
 */
export const ReleaseVersionBody = z
  .strictObject({
    environment: EnvironmentName,
    version: z.number().int().positive().openapi({ example: 3 }),
    fromEnvironment: EnvironmentName.optional(),
  })
  .openapi("ReleaseVersionBody");

/** Publish the open draft and release the new version, in one act (finding 2). */
export const PublishAndReleaseBody = z
  .strictObject({
    environment: EnvironmentName,
  })
  .openapi("PublishAndReleaseBody");

/** One row of the release history. */
export const ReleaseRecord = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    environment: EnvironmentName,
    version: z.number().int().positive().openapi({ example: 3 }),
    sequence: z.number().int().positive().openapi({ example: 2 }),
    fromEnvironment: EnvironmentName.nullable(),
    releasedBy: z.string().openapi({ example: "usr_01H..." }),
    releasedAt: z.iso.datetime(),
    /**
     * The approval recorded with this release, or null.
     *
     * Present from this task and written by task 070's two-person rule for `prod` (Q51).
     * Nothing here enforces who may fill it.
     */
    approvedBy: z.string().nullable(),
    /** The version this release replaced in that environment, or null for the first. */
    replacedVersion: z.number().int().positive().nullable(),
    /**
     * Whether this release moved the environment **backwards** - an earlier version than
     * the one it replaced.
     *
     * Derived from the row and its predecessor, never sent by the client (ADR-40,
     * criterion 4): "released version 4 after version 7" is the shape an incident review
     * reads, and a history that presented it as an ordinary row would make an operator
     * count backwards to see what happened.
     */
    rollback: z.boolean(),
    /**
     * Whether this row leaves the environment **closed to new sessions** (Q18, task 066).
     *
     * The closed state is a value of this state rather than a table beside it, so closing
     * and reopening append rows here, carrying the released version forward. A reader of
     * the history therefore needs this field to tell the three acts apart: a release
     * changes `version`, a close sets this, a reopen clears it.
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
    /** The version number released, repeated at the top level for the publish-and-release pair. */
    version: z.number().int().positive().openapi({ example: 3 }),
  })
  .openapi("ReleasedResponse");

// --- the candidate review (decision 5's read half, Q89) ---------------------

/**
 * `POST /admin/forms/{id}/release-review` - which source is being considered.
 *
 * The draft or one exact immutable version, and nothing else: an approver may review and
 * release an existing version without holding `form: write` or `form: publish`, which is
 * the whole reason the source is a choice rather than "the newest thing".
 *
 * It names **no environment**, deliberately. The review answers every target the caller
 * may release into, so a body naming one would be a filter the caller could use to ask
 * about an environment they hold nothing in.
 */
export const ReleaseReviewBody = z
  .strictObject({
    source: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("draft") }),
      z.strictObject({ kind: z.literal("version"), version: z.number().int().positive() }),
    ]),
  })
  .openapi("ReleaseReviewBody");

/** One reason a target refuses the candidate, with what would satisfy it. */
const ReleaseBlocker = z
  .object({
    /**
     * `TEST_RELEASE_REQUIRED` while the deployment runs on the derived default workflow,
     * which is the code this deployment has today (F5): `PRIOR_RELEASE_REQUIRED` replaces
     * it once a workflow revision is configured, which phase 3 builds.
     * `ALREADY_RELEASED` is the candidate already serving there;
     * `DRAFT_PUBLISH_NOT_ALLOWED` is a draft aimed at a target the workflow refuses a
     * combined publish into; `APPROVER_IS_AUTHOR` and `APPROVER_UNKNOWN_AUTHOR` are the
     * two-person rule's refusals, reported here before the commit rather than after it.
     */
    code: z.string().openapi({ example: "TEST_RELEASE_REQUIRED" }),
    /** The environments any one of which would satisfy a prerequisite; empty otherwise. */
    requiresAnyOf: z.array(z.string()),
  })
  .openapi("ReleaseBlocker");

/** A committed release row that satisfied a target's prerequisite (decision 2). */
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
      z.object({ kind: z.literal("draft") }),
      z.object({
        kind: z.literal("version"),
        version: z.number().int().positive(),
        /** The account that published it, which the two-person rule compares against. */
        publishedBy: z.string().nullable(),
      }),
    ]),
    /**
     * The configured workflow revision this review was evaluated against, or `null` with
     * `source: "default"` where no revision is written - which is every deployment until
     * phase 3 builds the configuration (decision 1).
     */
    workflowRevision: z.number().int().nullable(),
    workflowSource: z.enum(["default", "configured"]),
    /**
     * One entry per environment the caller holds `release: create` in, in canonical
     * order. **Only** those: a target the caller could not release into is not named at
     * all, which is what keeps this read from being an environment list for somebody the
     * environment narrowing already answered.
     */
    targets: z.array(
      z.object({
        environment: z.string(),
        /** What is serving there now, or null when nothing is. */
        currentVersion: z.number().int().positive().nullable(),
        currentSequence: z.number().int().positive().nullable(),
        /** Whether intake is closed there. Releasing does not reopen it (Q18). */
        closed: z.boolean(),
        evidence: z.array(ReleaseEvidence),
        blockers: z.array(ReleaseBlocker),
        twoPerson: z.object({
          applies: z.boolean(),
          /** True when this caller is the account that published the candidate. */
          refusedAsAuthor: z.boolean(),
        }),
        /** True for the one protected production identifier (ADR-40). */
        protected: z.boolean(),
      }),
    ),
  })
  .openapi("ReleaseReviewResponse");

/** Narrow the history to one environment. */
export const ReleaseHistoryQuery = z.object({
  environment: EnvironmentName.optional().openapi({
    param: { name: "environment", in: "query" },
  }),
});

/** The live environment set, in `position` order (Q1, Q42). */
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
