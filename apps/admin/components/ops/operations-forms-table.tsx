import Link from "next/link";

import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import { intakeOf, type OperationsFormRow } from "@/lib/ops/operations-forms";

/**
 * The Operations forms table: one row per form this caller operates in the selected
 * environment.
 *
 * A cell the caller holds no cell for reads the same as one with nothing to report, so no
 * column says which. Unreleased is its own intake reading rather than a shade of closed.
 *
 * Which columns drop at compact width (`plan/admin-design-contracts.md` §2): Workspace,
 * In progress and Last release describe; Form, Released, Intake and Submitted identify the
 * form and answer whether it is taking responses. No `min-inline-size` is declared, so
 * there is none to reset at the boundary.
 */
export function OperationsFormsTable({ rows }: { readonly rows: readonly OperationsFormRow[] }) {
  return (
    <div className="qcms-table">
      <table data-testid="qcms-operations-table">
        <caption className="qcms-visually-hidden">{t("operations.table")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("operations.column.form")}</th>
            <th scope="col" className="qcms-cell--drop">
              {t("operations.column.workspace")}
            </th>
            <th scope="col" className="qcms-cell--num">
              {t("operations.column.released")}
            </th>
            <th scope="col">{t("operations.column.intake")}</th>
            <th scope="col" className="qcms-cell--num">
              {t("operations.column.submitted")}
            </th>
            <th scope="col" className="qcms-cell--num qcms-cell--drop">
              {t("operations.column.inProgress")}
            </th>
            <th scope="col" className="qcms-cell--num qcms-cell--drop">
              {t("operations.column.lastRelease")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.formId} data-form-id={row.formId}>
              <th scope="row">
                <Link className="qcms-text-link" href={`/forms/${encodeURIComponent(row.formId)}`}>
                  {row.displayName}
                </Link>
                {row.displayName !== row.slug && (
                  <span className="block text-xs text-(--color-text-muted)">{row.slug}</span>
                )}
              </th>
              <td className="qcms-cell--drop">{row.workspace.name}</td>
              <td className="qcms-cell--num">{releasedText(row)}</td>
              <td>{intakeText(row)}</td>
              <td className="qcms-cell--num">
                {row.counts === null ? t("ops.common.none") : row.counts.submitted}
              </td>
              <td className="qcms-cell--num qcms-cell--drop">
                {row.counts === null ? t("ops.common.none") : row.counts.inProgress}
              </td>
              <td className="qcms-cell--num qcms-cell--drop">
                <OperatorDateTime iso={row.lastReleaseAt} fallback={t("ops.common.none")} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function releasedText(row: OperationsFormRow): string {
  if (!row.hasRelease) return t("operations.release.none");
  if (row.release === null) return t("ops.common.none");
  return `v${row.release.version}`;
}

function intakeText(row: OperationsFormRow): string {
  const intake = intakeOf(row);
  return intake === undefined ? t("ops.common.none") : t(`operations.intake.${intake}`);
}
