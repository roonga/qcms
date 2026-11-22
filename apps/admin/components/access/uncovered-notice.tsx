import Link from "next/link";

import { environmentLabel } from "@/lib/environment";
import { t } from "@/lib/i18n/en";
import { roleName } from "@/lib/membership/access-group-form";
import type { AccessCapabilities, UncoveredScope } from "@/lib/membership/access-patterns";

/** "No group covers this" for each uncovered environment and role; renders nothing when all are covered. */
export function UncoveredNotice({
  uncovered,
  capabilities,
  addHref,
}: {
  readonly uncovered: UncoveredScope;
  readonly capabilities: AccessCapabilities;
  readonly addHref?: string;
}) {
  const lines = [
    ...uncovered.environments.map((environment) =>
      t("access.uncovered.environment", { environment: environmentLabel(environment) }),
    ),
    ...uncovered.roles.map((role) => t("access.uncovered.role", { role: roleName(role) })),
  ];
  if (lines.length === 0) return null;
  const canAdd = capabilities.has("access.manage") && addHref !== undefined;

  return (
    <section
      aria-label={t("access.uncovered.label")}
      className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-(--color-warning-fg) bg-(--color-warning-subtle) px-4 py-3 text-sm text-(--color-text)"
      data-testid="qcms-uncovered-notice"
    >
      <ul className="min-w-0 flex-1">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {canAdd && (
        <Link href={addHref} className="qcms-text-link">
          {t("access.uncovered.add")}
        </Link>
      )}
    </section>
  );
}
