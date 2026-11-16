import { AccessExplanation } from "@/components/access/access-explanation";
import { HelpTip } from "@/components/help-tip";
import { Alert } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { NO_ACCESS_CAPABILITIES } from "@/lib/membership/access-patterns";
import { heldGroups, isWorkspaceAdministrator } from "@/lib/membership/my-access";
import type { MyAccess, MyAccessWorkspace } from "@/lib/membership/types";

export function MyAccessPanel({
  access,
  message,
  environments,
}: {
  readonly access: MyAccess | undefined;
  readonly message: string | undefined;
  /** The explanation's columns, in the site's order. */
  readonly environments: readonly string[];
}) {
  return (
    <section aria-labelledby="qcms-my-access-heading" className="flex min-w-0 flex-col gap-3">
      <div className="qcms-help-head">
        <h2 id="qcms-my-access-heading" className="text-lg font-semibold text-(--color-text)">
          {t("membership.mine.heading")}
        </h2>
        <HelpTip>{t("membership.mine.intro")}</HelpTip>
      </div>

      {access === undefined && (
        <Alert variant="error">{t("membership.mine.loadFailed", { message: message ?? "" })}</Alert>
      )}

      {access?.installationAdmin === true && (
        <Alert variant="info">{t("membership.mine.installationAdmin")}</Alert>
      )}

      {access !== undefined &&
        (access.workspaces.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.mine.none")}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {access.workspaces.map((workspace) => (
              <li key={workspace.workspaceId} className="min-w-0">
                <WorkspaceAccess workspace={workspace} environments={environments} />
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function WorkspaceAccess({
  workspace,
  environments,
}: {
  readonly workspace: MyAccessWorkspace;
  readonly environments: readonly string[];
}) {
  const headingId = `qcms-my-access-${workspace.workspaceId}`;
  return (
    <section
      aria-labelledby={headingId}
      className="qcms-card flex min-w-0 flex-col gap-2 p-4"
      data-testid="qcms-my-access-workspace"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-base font-semibold text-(--color-text)">
          {workspace.name}
        </h3>
        {workspace.archived && (
          <span className="text-xs text-(--color-text-muted)">{t("membership.mine.archived")}</span>
        )}
        <p className="text-sm sm:ml-auto">
          {isWorkspaceAdministrator(workspace)
            ? t("membership.mine.administrator.yes")
            : t("membership.mine.administrator.no")}
        </p>
      </div>
      {workspace.grants.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">
          {t("membership.mine.noAccessIn", { workspace: workspace.name })}
        </p>
      ) : (
        <>
          <p className="text-sm">
            {t("membership.mine.groups", {
              groups: workspace.grants.map((grant) => grant.name).join(", "),
            })}
          </p>
          <AccessExplanation
            caption={t("access.explain.titleSelf", { workspace: workspace.name })}
            groups={heldGroups(workspace, environments)}
            environments={environments}
            capabilities={NO_ACCESS_CAPABILITIES}
          />
        </>
      )}
    </section>
  );
}
