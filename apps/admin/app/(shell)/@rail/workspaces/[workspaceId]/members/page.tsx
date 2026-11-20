import { MembersRailFilters } from "@/components/membership/members-rail-filters";
import { WorkspacesRailSlot } from "@/components/membership/workspaces-rail-slot";
import { readMemberFilters } from "@/lib/membership/people";
import { workspaceSectionHref } from "@/lib/membership/sections";
import { subViewOf } from "@/lib/membership/workspace-views";
import { listAccessGroups } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

export default async function WorkspaceSectionRailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ workspaceId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const sub = subViewOf(query);
  if (sub !== undefined) {
    return <WorkspacesRailSlot selected={{ workspaceId, section: "members" }} sub={sub} />;
  }
  // A refused read leaves the group filter out; the page answers the refusal itself.
  const groups = await listAccessGroups(await requireAdminSession(), workspaceId);
  const options = groups.ok ? groups.data.groups : [];
  return (
    <WorkspacesRailSlot
      selected={{ workspaceId, section: "members" }}
      filters={
        <MembersRailFilters
          filters={readMemberFilters(
            query,
            options.map((group) => group.teamId),
          )}
          groups={options}
          clearHref={workspaceSectionHref(workspaceId, "members")}
        />
      }
    />
  );
}
