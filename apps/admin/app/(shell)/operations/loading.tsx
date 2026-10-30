import { t } from "@/lib/i18n/en";

/**
 * What stands in while the discovery read is in flight, so a slow read is distinct from an
 * empty installation and from a failed one. The heading is the page's own, because the
 * heading never changes with what the table is showing.
 */
export default function OperationsLoading() {
  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="qcms-operations-loading">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">
          {t("shell.mode.operations.name")}
        </h1>
        <p className="text-sm text-(--color-text-muted)">{t("operations.intro")}</p>
      </div>
      <p className="text-sm text-(--color-text-muted)" role="status">
        {t("operations.loading")}
      </p>
    </div>
  );
}
