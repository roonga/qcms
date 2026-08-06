import { z } from "@hono/zod-openapi";

/** The recovery codes an admin is shown once, at the end of TOTP enrollment. */
export const RecoveryCodesResponse = z
  .object({
    /**
     * The account's current backup codes, in the order better-auth stores them.
     * Single-use: redeeming one removes it from this set.
     */
    codes: z.array(z.string()).openapi({ example: ["a1b2c3d4", "e5f6g7h8"] }),
  })
  .openapi("AdminRecoveryCodes");
