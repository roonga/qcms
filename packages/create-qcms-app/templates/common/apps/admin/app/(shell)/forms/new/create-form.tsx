"use client";

import { useActionState, useState } from "react";

import { Alert, Button, TextField } from "@/components/kit";
import { IDLE_CREATE_FORM, type CreateFormState } from "@/lib/forms/builder-state";
import { formIdFromSlug } from "@/lib/forms/draft";
import { useIsHydrated } from "@/lib/hydrated";
import { t } from "@/lib/i18n/en";

export function CreateForm({
  action,
}: {
  readonly action: (state: CreateFormState, formData: FormData) => Promise<CreateFormState>;
}) {
  const [state, formAction, isPending] = useActionState(action, IDLE_CREATE_FORM);
  // Disable submit until hydration: an earlier native Server Action POST carries Origin: null and Next
  // refuses it.
  const isHydrated = useIsHydrated();
  const [slug, setSlug] = useState(state.submitted?.slug ?? "");
  // A pre-hydration rejected POST can change the initial prop after state initialization; restore that
  // submission during render.
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
        <Button type="submit" variant="primary" size="md" isDisabled={isPending || !isHydrated}>
          {isPending ? t("forms.create.submitting") : t("forms.create.submit")}
        </Button>
      </div>
    </form>
  );
}
