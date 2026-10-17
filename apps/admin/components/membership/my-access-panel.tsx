import { Alert } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import type { MyAccess } from "@/lib/membership/types";

/**
 * What the signed-in administrator holds (Q35, task 069).
 *
 * The one membership read everybody gets, and the reason it exists: the membership list of
 * a workspace is its owners' to see, so an administrator who is not an owner learns what
 * **they** hold here rather than by reading a list that is information about another
 * department.
 *
 * A server component with no interaction, because there is nothing to do on it: a grant is
 * not something its holder changes.
 *
 * **The installation claim is stated rather than implied**, and what it says is what it
 * grants: administration everywhere, and no response read, export or erasure anywhere.
 * An administrator who has that claim and finds a response screen refused should be able
 * to read why on the same screen that tells them what they hold.
 */
export function MyAccessPanel({
  access,
  message,
}: {
  readonly access: MyAccess | undefined;
  readonly message: string | undefined;
}) {
  return (
    <section aria-labelledby="qcms-my-access-heading" className="flex flex-col gap-3">
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
          <ul className="flex flex-col gap-3">
            {access.workspaces.map((workspace) => (
              <li key={workspace.workspaceId} className="flex flex-col gap-1">
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
                      <li key={grant.name} className="text-xs text-(--color-text-muted)">
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
