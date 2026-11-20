import type { ReactElement } from "react";

import { DeniedRecovery } from "@/components/shell/denied-recovery";
import { t } from "@/lib/i18n/en";
import { listWorkspaces } from "@/lib/server/membership";
import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession, type AdminSession } from "@/lib/server/session";
import { permitsPath } from "@/lib/shell/modes";
import { SITE_PATH, type AccountStatus } from "@/lib/site/accounts";

export type SiteScreen =
  | { readonly kind: "allowed"; readonly session: AdminSession }
  | { readonly kind: "denied"; readonly element: ReactElement };

/** Site configuration is for Site administrators; anyone else gets the denied recovery, and the API refuses them regardless. */
export async function loadSiteScreen(): Promise<SiteScreen> {
  const session = await requireAdminSession();
  const capabilities = navigableCapabilities(await shellAccess(session));
  if (!permitsPath(capabilities, SITE_PATH)) {
    return { kind: "denied", element: <DeniedRecovery capabilities={capabilities} /> };
  }
  return { kind: "allowed", session };
}

/** The Shared question library row is offered at two or more workspaces. */
export async function offersSharedLibrary(session: AdminSession): Promise<boolean> {
  const workspaces = await listWorkspaces(session);
  return workspaces.ok && workspaces.data.length > 1;
}

const STATUS_TAG = {
  active: { tone: "qcms-tag qcms-tag--published", label: "access.status.active" },
  unclaimed: { tone: "qcms-tag qcms-tag--deprecated", label: "site.accounts.status.unclaimed" },
  disabled: { tone: "qcms-tag", label: "access.status.disabled" },
} as const;

export function AccountStatusTag({ status }: { readonly status: AccountStatus }) {
  const tag = STATUS_TAG[status];
  return (
    <span className={tag.tone} data-account-status={status}>
      {t(tag.label)}
    </span>
  );
}
