import Link from "next/link";

import { Alert } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { listForms } from "@/lib/server/forms";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The responses area (task 035, replacing 031's placeholder).
 *
 * Responses belong to a form, so this screen is a way in rather than a browser of its
 * own: pick a form, or open the erasure log. There is deliberately no cross-form
 * response list - the API has no route for one, and inventing a client-side merge
 * would give an operator a count and a page number that describe nothing the server
 * agrees with.
 */
export default async function ResponsesPage() {
  const session = await requireAdminSession();
  const forms = await listForms(session);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("ops.area.responses.title")}
        </h1>
        <p className="text-sm text-(--color-text-muted)">{t("ops.area.responses.intro")}</p>
      </div>

      <p>
        <Link className="qcms-text-link" href="/responses/erasures">
          {t("ops.area.responses.erasureLog")}
        </Link>
      </p>

      {!forms.ok && (
        <Alert variant="error">
          {t("ops.area.responses.formsFailed", { message: forms.message })}
        </Alert>
      )}
      {/*
       * Three states, not two (issue #513). The read can fail, succeed with nothing, or
       * succeed with forms, and only the last two have a list to show. A failed read
       * renders nothing here on purpose: the alert above already says "the form list
       * could not be loaded", so a second element would either repeat it or - worse, if
       * it borrowed the sentence below - assert that no forms exist, which is precisely
       * what a failed read does not know. An empty `<ul>` is the same mistake told to a
       * screen reader as "list, 0 items".
       */}
      {forms.ok &&
        (forms.data.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-responses-no-forms">
            {t("ops.area.responses.noForms")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="qcms-responses-form-list">
            {forms.data.map((form) => (
              <li key={form.formId}>
                <Link
                  className="qcms-text-link"
                  href={`/forms/${encodeURIComponent(form.formId)}/responses`}
                >
                  {t("ops.area.responses.pickForm", { title: form.slug })}
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
