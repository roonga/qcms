import { z } from "zod";

/**
 * `Honeypot` is a qcms-specific node type rather than an `@a2ra/core` registry
 * component: a real control may never be rendered off-screen with the hiding props,
 * so a dedicated type makes the decoy unmistakable.
 */
export const HoneypotSchema = z.object({
  type: z.literal("Honeypot"),
  props: z
    .object({
      /** The submit key - the well-known `HONEYPOT_FIELD_NAME` ("website"). */
      name: z.string(),
      autoComplete: z.string().optional(),
      ariaHidden: z.boolean().optional(),
      tabIndex: z.number().optional(),
    })
    .strict()
    .optional(),
});

export type HoneypotNode = z.infer<typeof HoneypotSchema>;
