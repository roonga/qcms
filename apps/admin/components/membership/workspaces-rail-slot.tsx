import { WorkspacesRail } from "@/components/membership/workspaces-rail";
import type { WorkspaceSection } from "@/lib/membership/sections";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceId } from "@/lib/server/workspace-context";

/** The Workspaces rail for any screen of the area: the sections of the workspace the address names, or of the current one. */
export async function WorkspacesRailSlot({
  selected,
}: {
  readonly selected?: { readonly workspaceId: string; readonly section: WorkspaceSection };
}) {
  const session = await requireAdminSession();
  const [workspaces, current] = await Promise.all([
    listWorkspaces(session),
    currentWorkspaceId(session),
  ]);
  const workspaceId = selected?.workspaceId ?? current;
  const found = workspaces.ok
    ? workspaces.data.find((entry) => entry.workspaceId === workspaceId)
    : undefined;
  return (
    <WorkspacesRail
      {...(found === undefined
        ? {}
        : { workspace: { workspaceId: found.workspaceId, name: found.name } })}
      {...(selected === undefined ? {} : { section: selected.section })}
    />
  );
}
