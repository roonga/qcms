import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
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

export default async function FormsPage() {
  const session = await requireAdminSession();
  const result = await listForms(session);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-(--color-text)">{t("forms.title")}</h1>
          <p className="text-sm text-(--color-text-muted)">{t("forms.intro")}</p>
        </div>
        {/* The header's creating action, rendered except in the one state where the
            empty panel below carries it instead. Same rule and same reason as
            `/questions`, whose header this is copied from rather than re-derived: two
            controls with the same accessible name on one screen are ambiguous to anyone
            navigating by name, and `plan/admin-design-contracts.md` §3 asks the empty
            state to OFFER the creating action rather than to sit beside a copy of it.
            This list takes no filters, so "empty" has only the one meaning here. */}
        {!(result.ok && result.data.length === 0) && (
          <Link href="/forms/new" className="qcms-button-link">
            {t("forms.new")}
          </Link>
        )}
      </div>

      <CreateForm action={createFormAction} />

      {!result.ok && (
        <Alert variant="error">{t("forms.error.listFailed", { message: result.message })}</Alert>
      )}

      {/* `plan/admin-design-contracts.md` §3's panel, now with the primary CTA the base
          clause asks for. The 2026-08-20 amendment exempted this one screen because its
          creating action was a fieldset on the screen itself and there was no
          `/forms/new` route for a CTA to point at. Issue 685 removed both halves of that
          premise: the POC picks a separate route for both library screens, so the panel
          points at it exactly as the question library's does. An empty screen is where a
          first-time operator looks, not the corner of the header. */}
      {result.ok && result.data.length === 0 && (
        <EmptyState
          heading={t("forms.empty.title")}
          body={t("forms.empty.body")}
          testId="qcms-forms-empty"
          action={
            <Link href="/forms/new" className="qcms-button-link">
              {t("forms.new")}
            </Link>
          }
        />
      )}

      {result.ok && result.data.length > 0 && (
        <div className="flex flex-col gap-2">
          <FormsTable rows={result.data} />
          <p className="text-sm text-(--color-text-muted)">{t("forms.table.hint")}</p>
        </div>
      )}
    </div>
  );
}
