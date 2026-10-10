"use client";

import { Button } from "@/components/kit";
import { ManualSaveNote } from "@/components/save-model";
import { t } from "@/lib/i18n/en";
import { QUESTION_FORM_ID, useQuestionSave } from "@/lib/questions/editor-bridge";

/**
 * The screen's one save control, in the heading row (Code Owner, 2026-09-28).
 *
 * ## Why it is here and not in the card
 *
 * It was the last thing in the editor's column, then a sticky bar at the column's foot, then the
 * version card's own header. The first two put the button where the PANEL decided - measured at
 * 1440, y=481 on Validation messages, 565 on Content, 848 on Options, and no button at all on
 * Preview - and a control that travels 367px when a reader switches panels is one they have to
 * find again every time. The third stopped it moving but said "Version 2" a third time, beside a
 * rail row and a summary that had each said it already.
 *
 * The screen's heading row is the one place that is both fixed and unrepeated, so the action goes
 * there, at the end of the row the `<h1>` starts.
 *
 * ## How a button outside the form still submits it
 *
 * `requestSubmit()` on the form this button names. The vendored `Button` forwards no `form`
 * attribute - ADR-22 keeps it byte-identical to upstream and it takes `onPress` - so the wiring
 * is a lookup by id rather than a prop. `requestSubmit` is not `submit()`: it runs the browser's
 * own constraint validation and fires a real submit event, which is what React's form action is
 * listening for, so this behaves exactly as an in-form submit button would.
 *
 * The pending state crosses the same seam the rail's rows use (`lib/questions/editor-bridge.ts`):
 * the editor owns `useActionState` and publishes `isPending`, and this reads it. Two client trees
 * on one page share one module, which is the only thing they can share.
 *
 * ## What renders when there is nothing to save
 *
 * Nothing at all. A frozen version publishes no save state, so this returns `null` and the
 * heading row is just the heading - contract §6's read-only clause, which asks for the absence of
 * chrome rather than a disabled control. `app/globals.css` holds the row's height either way, so
 * the heading text does not move as a reader walks from a draft to a published version.
 */
export function QuestionSave({ mode }: { readonly mode: "create" | "edit" }) {
  const save = useQuestionSave();
  if (save === undefined) return null;

  return (
    // A FRAGMENT, not a wrapper: these two are placed independently in the heading row's grid -
    // the button at the end of the heading's own line, the note on the line under it - and a
    // wrapper would have to be `display: contents` to allow that. This keeps the note before the
    // button in DOM order, which is what contract §6 asks for (a linear read reaches the
    // statement on the way to the control), without either element needing a box of its own.
    <>
      {/* The manual save model, stated where the author will meet it (issue 518, contract §6). */}
      <ManualSaveNote
        messageKey={
          mode === "create" ? "questions.create.manualModel" : "questions.editor.manualModel"
        }
      />
      {/* NO HYDRATION GUARD HERE, AND THE REASON IS STRONGER THAN ONE (issue #1032, Code
        Owner ruling 2026-10-10, issue #1050).

        The ruling is that an admin Server Action form's submit controls render disabled until
        the page has hydrated, because a submission that leaves earlier posts with
        `Origin: null` under this app's `Referrer-Policy: no-referrer` and Next refuses it.
        This control already cannot be pressed in that window, for two independent reasons,
        and a `!isHydrated` term added here would be a branch no render can reach:

        1. The save state arrives through `usePublishQuestionSave`, which publishes from an
           EFFECT, and `useQuestionSave`'s server snapshot is `undefined`. So during the server
           render and the hydrating render `save` is `undefined` and this component returns
           `null` above. The button is absent from the served bytes rather than present and
           inert, and by the time it first renders the attach has already committed.
        2. It is `type="button"` outside the form and saves by `requestSubmit()`, which is
           client JavaScript.

        `components/questions/question-editor-hydration.test.tsx` pins (1) against the server
        render, so adding a server-visible submit control to this screen is a red rather than
        a silent reopening of the window. The guard that does real work is in
        `app/(shell)/forms/new/create-form.tsx`, whose submit is a real in-form `type="submit"`
        present in the served bytes. */}
      <Button
        type="button"
        variant="primary"
        size="md"
        isDisabled={save.isPending}
        onPress={() => {
          // `HTMLFormElement` rather than `Element`, because `requestSubmit` is on the form
          // interface; the cast is the narrowing `getElementById` cannot do for us.
          const form = document.getElementById(QUESTION_FORM_ID);
          if (form instanceof HTMLFormElement) form.requestSubmit();
        }}
      >
        {mode === "create" ? t("questions.create.submit") : t("questions.editor.save")}
      </Button>
    </>
  );
}
