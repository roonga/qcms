import { HelpTip } from "@/components/help-tip";
import { EntityId } from "@/components/entity-id";
import { Alert } from "@/components/kit";
import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import type { AgentAuditPage } from "@/lib/membership/types";

/* Audit human-confirmed acts using non-content facts only; never include answers, secrets, or authored
   text. */
export function AgentAuditPanel({
  audit,
  message,
}: {
  readonly audit: AgentAuditPage | undefined;
  readonly message: string | undefined;
}) {
  return (
    <section aria-labelledby="qcms-agent-audit-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="qcms-agent-audit-heading" className="text-xl font-semibold text-(--color-text)">
          {t("membership.agentAudit.heading")}
        </h1>
        <HelpTip>{t("membership.agentAudit.intro")}</HelpTip>
      </div>

      {audit === undefined && (
        <Alert variant="error">
          {t("membership.agentAudit.loadFailed", { message: message ?? "" })}
        </Alert>
      )}

      {audit !== undefined &&
        (audit.rows.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.agentAudit.none")}</p>
        ) : (
          <>
            <p className="text-xs text-(--color-text-muted)">
              {t("membership.agentAudit.total", { total: audit.total })}
            </p>
            <div className="qcms-table qcms-table--wide min-w-0">
              <table>
                <caption className="qcms-visually-hidden">
                  {t("membership.agentAudit.table")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("membership.agentAudit.columnWhen")}</th>
                    <th scope="col">{t("membership.agentAudit.columnActor")}</th>
                    <th scope="col">{t("membership.agentAudit.columnKind")}</th>
                    <th scope="col">{t("membership.agentAudit.columnStep")}</th>
                    <th scope="col">{t("membership.agentAudit.columnScreen")}</th>
                    <th scope="col">{t("membership.agentAudit.columnEnvironment")}</th>
                    <th scope="col">{t("membership.agentAudit.columnForm")}</th>
                    <th scope="col">{t("membership.agentAudit.columnDetail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <OperatorDateTime iso={row.confirmedAt} />
                      </td>
                      <td>
                        {row.actorEmail ??
                          t("membership.agentAudit.unknownActor", { actor: row.actor })}
                      </td>
                      <td>{row.kind}</td>
                      <td>
                        {t("membership.agentAudit.step", {
                          index: row.stepIndex + 1,
                          count: row.stepCount,
                        })}
                      </td>
                      <td>{row.screen}</td>
                      <td>{row.environment ?? t("membership.agentAudit.empty")}</td>
                      <td>
                        {row.formId === null ? (
                          t("membership.agentAudit.empty")
                        ) : (
                          <EntityId kind="form" value={row.formId} />
                        )}
                      </td>
                      <td>{row.detail ?? t("membership.agentAudit.empty")}</td>
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
