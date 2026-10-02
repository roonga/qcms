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
      /**
       * The URL this control posts to, overriding the form's own action (task 073).
       *
       * Present only when the form's action is a Next Server Action, which is how a
       * step carrying a repeating group answers an Add or Remove in a 200 re-render.
       * Continue must still reach the whole-step BFF route and its 303, and
       * `formaction` on a submit button is HTML's own way of saying so.
       */
      formAction: z.string().optional(),
    })
    .strict()
    .optional(),
});

export type SubmitButtonNode = z.infer<typeof SubmitButtonSchema>;
