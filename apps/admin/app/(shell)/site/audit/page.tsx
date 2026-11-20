import type { Metadata } from "next";

import { ResultPager } from "@/components/access/access-filters";
import { HelpTip } from "@/components/help-tip";
import { Alert } from "@/components/kit";
import { OperatorDateTime } from "@/components/operator-time";
import { loadSiteScreen } from "@/components/site/site-screen";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { appLocale } from "@/lib/server/config";
import { listWorkspaces } from "@/lib/server/membership";
import { readSiteAudit } from "@/lib/server/site-admin";
import { accountNames } from "@/lib/server/site-names";
import {
  readSiteAuditFilters,
  siteAuditActLabel,
  siteAuditActor,
  siteAuditHref,
  siteAuditPeople,
  siteAuditSubject,
  SYSTEM_ACTOR,
} from "@/lib/site/audit";

export function generateMetadata(): Metadata {
  return pageMetadata(t("site.audit.title"));
}

/* Site audit rows carry acts only: no credential, no answer value and no authored text. */
export default async function SiteAuditPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return screen.element;
  const { session } = screen;
  const filters = readSiteAuditFilters(await searchParams);
  const [audit, workspaces] = await Promise.all([
    readSiteAudit(session, filters),
    listWorkspaces(session),
  ]);
  const rows = audit.ok ? audit.data.rows : [];
  const people = await accountNames(session, siteAuditPeople(rows));
  const workspaceNames = new Map(
    (workspaces.ok ? workspaces.data : []).map((entry) => [entry.workspaceId, entry.name]),
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="qcms-help-head">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("site.audit.title")}</h1>
        <HelpTip>{t("site.audit.intro")}</HelpTip>
      </div>
      <p className="text-sm text-(--color-text-muted)">{t("site.audit.note")}</p>

      {!audit.ok && (
        <Alert variant="error">{t("site.audit.loadFailed", { message: audit.message })}</Alert>
      )}

      {audit.ok && rows.length === 0 && (
        <p className="text-sm text-(--color-text-muted)" data-testid="qcms-site-audit-empty">
          {t(filters.activeCount > 0 ? "site.audit.noneMatching" : "membership.audit.none")}
        </p>
      )}

      {audit.ok && rows.length > 0 && (
        <>
          <div className="qcms-table qcms-table--wide min-w-0">
            <table data-testid="qcms-site-audit-table">
              <caption className="qcms-visually-hidden">{t("site.audit.table")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("membership.audit.columnWhen")}</th>
                  <th scope="col">{t("membership.audit.columnActor")}</th>
                  <th scope="col">{t("site.audit.column.act")}</th>
                  <th scope="col">{t("site.audit.column.subject")}</th>
                  <th scope="col">{t("membership.audit.columnDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const mirrored =
                    row.workspaceId === null ? undefined : workspaceNames.get(row.workspaceId);
                  return (
                    <tr key={row.id} data-audit-row={row.id} data-audit-kind={row.kind}>
                      <td>
                        <OperatorDateTime iso={row.occurredAt} />
                      </td>
                      <td data-system-actor={row.actor === SYSTEM_ACTOR ? "" : undefined}>
                        {siteAuditActor(row)}
                      </td>
                      <td>
                        <span className="flex flex-wrap items-center gap-2">
                          {siteAuditActLabel(row)}
                          {row.workspaceId !== null && (
                            <span className="qcms-tag qcms-tag--draft">
                              {mirrored === undefined
                                ? t("site.audit.mirroredUnnamed")
                                : t("site.audit.mirrored", { workspace: mirrored })}
                            </span>
                          )}
                        </span>
                      </td>
                      <td>{siteAuditSubject(row, { people, workspaces: workspaceNames })}</td>
                      <td>{row.detail ?? t("membership.audit.empty")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ResultPager
            page={audit.data.page}
            pageSize={audit.data.pageSize}
            total={audit.data.total}
            locale={appLocale()}
            pageHref={(page) => siteAuditHref(filters, page)}
          />
        </>
      )}
    </div>
  );
}
