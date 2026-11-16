"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { AdminNav } from "@/components/admin-nav";
import { LeaveOperationsGuard } from "@/components/shell/leave-operations-guard";
import {
  BUILDER_RETURN_KEY,
  builderExitHref,
  rememberedBuilderReturn,
} from "@/lib/forms/build-return";
import { t } from "@/lib/i18n/en";
import { shellModeCookie, shellWorkspaceCookie } from "@/lib/shell/context";
import {
  LEAVE_EXEMPT_ATTRIBUTE,
  OPERATIONS_RETURN_KEY,
  operationsExitHref,
  rememberedReturn,
} from "@/lib/shell/leave-operations";
import {
  builderSubjectName,
  serverBuilderSubjectName,
  subscribeBuilderSubject,
} from "@/lib/shell/builder-subject";
import {
  builderSubject,
  exitMode,
  focusedModeForPath,
  landingPathForMode,
  OPERATIONS_PATH,
  rememberableMode,
  type ShellCapabilities,
  type ShellMode,
} from "@/lib/shell/modes";

/**
 * The top bar after the wordmark: the application navigation, where Operations becomes one group
 * of title, environment and Exit, then the trailing tools.
 */
export function ShellChrome({
  capabilities,
  rememberedMode,
  secureCookies,
  environment,
  environmentName,
  trailing,
  multipleWorkspaces,
}: {
  readonly capabilities: ShellCapabilities;
  readonly rememberedMode: ShellMode | undefined;
  readonly secureCookies: boolean;
  readonly environment: ReactNode;
  /** The selected environment's name, empty when it is unknown. */
  readonly environmentName: string;
  readonly trailing: ReactNode;
  /** Whether this caller may open more than one workspace, which decides the area's name. */
  readonly multipleWorkspaces: boolean;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const focused = focusedModeForPath(pathname, rememberedMode);
  const inOperations = focused === "operations";
  const cameFrom = useOperationsReturn(pathname, search, inOperations);
  const builderCameFrom = useBuilderReturn(pathname, search, focused === "builder");

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
        {focused === "builder" ? (
          <BuilderGroup pathname={pathname} cameFrom={builderCameFrom} />
        ) : (
        <AdminNav
          capabilities={capabilities}
          multipleWorkspaces={multipleWorkspaces}
          operationsGroup={
            inOperations ? (
              <div
                className="qcms-opsbar"
                role="group"
                aria-label={t("nav.operations")}
                data-testid="qcms-mode-header"
                data-mode="operations"
              >
                <Link href={OPERATIONS_PATH} aria-current="page" className="qcms-opsbar__title">
                  {t("nav.operations")}
                </Link>
                {environment}
                {exit !== undefined && (
                  <>
                    <span className="qcms-opsbar__divider" aria-hidden="true" />
                    <Link
                      href={exit}
                      className="qcms-opsbar__exit"
                      aria-label={t("shell.mode.operations.exit")}
                      data-testid="qcms-mode-exit"
                      {...{ [LEAVE_EXEMPT_ATTRIBUTE]: "" }}
                    >
                      {t("shell.mode.operations.exitText")}
                    </Link>
                  </>
                )}
              </div>
            ) : undefined
          }
        />
        )}
      </div>
      <div className="qcms-topbar__tools">{trailing}</div>
      {inOperations && (
        <LeaveOperationsGuard
          environment={environmentName}
          multipleWorkspaces={multipleWorkspaces}
        />
      )}
      <span className="qcms-visually-hidden" role="status" data-testid="qcms-shell-mode-status">
        {focused === undefined ? "" : t(`shell.mode.${focused}.announce`)}
      </span>
    </>
  );
}

function BuilderGroup({
  pathname,
  cameFrom,
}: {
  readonly pathname: string;
  readonly cameFrom: string | null;
}) {
  const formId = builderSubject(pathname) ?? null;
  const named = useSyncExternalStore(
    subscribeBuilderSubject,
    builderSubjectName,
    serverBuilderSubjectName,
  );
  const name = formId === null ? t("builder.newForm") : named;
  return (
    <div
      className="qcms-opsbar qcms-builderbar"
      role="group"
      aria-label={t("shell.mode.builder.name")}
      data-testid="qcms-mode-header"
      data-mode="builder"
    >
      <span className="qcms-opsbar__title">{t("shell.mode.builder.name")}</span>
      <span className="qcms-builderbar__subject" data-testid="qcms-builder-subject">
        {name}
      </span>
      <span className="qcms-opsbar__divider" aria-hidden="true" />
      <Link
        href={builderExitHref(formId, cameFrom)}
        className="qcms-opsbar__exit"
        aria-label={t("shell.mode.builder.exit")}
        data-testid="qcms-mode-exit"
      >
        {t("shell.mode.builder.exitText")}
      </Link>
    </div>
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

function readReturn(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Records each address outside the builder, and inside it reads back the last one for Exit. */
function useBuilderReturn(pathname: string, search: string, inBuilder: boolean): string | null {
  const [cameFrom, setCameFrom] = useState<string | null>(null);
  useEffect(() => {
    if (inBuilder) {
      setCameFrom(readReturn(BUILDER_RETURN_KEY));
      return;
    }
    const here = rememberedBuilderReturn(pathname, search === "" ? "" : `?${search}`);
    if (here === undefined) return;
    try {
      window.sessionStorage.setItem(BUILDER_RETURN_KEY, here);
    } catch {
      // Without storage Exit falls back to the form page.
    }
  }, [pathname, search, inBuilder]);
  return cameFrom;
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
      setCameFrom(readReturn(OPERATIONS_RETURN_KEY));
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
