import Link from "next/link";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/kit";
import { erasureReasonText } from "@/components/ops/ops-tags";
import { formatDateTime } from "@/lib/i18n/format";
import { t, tPlural } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { listErasures } from "@/lib/server/responses";
import { requireAdminSession } from "@/lib/server/session";

/** The browser-tab title for this route (issue #536). */
export function generateMetadata(): Metadata {
  return pageMetadata(t("ops.erasures.title"));
}

/**
 * The erasure log (task 035; screen contract "erasure log screen - compliance evidence").
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

      {/* A FAILED READ RENDERS THE ALERT AND NOTHING ELSE
          (`plan/admin-design-contracts.md` §3, issue #513's rule). This screen used to
          fall back to an empty row list on failure and then render "Nothing has been
          erased." underneath the error - a claim about compliance evidence the app had
          just failed to load, which on this screen of all screens is the wrong thing to
          say. The empty state now lives inside the ok branch, where it can only be
          reached by having actually read the log and found it empty. */}
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
          {/* One table family (§2). WHICH COLUMNS DROP AT COMPACT WIDTH: Reason.
                Session, Form and Erased-at are how a tombstone is identified and dated
                as evidence; the reason describes it. Version never drops
                (`plan/admin-mobile-stance.md`, item 5). */}
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
                      <code className="qcms-link-id">{row.sessionId}</code>
                    </th>
                    <td>
                      <code className="qcms-link-id">{row.formId}</code>
                    </td>
                    <td className="qcms-cell--num">v{row.formVersion}</td>
                    <td className="qcms-cell--num">
                      {formatDateTime(row.erasedAt, t("ops.common.none"))}
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
