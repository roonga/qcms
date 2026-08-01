"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Card, TextField } from "@/components/kit";
import { IDLE_CREATE_FORM, type CreateFormState } from "@/lib/forms/builder-state";
import { formIdFromSlug } from "@/lib/forms/draft";
import { t } from "@/lib/i18n/en";

/**
 * The create-form card on the library screen (task 033).
 *
 * ## Why it lives beside the page rather than in `components/`
 *
 * It is the library route's own form and nothing else renders it, so it sits in the route
 * folder next to the page that owns it. The builder's components, which several screens
 * and the e2e suite address, live under `components/forms/`.
 *
 * ## Why the id is shown while the author types
 *
 * `formId` is minted from the slug once and never changes again (R6): every draft, every
 * published version, every collected response and every rule reference is addressed by it.
 * That makes the slug field a one-way door, and a one-way door should show what is on the
 * other side of it *before* it is opened. `formIdFromSlug` is the same pure function the
 * action uses to mint the real id, so the preview cannot drift from the result.
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
    <div className="qcms-card">
      <Card padding="md" radius="md" border>
        <form action={formAction} className="flex flex-col gap-4">
          <fieldset className="qcms-fieldset qcms-fieldset--flat">
            <legend className="text-base font-semibold text-(--color-text)">
              {t("forms.create.title")}
            </legend>

            {state.status === "error" && (
              <Alert variant="error">{state.message ?? t("forms.error.unknownCreate")}</Alert>
            )}

            <div className="qcms-filters__row">
              <TextField
                name="slug"
                label={t("forms.create.slug")}
                description={t("forms.create.slugHint")}
                value={slug}
                isRequired
                onChange={setSlug}
              />
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
            </div>

            <p className="text-sm text-(--color-text-muted)">
              {formId === ""
                ? t("forms.create.idPending")
                : t("forms.create.idPreview", { formId })}
            </p>

            <div>
              <Button type="submit" variant="primary" size="md" isDisabled={isPending}>
                {isPending ? t("forms.create.submitting") : t("forms.create.submit")}
              </Button>
            </div>
          </fieldset>
        </form>
      </Card>
    </div>
  );
}
