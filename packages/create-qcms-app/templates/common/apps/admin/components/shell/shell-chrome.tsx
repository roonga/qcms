"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { AdminNav } from "@/components/admin-nav";
import { LeaveOperationsGuard } from "@/components/shell/leave-operations-guard";
import { t } from "@/lib/i18n/en";
import { shellModeCookie, shellWorkspaceCookie } from "@/lib/shell/context";
import {
  LEAVE_EXEMPT_ATTRIBUTE,
  OPERATIONS_RETURN_KEY,
  operationsExitHref,
  rememberedReturn,
} from "@/lib/shell/leave-operations";
import {
  exitMode,
  focusedMode,
  landingPathForMode,
  modeForPath,
  rememberableMode,
  type ShellCapabilities,
  type ShellMode,
} from "@/lib/shell/modes";

/**
 * The top bar after the wordmark, one structure in every area: the application navigation,
 * then the Exit and environment slots, which keep their size outside Operations so entering
 * it moves nothing, then the trailing tools.
 */
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
  const search = useSearchParams().toString();
  const focused = focusedMode(modeForPath(pathname, rememberedMode));
  const inOperations = focused === "operations";
  const cameFrom = useOperationsReturn(pathname, search, inOperations);

  const remember = rememberableMode(pathname, capabilities);
  useEffect(() => {
    if (remember === undefined) return;
    document.cookie = shellModeCookie(remember, secureCookies);
  }, [remember, secureCookies]);

  const leavingFor = exitMode("operations", capabilities);
  const landing = leavingFor === undefined ? undefined : landingPathForMode(leavingFor);
  const exit =
    landing === undefined || cameFrom === null
      ? landing
      : operationsExitHref(cameFrom, capabilities, landing, window.location.origin);

  return (
    <>
      <div className="qcms-topbar__nav">
        <AdminNav capabilities={capabilities} />
      </div>
      <div className="qcms-topbar__exit">
        {inOperations && exit !== undefined && (
          <Link
            href={exit}
            className="qcms-modeheader__exit"
            data-testid="qcms-mode-exit"
            {...{ [LEAVE_EXEMPT_ATTRIBUTE]: "" }}
          >
            {t("shell.mode.operations.exit")}
          </Link>
        )}
      </div>
      <div className="qcms-topbar__env">
        {inOperations && (
          <div className="qcms-modeheader" data-testid="qcms-mode-header" data-mode="operations">
            {environment}
          </div>
        )}
      </div>
      <div className="qcms-topbar__tools">{trailing}</div>
      {inOperations && <LeaveOperationsGuard environment={environmentName} />}
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

/** Records each address outside Operations, query included, and inside it reads back the last one. */
function useOperationsReturn(
  pathname: string,
  search: string,
  inOperations: boolean,
): string | null {
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  useEffect(() => {
    if (inOperations) {
      setCameFrom(readReturn());
      return;
    }
    const here = rememberedReturn(pathname, search === "" ? "" : `?${search}`);
    if (here === undefined) return;
    try {
      window.sessionStorage.setItem(OPERATIONS_RETURN_KEY, here);
    } catch {
      // Without storage Exit falls back to the other area's landing.
    }
  }, [pathname, search, inOperations]);
  return cameFrom;
}
