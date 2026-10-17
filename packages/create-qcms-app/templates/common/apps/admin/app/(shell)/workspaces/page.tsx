import Link from "next/link";
import type { Metadata } from "next";

import { Alert } from "@/components/kit";
import { MyAccessPanel } from "@/components/membership/my-access-panel";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { listWorkspaces, readMyAccess } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

/** The browser-tab title for this route (issue #536). */
export function generateMetadata(): Metadata {
  return pageMetadata(t("membership.area.title"));
}

/**
 * The workspaces an administrator administers, and their own access (ADR-41, task 069).
 *
 * # Two panels, and the second is the one everybody gets
 *
 * The **list** is narrowed by the API to the workspaces the caller holds `workspace: read`
 * in - which is the ones they own (Q35) - and to every workspace for the installation
 * administrator. An authoring grant holder administers none, so their list is empty, and
 * the empty state says so rather than implying the installation has no workspace.
 *
 * The **access panel** is the answer they do get: everybody reads their own grants,
 * because the membership list of a workspace is its owners' to see. "An administrator does
 * not need to see who else can read a form in order to do their own job, and in a
 * deployment where departments share an installation the membership list is itself
 * information about another department."
 *
 * # What this screen does not do
 *
 * It does not create a workspace, mark the shared one, or archive one. Those three are the
 * installation administrator's acts across every workspace and are performed through the
 * API; a screen for them would be a fourth thing this task's plan does not have. What is
 * here is the membership and the access groups, which is what the plan names.
 */
export default async function WorkspacesPage() {
  const session = await requireAdminSession();
  const [workspaces, mine] = await Promise.all([listWorkspaces(session), readMyAccess(session)]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("membership.area.title")}</h1>
        <p className="text-sm text-(--color-text-muted)">{t("membership.area.intro")}</p>
      </div>

      {!workspaces.ok && (
        <Alert variant="error">
          {t("membership.area.loadFailed", { message: workspaces.message })}
        </Alert>
      )}

      {/*
       * Three states rather than two: a failed read renders no list and no empty state,
       * because the alert above already carries the message and "you administer no
       * workspace" would claim knowledge a failed read does not have.
       */}
      {workspaces.ok &&
        (workspaces.data.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.area.noWorkspaces")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {workspaces.data.map((workspace) => (
              <li key={workspace.workspaceId} className="flex flex-col gap-1">
                <Link
                  href={`/workspaces/${workspace.workspaceId}`}
                  className="text-sm font-medium text-(--color-link) underline"
                >
                  {workspace.name}
                </Link>
                <p className="text-xs text-(--color-text-muted)">
                  {workspace.slug}
                  {" - "}
                  {t("membership.area.counts", {
                    forms: workspace.forms,
                    questions: workspace.questions,
                  })}
                  {workspace.isShared ? ` - ${t("membership.area.shared")}` : ""}
                  {workspace.requireSecondApprover ? ` - ${t("membership.area.twoPerson")}` : ""}
                  {workspace.archivedAt === null ? "" : ` - ${t("membership.area.archived")}`}
                </p>
              </li>
            ))}
          </ul>
        ))}

      <MyAccessPanel
        access={mine.ok ? mine.data : undefined}
        message={mine.ok ? undefined : mine.message}
      />
    </div>
  );
}
