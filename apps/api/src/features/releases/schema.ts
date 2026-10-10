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

/** The current release of one form in one environment: what is released where. */
export const CurrentRelease = z
  .object({
    formId: z.string().openapi({ example: "frm_signup" }),
    environment: EnvironmentName,
    version: z.number().int().positive().openapi({ example: 3 }),
    releasedAt: z.iso.datetime(),
    releasedBy: z.string().openapi({ example: "usr_01H..." }),
  })
  .openapi("CurrentRelease");

export const CurrentReleasesResponse = z
  .object({ releases: z.array(CurrentRelease) })
  .openapi("CurrentReleasesResponse");

/** Narrow the "what is released where" read to one environment. */
export const CurrentReleasesQuery = z.object({
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
