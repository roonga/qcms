import { z } from "zod";

/**
 * `SubmitButton` is a qcms-specific, render-time-only node (task 044): the
 * compiler never emits it (a stored step carries no submit control - ADR-18), so
 * a dedicated type keeps it unmistakable. `A2UIStepRenderer` appends exactly one
 * to a step's root Form ONLY in its opt-in native-submit mode; the renderer emits
 * a real `<button type="submit">` so a JS-disabled respondent can POST the step.
 */
export const SubmitButtonSchema = z.object({
  type: z.literal("SubmitButton"),
  props: z
    .object({
      /** The visible label of the submit control. */
      label: z.string(),
      /** Host-app class (ADR-26 adopter theming); the control is otherwise unstyled. */
      className: z.string().optional(),
    })
    .strict()
    .optional(),
});

export type SubmitButtonNode = z.infer<typeof SubmitButtonSchema>;
