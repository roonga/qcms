"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { AdminNav } from "@/components/admin-nav";
import { ModeHeader } from "@/components/shell/mode-header";
import { t } from "@/lib/i18n/en";
import { shellModeCookie, shellWorkspaceCookie } from "@/lib/shell/context";
import {
  focusedMode,
  modeForPath,
  rememberableMode,
  type ShellCapabilities,
  type ShellMode,
} from "@/lib/shell/modes";

export function ShellChrome({
  capabilities,
  rememberedMode,
  secureCookies,
  environment,
  trailing,
}: {
  readonly capabilities: ShellCapabilities;
  readonly rememberedMode: ShellMode | undefined;
  readonly secureCookies: boolean;
  readonly environment: ReactNode;
  readonly trailing: ReactNode;
}) {
  const pathname = usePathname();
  const focused = focusedMode(modeForPath(pathname, rememberedMode));

  const remember = rememberableMode(pathname, capabilities);
  useEffect(() => {
    if (remember === undefined) return;
    document.cookie = shellModeCookie(remember, secureCookies);
  }, [remember, secureCookies]);

  return (
    <>
      <div className="min-w-0 flex-1 basis-40">
        {focused === undefined ? (
          <AdminNav capabilities={capabilities} />
        ) : (
          <ModeHeader mode={focused} capabilities={capabilities} environment={environment} />
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-x-2">{trailing}</div>
      <span className="qcms-visually-hidden" role="status" data-testid="qcms-shell-mode-status">
        {focused === undefined ? "" : t(`shell.mode.${focused}.announce`)}
      </span>
    </>
  );
}

export function RememberWorkspace({
  workspaceId,
  secureCookies,
}: {
  readonly workspaceId: string;
  readonly secureCookies: boolean;
}) {
  useEffect(() => {
    document.cookie = shellWorkspaceCookie(workspaceId, secureCookies);
  }, [workspaceId, secureCookies]);
  return null;
}
