import type { ReactNode } from "react";

import { environmentKind } from "@/lib/environment";
import { t } from "@/lib/i18n/en";

/**
 * The environment's name as a chip. Colour carries location and the written name carries it
 * for everyone (WCAG 1.4.1), so an unread set reads as unknown rather than as production.
 */
export function EnvironmentChip({
  environment,
  decorative,
}: {
  readonly environment: string | undefined;
  /* A chip beside the same name in words repeats it, so the row's name says it once. */
  readonly decorative?: boolean;
}) {
  return (
    <span
      className="qcms-envchip"
      data-kind={environmentKind(environment)}
      {...(decorative === true && { "aria-hidden": "true" })}
    >
      {environment ?? t("environment.unknown")}
    </span>
  );
}

/** The top bar's environment slot: one label and one control, whether the set was read or not. */
export function EnvironmentSlot({
  environment,
  pending,
  children,
}: {
  readonly environment: string | undefined;
  readonly pending?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className="qcms-envswitch"
      data-testid="qcms-environment-switcher"
      data-environment={environment ?? ""}
      data-kind={environmentKind(environment)}
      data-pending={pending === true ? "true" : "false"}
    >
      <span className="qcms-envswitch__label">{t("environment.legend")}</span>
      {children}
    </div>
  );
}
