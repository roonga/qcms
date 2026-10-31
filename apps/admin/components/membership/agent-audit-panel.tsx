import { EntityId } from "@/components/entity-id";
import { Alert } from "@/components/kit";
import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import type { AgentAuditPage } from "@/lib/membership/types";

/**
 * The agent audit for one workspace (SEC-17).
 *
 * It sits beside the access audit because it answers the same question for the same
 * readers: the workspace's owners and the installation administrator, enforced by the
 * API's own grant check, so a refused read arrives as a message rather than as an empty
 * table that would say "the assistant has changed nothing here".
 *
 * **Every row is an act a human confirmed.** The step index and count are what make a
 * plan legible after the fact, and `detail` is one non-content fact: a version, an
 * environment name, a count or a role name. No answer value, no secret and no authored
 * text can reach it, because the row never carried one.
 */
export function AgentAuditPanel({
  audit,
  message,
}: {
  readonly audit: AgentAuditPage | undefined;
  readonly message: string | undefined;
}) {
  return (
    <section aria-labelledby="qcms-agent-audit-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="qcms-agent-audit-heading" className="text-lg font-semibold text-(--color-text)">
          {t("membership.agentAudit.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("membership.agentAudit.intro")}</p>
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
            <div className="qcms-table min-w-0">
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
