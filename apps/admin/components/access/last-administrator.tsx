"use client";

import Link from "next/link";
import { Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import type { AccessCapabilities } from "@/lib/membership/access-patterns";

/** Remove a Workspace administrator, or demote a Site administrator; disabled with the reason while they are the last one. */
export function AdministratorRemoval({
  scope,
  person,
  workspace,
  isLast,
  capabilities,
  appointHref,
  pending = false,
  onPress,
}: {
  readonly scope: "workspace" | "site";
  readonly person: string;
  /** The workspace's name; read only for the workspace scope. */
  readonly workspace?: string;
  readonly isLast: boolean;
  readonly capabilities: AccessCapabilities;
  readonly appointHref?: string;
  readonly pending?: boolean;
  readonly onPress: () => void;
}) {
  const allowed = capabilities.has(
    scope === "workspace" ? "administrators.manage" : "siteAdministrators.manage",
  );
  if (!allowed) return null;

  const visible =
    scope === "workspace" ? t("access.lastAdmin.remove") : t("access.lastAdmin.demote");
  const named =
    scope === "workspace"
      ? t("access.lastAdmin.removeFor", { person })
      : t("access.lastAdmin.demoteFor", { person });

  return (
    <div
      className="flex min-w-0 flex-col items-start gap-1"
      data-testid="qcms-administrator-removal"
    >
      <Button variant="danger" size="md" isDisabled={isLast || pending} onPress={onPress}>
        <span aria-hidden="true">{visible}</span>
        <span className="qcms-visually-hidden">{named}</span>
      </Button>
      {isLast && (
        <>
          <p className="text-sm text-(--color-text-muted)">
            {scope === "workspace"
              ? t("access.lastAdmin.workspace", { person, workspace: workspace ?? "" })
              : t("access.lastAdmin.site", { person })}
          </p>
          {appointHref !== undefined && (
            <Link href={appointHref} className="qcms-text-link text-sm">
              {scope === "workspace"
                ? t("access.lastAdmin.appointWorkspace")
                : t("access.lastAdmin.appointSite")}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
