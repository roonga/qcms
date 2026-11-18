import type { Metadata } from "next";

import { ResultPager } from "@/components/access/access-filters";
import { GrantForm } from "@/components/membership/grant-form";
import { MembersPanel } from "@/components/membership/members-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { orderedEnvironments } from "@/lib/membership/access-group-form";
import {
  WORKSPACE_ADMINISTRATION,
  membersGrantHref,
  readGrantView,
} from "@/lib/membership/workspace-views";
import {
  isLastAdministrator,
  matchesMember,
  memberFiltersQuery,
  MEMBERS_PAGE_SIZE,
  pageOf,
  peopleRows,
  readMemberFilters,
} from "@/lib/membership/people";
import { workspaceSectionHref } from "@/lib/membership/sections";
import { pageMetadata } from "@/lib/page-title";
import { appLocale } from "@/lib/server/config";
import { listEnvironments } from "@/lib/server/environments";
import { listAccessGroups, listMembers } from "@/lib/server/membership";

import {
  grantAccessGroupAction,
  reconfirmHolderAction,
  removeMemberAction,
  revokeAccessGroupAction,
  setMemberRoleAction,
} from "../actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageMetadata(await workspaceSectionTitle("members", workspaceId));
}

export default async function WorkspaceMembersPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ workspaceId: string }>;
  readonly searchParams: SearchParams;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const screen = await loadWorkspaceScreen(workspaceId);
  if (screen.kind === "denied") return screen.element;
  const [members, groups, environments] = await Promise.all([
    listMembers(screen.session, workspaceId),
    listAccessGroups(screen.session, workspaceId),
    listEnvironments(screen.session),
  ]);
  const groupList = groups.ok ? groups.data.groups : [];
  const ordered = environments.ok ? orderedEnvironments(environments.data) : [];
  const everyone = members.ok ? peopleRows(members.data, groupList) : undefined;
  const membersHref = workspaceSectionHref(workspaceId, "members");
  const workspaceName = screen.workspace?.name ?? workspaceId;
  const grant = readGrantView(
    query,
    groupList.map((group) => group.teamId),
  );

  if (grant !== undefined) {
    return (
      <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
        <GrantForm
          workspaceId={workspaceId}
          groups={groupList}
          people={everyone ?? []}
          environments={ordered}
          viewerEmail={screen.session.email}
          requireSecondApprover={screen.workspace?.requireSecondApprover === true}
          initialEmail={grant.email}
          initialGroup={grant.group}
          cancelHref={membersHref}
          newGroupHref={`${workspaceSectionHref(workspaceId, "access-groups")}?new=1`}
          grant={grantAccessGroupAction}
        />
      </WorkspaceScreenFrame>
    );
  }

  const filters = readMemberFilters(
    query,
    groupList.map((group) => group.teamId),
  );
  const matching = everyone?.filter((row) => matchesMember(row, filters));
  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={screen.workspace}>
      <MembersPanel
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        viewerId={screen.session.userId}
        people={
          matching === undefined ? undefined : pageOf(matching, filters.page, MEMBERS_PAGE_SIZE)
        }
        lastAdministrators={(everyone ?? [])
          .filter((row) => isLastAdministrator(everyone ?? [], row.userId))
          .map((row) => row.userId)}
        environments={ordered}
        capabilities={WORKSPACE_ADMINISTRATION}
        filtered={filters.activeCount > 0}
        message={members.ok ? undefined : members.message}
        grantHref={membersGrantHref(workspaceId)}
        groupsHref={workspaceSectionHref(workspaceId, "access-groups")}
        actions={{
          setRole: setMemberRoleAction,
          revoke: revokeAccessGroupAction,
          reconfirm: reconfirmHolderAction,
          removeMember: removeMemberAction,
        }}
      />
      {matching !== undefined && matching.length > 0 && (
        <ResultPager
          page={filters.page}
          pageSize={MEMBERS_PAGE_SIZE}
          total={matching.length}
          locale={appLocale()}
          pageHref={(page) => `${membersHref}${memberFiltersQuery(filters, page)}`}
        />
      )}
    </WorkspaceScreenFrame>
  );
}
