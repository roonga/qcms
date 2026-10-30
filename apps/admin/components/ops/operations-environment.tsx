import Link from "next/link";

import { t } from "@/lib/i18n/en";
import { operationsEnvironmentHref, type OperationsListState } from "@/lib/ops/operations-forms";

/**
 * Operations' explicit environment selector.
 *
 * Links rather than a control, because the environment is part of the address: the table
 * below reads it, a bookmark carries it and browser back restores it. It sits above the
 * filters and is not one of them, so choosing an environment resets pagination while a
 * filter never touches the environment.
 */
export function OperationsEnvironment({
  environments,
  selected,
  state,
}: {
  readonly environments: readonly string[];
  readonly selected: string;
  readonly state: OperationsListState;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
      data-testid="qcms-operations-environment"
      data-environment={selected}
    >
      <span
        id="qcms-operations-environment-legend"
        className="text-sm font-medium text-(--color-text)"
      >
        {t("operations.environment.legend")}
      </span>
      <ul
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
        aria-labelledby="qcms-operations-environment-legend"
      >
        {environments.map((environment) => (
          <li key={environment}>
            <Link
              href={operationsEnvironmentHref(state, environment)}
              className="qcms-text-link"
              data-environment-option={environment}
              aria-label={t("operations.environment.choose", { environment })}
              {...(environment === selected ? { "aria-current": "true" as const } : {})}
            >
              {environment}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
