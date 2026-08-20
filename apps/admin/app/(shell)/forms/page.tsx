import { EmptyState } from "@/components/empty-state";
import { Alert, type TableRow } from "@/components/kit";
import type { FormListItem } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { listForms } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

import { createFormAction } from "./actions";
import { CreateForm } from "./create-form";
import { FormsTable } from "./forms-table";

/**
 * The form library (task 033; wireframe `admin-form-builder.md`, the screen its breadcrumb
 * roots at).
 *
 * A server component that proxies one call and renders the answer, exactly as 032's
 * question library does. Nothing is filtered or sorted here: `GET /admin/forms` returns
 * the whole set and the API owns its order, so a second ordering in this app would be a
 * decision the BFF has no authority to make (R2).
 *
 * ## What each row says, and why the two state columns are separate
 *
 * A form has two independent states and collapsing them loses the distinction that matters
 * most to an author: **draft** is "there is unpublished work in the builder" and
 * **published** is "respondents are seeing version N". A form can have both (the usual
 * mid-edit case), either, or neither, so they get a column each rather than one
 * merged status word that would have to invent a precedence between them.
 *
 * `status` is the third and separate thing: whether the form accepts responses at all
 * (open/closed), which 034's publish flow and the link screens act on.
 */

/** ISO day. Formatted on the server so the client renders the identical string. */
function isoDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function publishedCell(form: FormListItem): string {
  if (form.latestVersion === null) return t("forms.version.none");
  return form.publishedAt === null
    ? t("forms.version.value", { version: form.latestVersion })
    : t("forms.version.valueAt", {
        version: form.latestVersion,
        date: isoDay(form.publishedAt),
      });
}

function toRow(form: FormListItem): TableRow {
  return {
    id: form.formId,
    data: {
      slug: form.slug,
      formId: form.formId,
      locale: form.defaultLocale,
      status: t(`forms.status.${form.status}`),
      draft: form.hasDraft ? t("forms.draft.present") : t("forms.draft.none"),
      published: publishedCell(form),
    },
  };
}

export default async function FormsPage() {
  const session = await requireAdminSession();
  const result = await listForms(session);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("forms.title")}</h1>
        <p className="text-sm text-(--color-text-muted)">{t("forms.intro")}</p>
      </div>

      <CreateForm action={createFormAction} />

      {!result.ok && (
        <Alert variant="error">{t("forms.error.listFailed", { message: result.message })}</Alert>
      )}

      {/* `plan/admin-design-contracts.md` §3's panel. It carries no CTA, and that is
          the one place on this screen where §3's "a primary CTA when a creating
          action exists" is not applied literally: this screen's creating action is
          the `CreateForm` fieldset rendered immediately above, not a button leading
          somewhere, and there is no `/forms/new` route for a CTA to point at.
          Duplicating a two-field form inside the panel, or inventing a control that
          scrolls to it, would both be new patterns rather than applications of an
          existing one. Recorded for the design gate rather than decided quietly. */}
      {result.ok && result.data.length === 0 && (
        <EmptyState
          heading={t("forms.empty.title")}
          body={t("forms.empty.body")}
          testId="qcms-forms-empty"
        />
      )}

      {result.ok && result.data.length > 0 && (
        <div className="flex flex-col gap-2">
          <FormsTable
            rows={result.data.map(toRow)}
            columns={[
              { id: "slug", label: t("forms.column.slug"), isRowHeader: true },
              { id: "formId", label: t("forms.column.formId") },
              { id: "locale", label: t("forms.column.locale") },
              { id: "status", label: t("forms.column.status") },
              { id: "draft", label: t("forms.column.draft") },
              { id: "published", label: t("forms.column.version") },
            ]}
          />
          <p className="text-sm text-(--color-text-muted)">{t("forms.table.hint")}</p>
        </div>
      )}
    </div>
  );
}
