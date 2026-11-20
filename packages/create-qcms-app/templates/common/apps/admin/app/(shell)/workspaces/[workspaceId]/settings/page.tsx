import type { Metadata } from "next";

import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { WorkspaceSettingsPanel } from "@/components/membership/workspace-settings-panel";
import { t } from "@/lib/i18n/en";
import { heldRequests, newestOfKind } from "@/lib/membership/approval-wording";
import { emailsById } from "@/lib/membership/audit-wording";
import { pageMetadata } from "@/lib/page-title";
import { listMembers, listWorkspaceRequests, readWorkspaceSettings } from "@/lib/server/membership";

import {
  decideWorkspaceRequestAction,
  renameWorkspaceAction,
  saveWorkspaceSettingsAction,
} from "../actions";

const SWITCH_OFF = "second-approval-off";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageMetadata(await workspaceSectionTitle("settings", workspaceId));
}

export default async function WorkspaceSettingsPage({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const screen = await loadWorkspaceScreen(workspaceId);
  if (screen.kind === "denied") return screen.element;
  const { session, workspace } = screen;
  if (workspace === undefined) {
    return (
      <WorkspaceScreenFrame workspaceId={workspaceId} workspace={workspace}>
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("membership.settings.heading")}
        </h1>
      </WorkspaceScreenFrame>
    );
  }

  const [settings, requests, members] = await Promise.all([
    readWorkspaceSettings(session, workspaceId),
    listWorkspaceRequests(session, workspaceId),
    listMembers(session, workspaceId),
  ]);
  const held = requests.ok ? heldRequests(requests.data.requests, new Date()) : [];
  const pending = held.filter((entry) => entry.request.status === "pending");

  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={workspace}>
      <WorkspaceSettingsPanel
        settings={
          settings.ok
            ? settings.data
            : {
                workspaceId,
                requireSecondApprover: workspace.requireSecondApprover === true,
                // A refused read says nothing about who could approve, so claim nothing.
                nobodyElseCouldApprove: false,
                missingApprover: { administrator: false, publisher: false },
              }
        }
        workspace={{ name: workspace.name, slug: workspace.slug }}
        viewerId={session.userId}
        people={emailsById(members.ok ? members.data : [])}
        held={newestOfKind(pending, SWITCH_OFF)}
        decided={newestOfKind(
          held.filter((entry) => entry.request.status !== "pending"),
          SWITCH_OFF,
        )}
        rename={renameWorkspaceAction}
        save={saveWorkspaceSettingsAction}
        decide={decideWorkspaceRequestAction}
      />
    </WorkspaceScreenFrame>
  );
}
