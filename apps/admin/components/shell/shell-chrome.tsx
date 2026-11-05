"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AdminNav } from "@/components/admin-nav";
import { LeaveOperationsGuard } from "@/components/shell/leave-operations-guard";
import { ModeHeader } from "@/components/shell/mode-header";
import { t } from "@/lib/i18n/en";
import { shellModeCookie, shellWorkspaceCookie } from "@/lib/shell/context";
import {
  OPERATIONS_RETURN_KEY,
  operationsExitHref,
  rememberedReturn,
} from "@/lib/shell/leave-operations";
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
  environmentName,
  trailing,
}: {
  readonly capabilities: ShellCapabilities;
  readonly rememberedMode: ShellMode | undefined;
  readonly secureCookies: boolean;
  readonly environment: ReactNode;
  /** The selected environment's name, empty when it is unknown. */
  readonly environmentName: string;
  readonly trailing: ReactNode;
}) {
  const pathname = usePathname();
  const focused = focusedMode(modeForPath(pathname, rememberedMode));
  const cameFrom = useOperationsReturn(pathname, focused === "operations");
  const exitHref = useCallback(
    (fallback: string) => operationsExitHref(cameFrom, capabilities, fallback),
    [cameFrom, capabilities],
  );
  const exitOverride = focused === "operations" ? { exitHref } : {};

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
          <ModeHeader
            mode={focused}
            capabilities={capabilities}
            environment={environment}
            {...exitOverride}
          />
        )}
        {focused === "operations" && <LeaveOperationsGuard environment={environmentName} />}
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

function readReturn(): string | null {
  try {
    return window.sessionStorage.getItem(OPERATIONS_RETURN_KEY);
  } catch {
    return null;
  }
}

/** Records each address outside Operations and, inside it, reads back the last one. */
function useOperationsReturn(pathname: string, inOperations: boolean): string | null {
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  useEffect(() => {
    if (inOperations) {
      setCameFrom(readReturn());
      return;
    }
    const here = rememberedReturn(pathname, window.location.search);
    if (here === undefined) return;
    try {
      window.sessionStorage.setItem(OPERATIONS_RETURN_KEY, here);
    } catch {
      // Without storage Exit falls back to the other area's landing.
    }
  }, [pathname, inOperations]);
  return cameFrom;
}
