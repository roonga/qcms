import type { Metadata } from "next";

import { ArchivePanel } from "@/components/membership/archive-panel";
import {
  loadWorkspaceScreen,
  workspaceSectionTitle,
  WorkspaceScreenFrame,
} from "@/components/membership/workspace-screen";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";

import { archiveWorkspaceAction } from "../actions";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ workspaceId: string }>;
}): Promise<Metadata> {
  const { workspaceId } = await params;
  return pageMetadata(await workspaceSectionTitle("archive", workspaceId));
}

export default async function ArchiveWorkspacePage({
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
          {t("membership.archive.heading")}
        </h1>
      ) : (
        <ArchivePanel
          workspaceId={workspaceId}
          name={workspace.name}
          forms={workspace.forms}
          isShared={workspace.isShared}
          archived={workspace.archivedAt !== null}
          archive={archiveWorkspaceAction}
        />
      )}
    </WorkspaceScreenFrame>
  );
}
