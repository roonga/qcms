import Link from "next/link";

import { CopyEntityId } from "@/components/copy-entity-id";
import type { FormListItem } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { textOf } from "@/lib/questions/definition";

import { PublishedCell } from "./published-cell";

export function FormsTable({ rows }: { readonly rows: readonly FormListItem[] }) {
  return (
    <div className="qcms-table qcms-table--forms">
      <table data-testid="qcms-forms-table">
        <caption className="qcms-visually-hidden">{t("forms.table.label")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("forms.column.form")}</th>
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
          {rows.map((form) => {
            const title = textOf(form.title ?? undefined).trim();
            // An untitled form leads with its address rather than with a placeholder every
            // untitled row would share.
            const name = title === "" ? form.slug : title;
            return (
              <tr key={form.formId} data-form-id={form.formId} data-form-slug={form.slug}>
                <th scope="row">
                  <span className="qcms-rowlead">
                    <Link
                      className="qcms-text-link qcms-rowlead__name"
                      href={`/forms/${encodeURIComponent(form.formId)}`}
                      aria-label={t("forms.open", { name })}
                    >
                      {name}
                    </Link>
                    <span className="qcms-rowlead__sub">
                      {title === "" ? null : (
                        <span className="qcms-rowlead__address">{form.slug}</span>
                      )}
                      {/* The whole id is copied rather than painted: a form id derives from an
   author-entered slug, so an abbreviation of one can be another valid id. */}
                      <CopyEntityId kind="form" value={form.formId} display={form.formId} />
                    </span>
                  </span>
                </th>
                <td className="qcms-cell--drop">{form.defaultLocale}</td>
                <td>{t(`forms.status.${form.status}`)}</td>
                <td>{form.hasDraft ? t("forms.draft.present") : t("forms.draft.none")}</td>
                <td className="qcms-cell--num">
                  <PublishedCell form={form} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
