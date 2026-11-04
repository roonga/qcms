"use client";

import { Button } from "@/components/kit";
import { ManualSaveNote } from "@/components/save-model";
import { t } from "@/lib/i18n/en";
import { QUESTION_FORM_ID, useQuestionSave } from "@/lib/questions/editor-bridge";

export function QuestionSave({ mode }: { readonly mode: "create" | "edit" }) {
  const save = useQuestionSave();
  if (save === undefined) return null;

  return (
    <>
      <ManualSaveNote
        messageKey={
          mode === "create" ? "questions.create.manualModel" : "questions.editor.manualModel"
        }
      />
      {/* Disable until hydration: earlier Server Action posts carry Origin: null under no-referrer and Next
   refuses them. */}
      <Button
        type="button"
        variant="primary"
        size="md"
        isDisabled={save.isPending}
        onPress={() => {
          // HTMLFormElement narrows the getElementById result to the interface that owns requestSubmit.
          const form = document.getElementById(QUESTION_FORM_ID);
          if (form instanceof HTMLFormElement) form.requestSubmit();
        }}
      >
        {mode === "create" ? t("questions.create.submit") : t("questions.editor.save")}
      </Button>
    </>
  );
}
