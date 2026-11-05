import type { Metadata } from "next";

import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { WorkspaceSettingsPanel } from "@/components/membership/workspace-settings-panel";

import { saveWorkspaceSettingsAction } from "../actions";

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
  const { workspace } = screen;
  return (
    <WorkspaceScreenFrame workspaceId={workspaceId} workspace={workspace}>
      {workspace === undefined ? (
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("membership.settings.heading")}
        </h1>
      ) : (
        <WorkspaceSettingsPanel
          settings={{
            workspaceId,
            requireSecondApprover: workspace.requireSecondApprover,
            seedNewEditorsWithTestData: workspace.seedNewEditorsWithTestData,
          }}
          save={saveWorkspaceSettingsAction}
        />
      )}
    </WorkspaceScreenFrame>
  );
}
