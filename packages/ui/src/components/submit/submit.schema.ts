import { z } from "zod";

/**
 * Render-time only: the compiler never emits one, because a stored step carries no
 * submit control (ADR-18), so a dedicated type keeps it unmistakable.
 */
export const SubmitButtonSchema = z.object({
  type: z.literal("SubmitButton"),
  props: z
    .object({
      label: z.string(),
      /** Host-app theming (ADR-26); the control is otherwise unstyled. */
      className: z.string().optional(),
      /**
       * Overrides the form's own action, and present only when that action is a Server
       * Action: Continue must still reach the whole-step BFF route and its 303.
       */
      formAction: z.string().optional(),
      /**
       * Marks the hidden copy that makes this the form's implicit-submission default.
       * Without scripting, Enter presses the first submit button in tree order, which
       * on a repeating step is a `__qop` Remove or Add rather than Continue.
       */
      implicitDefault: z.boolean().optional(),
    })
    .strict()
    .optional(),
});

export type SubmitButtonNode = z.infer<typeof SubmitButtonSchema>;
