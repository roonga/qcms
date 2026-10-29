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
  type ShellCapabilities,
  type ShellMode,
} from "@/lib/shell/modes";

/**
 * The topbar's middle: the application navigation in normal mode, and a focused mode's own
 * header in place of it.
 *
 * A client component for the reason `AdminNav` is one: the mode is a fact about the route
 * and a layout is never told which child rendered. `usePathname` resolves during server
 * rendering too, so the first HTML already carries the right header rather than swapping
 * one in on hydration.
 */
export function ShellChrome({
  capabilities,
  rememberedMode,
  secureCookies,
  trailing,
}: {
  readonly capabilities: ShellCapabilities;
  /** Which focused mode the shell was last in, so a personal route can stay inside it. */
  readonly rememberedMode: ShellMode | undefined;
  readonly secureCookies: boolean;
  readonly trailing: ReactNode;
}) {
  const pathname = usePathname();
  const focused = focusedMode(modeForPath(pathname, rememberedMode));

  // Written here rather than by the server, because a layout may not set a cookie during
  // render. The next request then resolves a personal route into the mode it was opened
  // from without this component having to run again.
  useEffect(() => {
    if (focused === undefined) return;
    document.cookie = shellModeCookie(focused, secureCookies);
  }, [focused, secureCookies]);

  return (
    <>
      <div className="min-w-0 flex-1 basis-40">
        {focused === undefined ? (
          <AdminNav capabilities={capabilities} />
        ) : (
          <ModeHeader mode={focused} capabilities={capabilities} />
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-x-2">{trailing}</div>
      {/* The mode is also stated once for a screen reader, since a header swapping for a
          navigation is a change of place rather than of styling. */}
      <span className="qcms-visually-hidden" role="status" data-testid="qcms-shell-mode-status">
        {focused === undefined ? "" : t(`shell.mode.${focused}.announce`)}
      </span>
    </>
  );
}

/**
 * Remembers which workspace the Workspaces mode was on, so re-entering it returns there
 * while the caller still administers it.
 */
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
