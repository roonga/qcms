import { Alert } from "@/components/kit";
import { t } from "@/lib/i18n/en";
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
      <div className="flex flex-col gap-1">
        <h2 id="qcms-my-access-heading" className="text-lg font-semibold text-(--color-text)">
          {t("membership.mine.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("membership.mine.intro")}</p>
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
                  <ul className="flex flex-col gap-0.5">
                    {workspace.grants.map((grant) => (
                      <li key={grant.name} className="text-xs break-all text-(--color-text-muted)">
                        {grant.name} - {grant.role} - {grant.environments.join(", ")} -{" "}
                        {grant.forms.join(", ")}
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
