import { WorkspacesRail } from "@/components/membership/workspaces-rail";
import type { WorkspaceSection } from "@/lib/membership/sections";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceContext } from "@/lib/server/workspace-context";
import { offersWorkspaceChoice } from "@/lib/shell/workspace-context";

/** The Workspaces rail for any screen of the area: the sections of the workspace the address names, or of the current one. */
export async function WorkspacesRailSlot({
  selected,
}: {
  readonly selected?: { readonly workspaceId: string; readonly section: WorkspaceSection };
}) {
  const session = await requireAdminSession();
  const context = await currentWorkspaceContext(session);
  const workspaceId = selected?.workspaceId ?? context.current?.workspaceId;
  const found = context.choices.find((entry) => entry.workspaceId === workspaceId);
  return (
    <WorkspacesRail
      multiple={offersWorkspaceChoice(context)}
      {...(found === undefined ? {} : { workspace: found })}
      {...(selected === undefined ? {} : { section: selected.section })}
    />
  );
}
