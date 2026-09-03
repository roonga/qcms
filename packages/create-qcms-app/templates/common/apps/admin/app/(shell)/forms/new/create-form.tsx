"use client";

import { useActionState, useState } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { IDLE_CREATE_FORM, type CreateFormState } from "@/lib/forms/builder-state";
import { formIdFromSlug } from "@/lib/forms/draft";
import { t } from "@/lib/i18n/en";

/**
 * The creating form, on the route that exists to hold it (issue 685; task 033 built it as
 * a card on the library screen).
 *
 * ## Why it is a screen rather than a card on the list
 *
 * `plan/admin-shell-poc/library-lists-poc.html` picks one creation pattern for both
 * library screens - a separate route, reached from a header link - and names this card as
 * the one that should change to match. The reason is the same one the id callout below
 * states to the author: **minting an id is a one-way door (R6)**. `formId` is derived from
 * the slug once and never changes again, and an id is never reused for a different
 * meaning, so a form created with a mistyped slug is a permanent artefact of the
 * deployment rather than something a later edit can tidy away. That decision competing for
 * attention with a table of everything already made is exactly the half-attention a
 * one-way door should not be opened in.
 *
 * ## Why it lives beside the page rather than in `components/`
 *
 * Unchanged from 033, and now more literally true: it is this route's own form and nothing
 * else renders it, so it sits in the route folder next to the page that owns it. The
 * builder's components, which several screens and the e2e suite address, live under
 * `components/forms/`.
 *
 * ## Why the id is shown while the author types
 *
 * A one-way door should show what is on the other side of it *before* it is opened.
 * `formIdFromSlug` is the same pure function `createFormAction` uses to mint the real id,
 * so the preview cannot drift from the result. The callout is the shape `/questions/new`
 * uses for the same statement (`components/questions/question-editor.tsx`) and the shape
 * `plan/admin-shell-poc/settings-newquestion-poc.html` draws it in: an eyebrow, the value,
 * and the sentence about permanence.
 *
 * The live preview is the one reason this is a client component. The form itself is a
 * plain `<form action={formAction}>`: the kit's `Form` takes a string `action` (a URL) and
 * cannot carry a server action, which is why 032's editor posts through a raw element too.
 */
export function CreateForm({
  action,
}: {
  readonly action: (state: CreateFormState, formData: FormData) => Promise<CreateFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE_CREATE_FORM);
  const [slug, setSlug] = useState(state.submitted?.slug ?? "");
  // Restore a rejected submission that arrived through a pre-hydration full POST, where
  // the initialiser above has already run with an empty value. Adjusting state during
  // render is React's documented answer for "derive from a prop that just changed".
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.submitted !== undefined) setSlug(state.submitted.slug);
  }

  const formId = formIdFromSlug(slug);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "error" && (
        <Alert variant="error">{state.message ?? t("forms.error.unknownCreate")}</Alert>
      )}

      <TextField
        name="slug"
        label={t("forms.create.slug")}
        description={t("forms.create.slugHint")}
        value={slug}
        isRequired
        onChange={setSlug}
      />

      <div className="qcms-id-callout">
        <p className="text-xs uppercase tracking-wide text-(--color-text-muted)">
          {t("forms.create.id")}
        </p>
        <p className="qcms-id-callout__value">
          {formId === "" ? t("forms.create.idPending") : formId}
        </p>
        <p className="text-sm text-(--color-text-muted)">{t("forms.create.idNote")}</p>
      </div>

      <TextField
        name="title"
        label={t("forms.create.formTitle")}
        description={t("forms.create.formTitleHint")}
        defaultValue={state.submitted?.title ?? ""}
      />
      <TextField
        name="defaultLocale"
        label={t("forms.create.locale")}
        description={t("forms.create.localeHint")}
        defaultValue={state.submitted?.defaultLocale ?? "en"}
        isRequired
      />

      <div>
        <Button type="submit" variant="primary" size="md" isDisabled={isPending}>
          {isPending ? t("forms.create.submitting") : t("forms.create.submit")}
        </Button>
      </div>
    </form>
  );
}
