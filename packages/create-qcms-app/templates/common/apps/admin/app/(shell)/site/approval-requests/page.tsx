import type { Metadata } from "next";

import { ResultPager } from "@/components/access/access-filters";
import { EmptyState } from "@/components/empty-state";
import { HelpTip } from "@/components/help-tip";
import { Alert } from "@/components/kit";
import { ApprovalRequestsPanel } from "@/components/site/approval-requests-panel";
import { loadSiteScreen } from "@/components/site/site-screen";
import { t } from "@/lib/i18n/en";
import { heldRequests } from "@/lib/membership/approval-wording";
import { pageMetadata } from "@/lib/page-title";
import { appLocale } from "@/lib/server/config";
import { listWorkspaces } from "@/lib/server/membership";
import { accountNames } from "@/lib/server/site-names";
import { listApprovalRequests } from "@/lib/server/site-admin";
import {
  approvalRequestsHref,
  decisionControl,
  readApprovalFilters,
  requestSentence,
  type SiteApprovalRequest,
} from "@/lib/site/approvals";

import { decideSiteRequestAction, decideWorkspaceRequestAction } from "../actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("site.requests.title"));
}

function peopleOf(requests: readonly SiteApprovalRequest[]): readonly string[] {
  const ids = new Set<string>();
  for (const request of requests) {
    ids.add(request.requestedBy);
    if (request.scope === "site") ids.add(request.target);
    if (request.decidedBy !== null) ids.add(request.decidedBy);
  }
  return [...ids];
}

export default async function ApprovalRequestsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return screen.element;
  const { session } = screen;
  const filters = readApprovalFilters(await searchParams);
  const [result, workspaces] = await Promise.all([
    listApprovalRequests(session, filters),
    listWorkspaces(session),
  ]);
  const requests = result.ok ? result.data.requests : [];
  const people = await accountNames(session, peopleOf(requests));
  const workspaceNames = new Map(
    (workspaces.ok ? workspaces.data : []).map((entry) => [entry.workspaceId, entry.name]),
  );
  const names = {
    person: (id: string) => people.get(id) ?? t("membership.requests.unknownPerson", { actor: id }),
    workspace: (id: string | null) =>
      id === null ? "" : (workspaceNames.get(id) ?? t("site.requests.unknownWorkspace")),
  };
  const now = new Date();
  const held = heldRequests(requests, now);

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="qcms-approval-requests-screen">
      <div className="qcms-help-head">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("site.requests.title")}</h1>
        <HelpTip>{t("site.requests.intro")}</HelpTip>
      </div>

      {!result.ok && (
        <Alert variant="error">
          {t("membership.requests.loadFailed", { message: result.message })}
        </Alert>
      )}

      {result.ok && requests.length === 0 && (
        <EmptyState
          heading={
            filters.status === "pending" && filters.scope === undefined
              ? t("membership.requests.none")
              : t("site.requests.noneMatching")
          }
          testId="qcms-approval-requests-empty"
        />
      )}

      {/* Rendered while empty too, so the outcome of the last decision stays on screen. */}
      <ApprovalRequestsPanel
        rows={requests.map((request, index) => ({
          request,
          asked: requestSentence(request, names),
          workspace:
            request.workspaceId === null ? undefined : names.workspace(request.workspaceId),
          decidedBy: request.decidedBy === null ? "" : names.person(request.decidedBy),
          expiresInDays: held[index]?.expiresInDays ?? 0,
          control: decisionControl(request, session.userId),
        }))}
        decideSite={decideSiteRequestAction}
        decideWorkspace={decideWorkspaceRequestAction}
      />
      {result.ok && requests.length > 0 && (
        <ResultPager
          page={result.data.page}
          pageSize={result.data.pageSize}
          total={result.data.total}
          locale={appLocale()}
          pageHref={(page) => approvalRequestsHref(filters, page)}
        />
      )}
    </div>
  );
}
