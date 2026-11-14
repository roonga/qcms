import { HelpTip } from "@/components/help-tip";
import { Alert } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { roleDescription, roleName } from "@/lib/membership/access-group-form";
import type { MyAccess } from "@/lib/membership/types";

export function MyAccessPanel({
  access,
  message,
}: {
  readonly access: MyAccess | undefined;
  readonly message: string | undefined;
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
              <li key={workspace.workspaceId} className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-medium text-(--color-text)">
                  {workspace.name} ({workspace.slug})
                </p>
                {workspace.grants.length === 0 ? (
                  <p className="text-xs text-(--color-text-muted)">
                    {t("membership.mine.memberOnly")}
                  </p>
                ) : (
                  <ul className="flex min-w-0 flex-col gap-2">
                    {workspace.grants.map((grant) => (
                      <li key={grant.name} className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-xs font-medium text-(--color-text)">{grant.name}</p>
                        {grant.roles.map((role) => (
                          <RoleDescription key={role} role={role} />
                        ))}
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-xs break-all text-(--color-text-muted)">
                          <dt>{t("membership.groups.columnRoles")}</dt>
                          <dd>{grant.roles.map(roleName).join(", ")}</dd>
                          <dt>{t("membership.groups.columnEnvironments")}</dt>
                          <dd>
                            {grant.environments.length === 0
                              ? t("membership.groups.everyEnvironment")
                              : grant.environments.join(", ")}
                          </dd>
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-(--color-text-muted)">
                  {t("membership.mine.environments", {
                    environments: workspace.environments.join(", "),
                  })}
                </p>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function RoleDescription({ role }: { readonly role: string }) {
  const description = roleDescription(role);
  if (description === undefined) return null;
  return <p className="text-xs text-(--color-text-muted)">{description}</p>;
}
