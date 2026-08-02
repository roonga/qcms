import Link from "next/link";

import { Alert } from "@/components/kit";
import { erasureReasonText } from "@/components/ops/ops-tags";
import { formatDateTime } from "@/lib/i18n/format";
import { t, tPlural } from "@/lib/i18n/en";
import { listErasures } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The erasure log (task 035; wireframe "erasure log screen - compliance evidence").
 *
 * A tombstone is what an ADR-17 erasure leaves: the session id, the form, the version,
 * when and why. It holds no answers, which is exactly what makes it publishable as
 * evidence - the log can be shown to whoever asks whether a subject request was
 * honoured, without showing them what was erased.
 *
 * A server component with no client half: this screen has no action on it. That is
 * deliberate rather than unfinished. Erasure is performed on the response it erases,
 * where the operator can see what they are about to destroy; a "delete" button on a
 * list of ids would be the single-click path exit criterion 2 rules out.
 */
export default async function ErasureLogPage() {
  const session = await requireAdminSession();
  const erasures = await listErasures(session);
  const rows = erasures.ok ? erasures.data : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("ops.erasures.title")}</h1>
        <p className="text-sm text-(--color-text-muted)">{t("ops.erasures.intro")}</p>
      </div>

      <p>
        <Link className="qcms-text-link" href="/responses">
          {t("ops.erasures.back")}
        </Link>
      </p>

      {!erasures.ok && (
        <Alert variant="error">{t("ops.erasures.loadFailed", { message: erasures.message })}</Alert>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-erasures-empty">
          {t("ops.erasures.empty")}
        </p>
      ) : (
        <>
          <p className="text-sm text-(--color-text-muted)" data-testid="qcms-erasures-total">
            {tPlural("ops.erasures.total.one", "ops.erasures.total.other", rows.length)}
          </p>
          <table className="qcms-ops-table" data-testid="qcms-erasures-table">
            <caption className="qcms-visually-hidden">{t("ops.erasures.table")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("ops.erasures.column.sessionId")}</th>
                <th scope="col">{t("ops.erasures.column.formId")}</th>
                <th scope="col">{t("ops.erasures.column.formVersion")}</th>
                <th scope="col">{t("ops.erasures.column.erasedAt")}</th>
                <th scope="col">{t("ops.erasures.column.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sessionId} data-session-id={row.sessionId}>
                  <th scope="row">
                    <code className="qcms-link-id">{row.sessionId}</code>
                  </th>
                  <td>
                    <code className="qcms-link-id">{row.formId}</code>
                  </td>
                  <td>v{row.formVersion}</td>
                  <td>{formatDateTime(row.erasedAt, t("ops.common.none"))}</td>
                  <td>{erasureReasonText(row.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
