import { HelpTip } from "@/components/help-tip";
import { EntityId } from "@/components/entity-id";
import { Alert } from "@/components/kit";
import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import { auditKindLabel } from "@/lib/membership/audit-wording";
import type { AuditPage } from "@/lib/membership/types";

/* Audit rows must contain acts only, with no answer values, respondent identifiers, or question text. */
export function AuditPanel({
  audit,
  message,
}: {
  readonly audit: AuditPage | undefined;
  readonly message: string | undefined;
}) {
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
                  {audit.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <OperatorDateTime iso={row.occurredAt} />
                      </td>
                      <td>
                        {row.actorEmail ?? t("membership.audit.unknownActor", { actor: row.actor })}
                      </td>
                      <td>{auditKindLabel(row.kind)}</td>
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
          </>
        ))}
    </section>
  );
}
