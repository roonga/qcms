import Link from "next/link";

import type { FormListItem } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";
import { formatDay } from "@/lib/i18n/format";

/**
 * The form library table (task 033).
 *
 * ## The row was the control, and is not any more (issue 570)
 *
 * This table recorded the same trade 032's `QuestionsTable` did, for the same reason, and
 * it retires here for the same one: `plan/admin-design-contracts.md` §2 puts a real anchor
 * in the row's identifying cell and retires whole-row `onRowAction`. The long version of
 * why hand-authored markup is not the ADR-22 breach the old note feared is on
 * `components/questions/questions-table.tsx`; it applies unchanged here.
 *
 * The identifying cell is the **slug**, not the form id. The slug is what an author names
 * a form by and what the builder's own heading shows, and the id is the value they paste
 * into a ticket. So the slug carries the anchor and the id keeps a column of its own,
 * which is also what makes the link text worth reading rather than a hex string.
 *
 * ## Which columns drop at compact width (§2)
 *
 * The identify-versus-describe test, applied to six columns:
 *
 *  - **Slug** and **Form ID** identify, and the slug is the anchor.
 *  - **Published** is the Version column, and the Version column never drops
 *    (`plan/admin-mobile-stance.md`, item 5).
 *  - **Status** is open or closed: whether the form is taking responses at all. It is the
 *    one state on this screen that respondents can see, so it stays.
 *  - **Draft** stays with it, and the two are why this table has two state columns rather
 *    than one merged word: "there is unpublished work in the builder" and "respondents
 *    are seeing version N" are independent, and an author arriving at 390px to decide
 *    whether to open the builder is asking exactly that pair of questions.
 *  - **Locale** describes. Every form in a single-locale deployment carries the same
 *    value, so it is the column that distinguishes fewest rows from each other, and it
 *    drops.
 *
 * No `min-inline-size` is declared here, so there is none to reset at the boundary: the
 * remaining five columns fit, and the family's scroll container stays the fallback rather
 * than the default experience.
 */
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
            {/* Not `qcms-cell--num`. The positional rule this replaces put tabular-nums
                on column 5 under the comment "Draft version", and column 5 holds
                "Unpublished draft" or "No draft": words, with no figure in them. That is
                the harmless half of the asymmetry issue 514 named when it refused to
                guess compact-width drops by index - a wrong `nth-child` here only
                un-tabularises a column, while a wrong one there would hide a data
                column outright. Naming the column in its own markup is what makes both
                halves impossible. */}
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
                <code className="qcms-link-id">{form.formId}</code>
              </td>
              <td className="qcms-cell--drop">{form.defaultLocale}</td>
              <td>{t(`forms.status.${form.status}`)}</td>
              <td>{form.hasDraft ? t("forms.draft.present") : t("forms.draft.none")}</td>
              <td className="qcms-cell--num">{publishedCell(form)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What version respondents are seeing, and when it was frozen. */
function publishedCell(form: FormListItem): string {
  if (form.latestVersion === null) return t("forms.version.none");
  return form.publishedAt === null
    ? t("forms.version.value", { version: form.latestVersion })
    : t("forms.version.valueAt", {
        version: form.latestVersion,
        date: formatDay(form.publishedAt),
      });
}
