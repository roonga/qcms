import { OperatorDay } from "@/components/operator-time";
import { EmptyState } from "@/components/empty-state";
import { currentReleaseByEnvironment, type ReleaseRecord } from "@/lib/forms/releases";
import { t } from "@/lib/i18n/en";

/* The newest release per form/environment is current serving state; derive it from this same history to
   avoid conflicting reads. */

function movement(row: ReleaseRecord): string {
  if (row.rollback) {
    return t("forms.releases.rollbackFrom", { replaced: row.replacedVersion ?? 0 });
  }
  if (row.replacedVersion === null) return t("forms.releases.first");
  return t("forms.releases.replaced", { replaced: row.replacedVersion });
}

function intakeLabel(released: ReleaseRecord | undefined): string {
  if (released === undefined) return "";
  return t(released.closed ? "forms.versions.intakeClosed" : "forms.versions.intakeOpen");
}

export function EnvironmentSummary({
  releases,
  environments,
}: {
  readonly releases: readonly ReleaseRecord[];
  readonly environments: readonly string[];
}) {
  const current = currentReleaseByEnvironment(releases);
  return (
    <div className="qcms-table">
      <table data-testid="qcms-released-now">
        <caption className="qcms-visually-hidden">{t("forms.releases.currentTable")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("forms.releases.column.environment")}</th>
            <th scope="col" className="qcms-cell--num">
              {t("forms.releases.column.version")}
            </th>
            <th scope="col">{t("forms.versions.column.intake")}</th>
            <th scope="col">{t("forms.releases.column.releasedAt")}</th>
            <th scope="col" className="qcms-cell--drop">
              {t("forms.releases.column.releasedBy")}
            </th>
          </tr>
        </thead>
        <tbody>
          {environments.map((name) => {
            const released = current.get(name);
            return (
              <tr key={name} data-environment={name}>
                <th scope="row">{name}</th>
                <td className="qcms-cell--num">
                  {released === undefined
                    ? t("forms.releases.none")
                    : t("forms.version.value", { version: released.version })}
                </td>
                <td data-intake={released?.closed === true ? "closed" : "open"}>
                  {intakeLabel(released)}
                </td>
                <td>{released === undefined ? "" : <OperatorDay iso={released.releasedAt} />}</td>
                <td className="qcms-cell--drop">{released?.releasedBy ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReleaseHistory({ releases }: { readonly releases: readonly ReleaseRecord[] }) {
  if (releases.length === 0) {
    return (
      <EmptyState
        testId="qcms-releases-empty"
        heading={t("forms.releases.emptyTitle")}
        body={t("forms.releases.empty")}
      />
    );
  }
  return (
    <div className="qcms-table">
      <table data-testid="qcms-release-history">
        <caption className="qcms-visually-hidden">{t("forms.releases.historyTable")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("forms.releases.column.environment")}</th>
            <th scope="col" className="qcms-cell--num">
              {t("forms.releases.column.version")}
            </th>
            <th scope="col">{t("forms.releases.column.releasedAt")}</th>
            <th scope="col" className="qcms-cell--drop">
              {t("forms.releases.column.releasedBy")}
            </th>
            <th scope="col" className="qcms-cell--drop">
              {t("forms.releases.column.fromEnvironment")}
            </th>
            <th scope="col" className="qcms-cell--drop">
              {t("forms.releases.column.approvedBy")}
            </th>
          </tr>
        </thead>
        <tbody>
          {releases.map((row) => (
            <tr
              key={`${row.environment}-${row.sequence}`}
              data-environment={row.environment}
              data-version={row.version}
              data-rollback={row.rollback ? "true" : "false"}
            >
              <th scope="row">{row.environment}</th>
              <td className="qcms-cell--num">
                {t("forms.version.value", { version: row.version })}
                {row.rollback && (
                  <>
                    {" "}
                    <span className="qcms-rollback" data-testid="qcms-rollback-mark">
                      {t("forms.releases.rollback")}
                    </span>
                  </>
                )}
              </td>
              <td>
                <OperatorDay iso={row.releasedAt} />
                <span className="block text-xs text-(--color-text-muted)">{movement(row)}</span>
              </td>
              <td className="qcms-cell--drop">{row.releasedBy}</td>
              <td className="qcms-cell--drop">
                {row.fromEnvironment ?? t("forms.releases.noSource")}
              </td>
              <td className="qcms-cell--drop">
                {row.approvedBy ?? t("forms.releases.noApproval")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
