import { OperatorDay } from "@/components/operator-time";
import { EmptyState } from "@/components/empty-state";
import { currentReleaseByEnvironment, type ReleaseRecord } from "@/lib/forms/releases";
import { t } from "@/lib/i18n/en";

/**
 * The two readings of a release history, as the Versions view and the builder's production
 * review both render them (ADR-40; issue #1197 merged the release screen into Versions).
 *
 * Everything here comes from one history, because the history is the model: the newest row
 * for a (form, environment) pair **is** what is released there and whether intake is open,
 * so "serving now" is a derivation of the table below it rather than a second read that
 * could disagree with it. The rollback marking arrives on the row, computed by the API from
 * the release's own predecessor, so every screen showing it shows the same answer.
 *
 * Server components with no state: the act that changes any of this is the publish wizard's,
 * which is a screen of its own.
 */

/**
 * What this release did to its environment, in one phrase.
 *
 * Three cases and they are not interchangeable: a rollback names the version it went back
 * from, a first release says so (there was nothing to replace), and an ordinary release
 * names what it replaced. An operator reading a history is asking which of the three each
 * row is, and a single "released v4" sentence makes them work it out from the row above.
 */
function movement(row: ReleaseRecord): string {
  if (row.rollback) {
    return t("forms.releases.rollbackFrom", { replaced: row.replacedVersion ?? 0 });
  }
  if (row.replacedVersion === null) return t("forms.releases.first");
  return t("forms.releases.replaced", { replaced: row.replacedVersion });
}

/** The intake cell: blank where nothing is released, because there is no intake to report. */
function intakeLabel(released: ReleaseRecord | undefined): string {
  if (released === undefined) return "";
  return t(released.closed ? "forms.versions.intakeClosed" : "forms.versions.intakeOpen");
}

/**
 * What each environment is serving, and whether its intake is open.
 *
 * Every environment gets a row, including the ones with nothing released: "not released in
 * prod" is the answer an operator most needs, and a row that was simply absent would make
 * them wonder whether the screen had loaded.
 */
export function EnvironmentSummary({
  releases,
  environments,
}: {
  readonly releases: readonly ReleaseRecord[];
  /** The live environment set, in canonical order. Empty is the set nobody could read. */
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
                {/* Intake is the same release state (Q18): a close and a reopen append a row
                    carrying the version forward, so one read answers both questions and a
                    separate source could not disagree with this one. */}
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

/**
 * The append-only history, newest first, every environment.
 *
 * The rollback marking is a requirement rather than decoration: "released version 4 after
 * version 7" is the shape an incident review reads, and a history that presented it as an
 * ordinary row would make an operator count backwards to see what happened (ADR-40,
 * criterion 4). So a rollback row carries a badge and the version it rolled back from, in
 * words, in the row - not a colour, and not a tooltip.
 */
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
