import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AccountMenu } from "@/components/account-menu";
import {
  AssistantButtonSlot,
  AssistantPanelSlot,
  AssistantProvider,
} from "@/components/agent/assistant-dock";
import { Announcer } from "@/components/announcer";
import { EnvironmentChip, EnvironmentSlot } from "@/components/environment-chip";
import { EnvironmentScope } from "@/components/environment-scope";
import { EnvironmentSwitcher } from "@/components/environment-switcher";
import { MeasuredMain } from "@/components/measured-main";
import { ShellChrome } from "@/components/shell/shell-chrome";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { RailToggle, SidebarProvider } from "@/components/sidebar-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopbarHeight } from "@/components/topbar-height";
import { MODE_COOKIE, parseAppearance } from "@/lib/appearance";
import { secureCookies } from "@/lib/server/config";
import { resolvedEnvironment } from "@/lib/server/environments";
import { t } from "@/lib/i18n/en";
import { navigableCapabilities, rememberedMode, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { currentWorkspaceContext } from "@/lib/server/workspace-context";
import { offersWorkspaceChoice } from "@/lib/shell/workspace-context";
import { PANEL_COOKIE, parsePanelState, type PanelState } from "@/lib/agent/panel";
import { agentAuthoringEnabled } from "@/lib/server/agent";
import { SIDEBAR_COOKIE, parseSidebarSetting } from "@/lib/sidebar";

/* This layout guards pages only. Route handlers and server actions must authenticate independently. */
export default async function ShellLayout({
  children,
  rail,
}: {
  readonly children: ReactNode;
  /* Every route needs a rail-slot match: Next retains the prior slot on soft navigation when no page
     matches. */
  readonly rail: ReactNode;
}) {
  const session = await requireAdminSession();
  const cookieStore = await cookies();
  const appearance = parseAppearance(cookieStore.get(MODE_COOKIE)?.value);
  const accessPromise = shellAccess(session);
  // Resolve selection once for chrome and API headers. A failed environment read stays unknown and disables
  // environment-sensitive actions.
  const [access, resolved, workspaces] = await Promise.all([
    accessPromise,
    resolvedEnvironment(session),
    currentWorkspaceContext(session),
  ]);
  const capabilities = navigableCapabilities(access);
  const sidebar = parseSidebarSetting(cookieStore.get(SIDEBAR_COOKIE)?.value);
  const assistant = agentAuthoringEnabled();
  const panel = parsePanelState(cookieStore.get(PANEL_COOKIE)?.value);

  return (
    <SidebarProvider setting={sidebar} secureCookies={secureCookies()}>
      <AssistantShell
        enabled={assistant}
        initial={panel}
        secureCookies={secureCookies()}
        userId={session.userId}
        environment={resolved.status === "known" ? resolved.environment : ""}
      >
        <div className="flex min-h-dvh flex-col">
          {/* Keep the live region outside revalidated pages so unmounting cannot interrupt announcements. */}
          <Announcer />
          {/* Measure the topbar so scroll padding keeps focused controls below its full sticky height. */}
          <TopbarHeight />
          <header className="qcms-topbar">
            <div className="qcms-topbar__inner">
              <div className="qcms-topbar__toggle">
                <RailToggle />
              </div>
              <span className="qcms-wordmark">{t("app.title")}</span>
              {offersWorkspaceChoice(workspaces) && workspaces.current !== undefined && (
                <WorkspaceSwitcher
                  choices={workspaces.choices}
                  current={workspaces.current}
                  secureCookies={secureCookies()}
                />
              )}
              <ShellChrome
                capabilities={capabilities}
                multipleWorkspaces={offersWorkspaceChoice(workspaces)}
                rememberedMode={rememberedMode(cookieStore)}
                secureCookies={secureCookies()}
                environmentName={resolved.status === "known" ? resolved.environment : ""}
                environment={
                  resolved.status === "known" ? (
                    <EnvironmentSwitcher
                      environments={resolved.environments}
                      selected={resolved.environment}
                      secureCookies={secureCookies()}
                    />
                  ) : (
                    <EnvironmentSlot environment={undefined}>
                      <EnvironmentChip environment={undefined} />
                    </EnvironmentSlot>
                  )
                }
                trailing={
                  <>
                    {assistant && <AssistantButtonSlot />}
                    <ThemeToggle appearance={appearance} secureCookies={secureCookies()} />
                    <AccountMenu email={session.email} name={session.name} />
                  </>
                }
              />
            </div>
          </header>
          <EnvironmentScope selection={resolved.selection} unknown={resolved.status === "unknown"}>
            <div className="qcms-shell-body">
              {rail}
              <MeasuredMain>{children}</MeasuredMain>
              {assistant && <AssistantPanelSlot />}
            </div>
          </EnvironmentScope>
        </div>
      </AssistantShell>
    </SidebarProvider>
  );
}

function AssistantShell({
  enabled,
  initial,
  secureCookies,
  userId,
  environment,
  children,
}: {
  readonly enabled: boolean;
  readonly initial: PanelState;
  readonly secureCookies: boolean;
  readonly userId: string;
  readonly environment: string;
  readonly children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <AssistantProvider
      initial={initial}
      secureCookies={secureCookies}
      userId={userId}
      environment={environment}
    >
      {children}
    </AssistantProvider>
  );
}
