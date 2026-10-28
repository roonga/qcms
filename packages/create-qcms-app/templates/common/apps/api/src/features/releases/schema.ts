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
