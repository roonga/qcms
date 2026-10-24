import { z } from "zod";

/**
 * A dedicated type rather than a registry component, so the decoy is unmistakable: a
 * real control may never be rendered off-screen with these props.
 */
export const HoneypotSchema = z.object({
  type: z.literal("Honeypot"),
  props: z
    .object({
      /** The well-known `HONEYPOT_FIELD_NAME`. */
      name: z.string(),
      autoComplete: z.string().optional(),
      ariaHidden: z.boolean().optional(),
      tabIndex: z.number().optional(),
    })
    .strict()
    .optional(),
});

export type HoneypotNode = z.infer<typeof HoneypotSchema>;
