import { HelpTip } from "@/components/help-tip";
import { EntityId } from "@/components/entity-id";
import { Alert } from "@/components/kit";
import { OperatorDateTime } from "@/components/operator-time";
import { ResultPager } from "@/components/access/access-filters";
import { t } from "@/lib/i18n/en";
import { auditHref, matchesAuditPerson, type AuditFilters } from "@/lib/membership/audit-filters";
import { auditKindLabel, isMirroredSiteAct } from "@/lib/membership/audit-wording";
import type { AuditPage } from "@/lib/membership/types";

/* Audit rows must contain acts only, with no answer values, respondent identifiers, or question text. */
export function AuditPanel({
  audit,
  message,
  filters,
  basePath,
  locale,
}: {
  readonly audit: AuditPage | undefined;
  readonly message: string | undefined;
  readonly filters: AuditFilters;
  readonly basePath: string;
  readonly locale: string;
}) {
  const rows = (audit?.rows ?? []).filter((row) => matchesAuditPerson(row, filters.person));
  const narrowed =
    audit !== undefined && filters.person !== undefined && rows.length !== audit.rows.length;

  return (
    <section aria-labelledby="qcms-audit-heading" className="flex min-w-0 flex-col gap-3">
      <div className="qcms-help-head">
        <h1 id="qcms-audit-heading" className="text-xl font-semibold text-(--color-text)">
          {t("membership.audit.heading")}
        </h1>
        <HelpTip>{t("membership.audit.intro")}</HelpTip>
      </div>

      {audit === undefined && (
        <Alert variant="error">
          {t("membership.audit.loadFailed", { message: message ?? "" })}
        </Alert>
      )}

      {audit !== undefined &&
        (audit.rows.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.audit.none")}</p>
        ) : (
          <>
            <p className="text-xs text-(--color-text-muted)">
              {t("membership.audit.total", { total: audit.total })}
            </p>
            {narrowed && (
              <p className="text-xs text-(--color-text-muted)" data-testid="qcms-audit-narrowed">
                {t(rows.length === 0 ? "membership.audit.noneOnPage" : "membership.audit.narrowed", {
                  shown: rows.length,
                  rows: audit.rows.length,
                  person: filters.person ?? "",
                })}
              </p>
            )}
            {rows.length > 0 && (
              <div className="qcms-table qcms-table--wide min-w-0">
                <table>
                  <caption className="qcms-visually-hidden">{t("membership.audit.table")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("membership.audit.columnWhen")}</th>
                      <th scope="col">{t("membership.audit.columnActor")}</th>
                      <th scope="col">{t("membership.audit.columnKind")}</th>
                      <th scope="col">{t("membership.audit.columnEnvironment")}</th>
                      <th scope="col">{t("membership.audit.columnForm")}</th>
                      <th scope="col">{t("membership.audit.columnDetail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <OperatorDateTime iso={row.occurredAt} />
                        </td>
                        <td>
                          {row.actorEmail ??
                            t("membership.audit.unknownActor", { actor: row.actor })}
                        </td>
                        <td>
                          <span className="flex flex-wrap items-center gap-2">
                            {auditKindLabel(row.kind)}
                            {isMirroredSiteAct(row.kind) && (
                              <span className="qcms-tag qcms-tag--draft">
                                {t("membership.audit.mirrored")}
                              </span>
                            )}
                          </span>
                        </td>
                        <td>{row.environment ?? t("membership.audit.empty")}</td>
                        <td>
                          {row.formId === null ? (
                            t("membership.audit.empty")
                          ) : (
                            <EntityId kind="form" value={row.formId} />
                          )}
                        </td>
                        <td>{row.detail ?? t("membership.audit.empty")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ResultPager
              page={audit.page}
              pageSize={audit.pageSize}
              total={audit.total}
              locale={locale}
              pageHref={(page) => auditHref(basePath, filters, { page })}
            />
          </>
        ))}
    </section>
  );
}
