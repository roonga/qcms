import type { Metadata } from "next";

import { HelpTip } from "@/components/help-tip";
import { NewWorkspaceForm } from "@/components/site/new-workspace-form";
import { loadSiteScreen } from "@/components/site/site-screen";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";

import { createWorkspaceAction } from "../../site/actions";

export function generateMetadata(): Metadata {
  return pageMetadata(t("site.workspaces.new"));
}

/** Only a Site administrator creates a workspace, so this screen sits in Site configuration. */
export default async function NewWorkspacePage() {
  const screen = await loadSiteScreen();
  if (screen.kind === "denied") return screen.element;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="qcms-help-head">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("site.workspaces.new")}</h1>
        <HelpTip>{t("site.workspaces.intro")}</HelpTip>
      </div>
      <NewWorkspaceForm create={createWorkspaceAction} viewerEmail={screen.session.email} />
    </div>
  );
}
