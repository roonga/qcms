import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { erasureReasonText } from "@/components/ops/ops-tags";
import { EntityId } from "@/components/entity-id";
import { QueueFormCell } from "@/components/ops/queue-form-cell";
import { OperatorDateTime } from "@/components/operator-time";
import { t, tPlural } from "@/lib/i18n/en";
import { queueFormNames } from "@/lib/ops/queue-forms";
import { pageMetadata } from "@/lib/page-title";
import { listAllForms } from "@/lib/server/forms";
import { listErasures } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

export function generateMetadata(): Metadata {
  return pageMetadata(t("ops.erasures.title"));
}

export default async function ErasureLogPage() {
  const session = await requireAdminSession();
  const [erasures, forms] = await Promise.all([listErasures(session), listAllForms(session)]);
  const names = queueFormNames(forms);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("ops.erasures.title")}</h1>
        <p className="text-sm text-(--color-text-muted)">{t("ops.erasures.intro")}</p>
      </div>

      {!erasures.ok && (
        <Alert variant="error">{t("ops.erasures.loadFailed", { message: erasures.message })}</Alert>
      )}

      {erasures.ok && erasures.data.length === 0 && (
        <EmptyState
          heading={t("ops.erasures.emptyTitle")}
          body={t("ops.erasures.empty")}
          testId="qcms-erasures-empty"
        />
      )}

      {erasures.ok && erasures.data.length > 0 && (
        <>
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-erasures-total">
            {tPlural("ops.erasures.total.one", "ops.erasures.total.other", erasures.data.length)}
          </p>
          <div className="qcms-table">
            <table data-testid="qcms-erasures-table">
              <caption className="qcms-visually-hidden">{t("ops.erasures.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("ops.erasures.column.sessionId")}</th>
                  <th scope="col">{t("ops.erasures.column.formId")}</th>
                  <th scope="col" className="qcms-cell--num">
                    {t("ops.erasures.column.formVersion")}
                  </th>
                  <th scope="col" className="qcms-cell--num">
                    {t("ops.erasures.column.erasedAt")}
                  </th>
                  <th scope="col" className="qcms-cell--drop">
                    {t("ops.erasures.column.reason")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {erasures.data.map((row) => (
                  <tr key={row.sessionId} data-session-id={row.sessionId}>
                    <th scope="row">
                      <EntityId kind="session" value={row.sessionId} />
                    </th>
                    <td>
                      <QueueFormCell names={names} formId={row.formId} />
                    </td>
                    <td className="qcms-cell--num">v{row.formVersion}</td>
                    <td className="qcms-cell--num">
                      <OperatorDateTime iso={row.erasedAt} fallback={t("ops.common.none")} />
                    </td>
                    <td className="qcms-cell--drop">{erasureReasonText(row.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
