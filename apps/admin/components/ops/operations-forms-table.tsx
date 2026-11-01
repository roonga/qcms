import Link from "next/link";

import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import { formContextLinks, primaryFormContext } from "@/lib/ops/form-contexts";
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
                <FormName row={row} />
                {row.displayName !== row.slug && (
                  <span className="block text-xs text-(--color-text-muted)">{row.slug}</span>
                )}
                <FormContexts row={row} />
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

// Plain text when the caller may open no context: the row is here because an operational
// cell admitted it, which is not the same as a screen it may open.
function FormName({ row }: { readonly row: OperationsFormRow }) {
  const primary = primaryFormContext(row);
  if (primary === undefined) {
    return <span data-testid="qcms-operations-name">{row.displayName}</span>;
  }
  return (
    <Link
      className="qcms-text-link"
      href={primary.href}
      data-testid="qcms-operations-name"
      data-context={primary.context}
    >
      {row.displayName}
    </Link>
  );
}

// The first context is the name above these, so it is dropped here. Every link names its
// own row, because one row's Responses link is otherwise read out like every other row's.
function FormContexts({ row }: { readonly row: OperationsFormRow }) {
  const rest = formContextLinks(row).slice(1);
  if (rest.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 text-xs" data-testid="qcms-operations-contexts">
      {rest.map((link) => (
        <li key={link.context}>
          {/* 24px of target, so four links on one line satisfy SC 2.5.8 on their own size
              rather than on the space between them. */}
          <Link
            className="qcms-text-link inline-flex min-h-6 items-center"
            href={link.href}
            data-context={link.context}
            aria-label={t("operations.context.named", {
              context: link.label,
              form: row.displayName,
            })}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
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
