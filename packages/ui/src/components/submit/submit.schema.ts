import { z } from "zod";

/**
 * `SubmitButton` is a qcms-specific, render-time-only node: the compiler never emits
 * one, because a stored step carries no submit control (ADR-18), so a dedicated type
 * keeps it unmistakable. The renderer appends exactly one to a step's root Form in
 * native-submit mode, as a real `<button type="submit">`.
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
       * The URL this control posts to, overriding the form's own action.
       *
       * Present only when the form's action is a Server Action, which is how a step
       * carrying a repeating group answers an Add or Remove in a 200 re-render, while
       * Continue must still reach the whole-step BFF route and its 303.
       */
      formAction: z.string().optional(),
      /**
       * Marks the hidden copy that makes this control the form's implicit-submission
       * default. Without scripting, Enter presses the form's first submit button in
       * tree order, which on a repeating step is a `__qop` Remove or Add rather than
       * Continue. The copy comes first and is out of the tab order and the
       * accessibility tree.
       */
      implicitDefault: z.boolean().optional(),
    })
    .strict()
    .optional(),
});

export type SubmitButtonNode = z.infer<typeof SubmitButtonSchema>;
