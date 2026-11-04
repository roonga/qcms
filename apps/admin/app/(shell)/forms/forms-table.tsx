import Link from "next/link";

import { EntityId } from "@/components/entity-id";
import type { FormListItem } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

import { PublishedCell } from "./published-cell";

export function FormsTable({ rows }: { readonly rows: readonly FormListItem[] }) {
  return (
    <div className="qcms-table qcms-table--forms">
      <table data-testid="qcms-forms-table">
        <caption className="qcms-visually-hidden">{t("forms.table.label")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("forms.column.slug")}</th>
            <th scope="col">{t("forms.column.formId")}</th>
            <th scope="col" className="qcms-cell--drop">
              {t("forms.column.locale")}
            </th>
            <th scope="col">{t("forms.column.status")}</th>
            <th scope="col">{t("forms.column.draft")}</th>
            <th scope="col" className="qcms-cell--num">
              {t("forms.column.version")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((form) => (
            <tr key={form.formId} data-form-id={form.formId}>
              <th scope="row">
                <Link
                  className="qcms-text-link"
                  href={`/forms/${encodeURIComponent(form.formId)}`}
                  aria-label={t("forms.open", { slug: form.slug })}
                >
                  {form.slug}
                </Link>
              </th>
              <td>
                {/* Form ids derive from author-entered slugs, so truncation could manufacture a plausible different
   identity. */}
                <EntityId kind="form" value={form.formId} />
              </td>
              <td className="qcms-cell--drop">{form.defaultLocale}</td>
              <td>{t(`forms.status.${form.status}`)}</td>
              <td>{form.hasDraft ? t("forms.draft.present") : t("forms.draft.none")}</td>
              <td className="qcms-cell--num">
                <PublishedCell form={form} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
