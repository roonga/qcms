import type { ReactNode } from "react";

import { WorkspacesRail } from "@/components/membership/workspaces-rail";
import type { WorkspaceSection } from "@/lib/membership/sections";
import type { WorkspaceSubView } from "@/lib/membership/workspace-views";
import { readMyAccess } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceContext } from "@/lib/server/workspace-context";
import { offersWorkspaceChoice } from "@/lib/shell/workspace-context";

/** The Workspaces rail for any screen of the area: the sections of the workspace the address names, or of the current one. */
export async function WorkspacesRailSlot({
  selected,
  sub,
  filters,
}: {
  readonly selected?: { readonly workspaceId: string; readonly section: WorkspaceSection };
  readonly sub?: WorkspaceSubView | undefined;
  readonly filters?: ReactNode;
}) {
  const session = await requireAdminSession();
  const [context, access] = await Promise.all([
    currentWorkspaceContext(session),
    readMyAccess(session),
  ]);
  const workspaceId = selected?.workspaceId ?? context.current?.workspaceId;
  const found = context.choices.find((entry) => entry.workspaceId === workspaceId);
  return (
    <WorkspacesRail
      multiple={offersWorkspaceChoice(context)}
      archivable={access.ok && access.data.multipleWorkspaces}
      {...(found === undefined ? {} : { workspace: found })}
      {...(selected === undefined ? {} : { section: selected.section })}
      sub={sub}
      {...(filters === undefined ? {} : { filters })}
    />
  );
}
