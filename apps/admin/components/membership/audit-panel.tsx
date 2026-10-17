import { EntityId } from "@/components/entity-id";
import { Alert } from "@/components/kit";
import { OperatorDateTime } from "@/components/operator-time";
import { t } from "@/lib/i18n/en";
import type { AuditPage } from "@/lib/membership/types";

/**
 * The access audit for one workspace (SEC-15, task 069).
 *
 * Readable by the workspace's **owners** and by the installation administrator, and by
 * nobody else - that readership is the point, because an audit only the operator can see
 * does not answer a department's own question about its own data. The API's grant check is
 * what enforces it; a refused read arrives here as a message rather than as an empty
 * table, because an empty table would say "nothing happened".
 *
 * **It carries no answer value, no respondent identifier and no question text**, and the
 * screen could not render one if it wanted to: the row records the act and not its subject
 * matter, which is the reasoning ADR-17's tombstone uses one table over.
 *
 * The actor is an account id with **no foreign key** to the account, deliberately: an
 * audit row that cascades away with what it describes is not an audit row. So a row whose
 * account has since been removed shows the id, and the catalog has a sentence for exactly
 * that rather than rendering a blank cell.
 */
export function AuditPanel({
  audit,
  message,
}: {
  readonly audit: AuditPage | undefined;
  readonly message: string | undefined;
}) {
  return (
    <section aria-labelledby="qcms-audit-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="qcms-audit-heading" className="text-lg font-semibold text-(--color-text)">
          {t("membership.audit.heading")}
        </h2>
        <p className="text-sm text-(--color-text-muted)">{t("membership.audit.intro")}</p>
      </div>

      {audit === undefined && (
        <Alert variant="error">
          {t("membership.audit.loadFailed", { message: message ?? "" })}
        </Alert>
      )}

      {audit !== undefined &&
        (audit.rows.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">{t("membership.audit.none")}</p>
        ) : (
          <>
            <p className="text-xs text-(--color-text-muted)">
              {t("membership.audit.total", { total: audit.total })}
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-(--color-text-muted)">
                  <th scope="col">{t("membership.audit.columnWhen")}</th>
                  <th scope="col">{t("membership.audit.columnActor")}</th>
                  <th scope="col">{t("membership.audit.columnKind")}</th>
                  <th scope="col">{t("membership.audit.columnEnvironment")}</th>
                  <th scope="col">{t("membership.audit.columnForm")}</th>
                  <th scope="col">{t("membership.audit.columnDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {audit.rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td>
                      <OperatorDateTime iso={row.occurredAt} />
                    </td>
                    <td>
                      {row.actorEmail ?? t("membership.audit.unknownActor", { actor: row.actor })}
                    </td>
                    <td>{row.kind}</td>
                    <td>{row.environment ?? t("membership.audit.empty")}</td>
                    <td>
                      {row.formId === null ? (
                        t("membership.audit.empty")
                      ) : (
                        // §2's one id rendering, through the shared component: a form id
                        // is derived from a slug, so it renders whole, and a cell that
                        // printed it as text would be the tenth table deciding for
                        // itself.
                        <EntityId kind="form" value={row.formId} />
                      )}
                    </td>
                    <td className="break-all">{row.detail ?? t("membership.audit.empty")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ))}
    </section>
  );
}
