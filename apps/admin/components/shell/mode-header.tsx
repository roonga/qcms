import Link from "next/link";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";
import { LEAVE_EXEMPT_ATTRIBUTE } from "@/lib/shell/leave-operations";
import {
  exitMode,
  landingPathForMode,
  type FocusedShellMode,
  type ShellCapabilities,
} from "@/lib/shell/modes";

/* Omit unavailable navigation entirely; disabled menu names would still reveal areas the caller cannot
   access. */
export function ModeHeader({
  mode,
  capabilities,
  environment,
  exitHref,
}: {
  readonly mode: FocusedShellMode;
  readonly capabilities: ShellCapabilities;
  readonly environment?: ReactNode;
  /** Where Exit goes instead of the other area's landing, when the caller is known to have come from there. */
  readonly exitHref?: (fallback: string) => string;
}) {
  const leavingFor = exitMode(mode, capabilities);
  const landing = leavingFor === undefined ? undefined : landingPathForMode(leavingFor);
  const exit =
    landing === undefined || exitHref === undefined ? landing : exitHref(landing);

  return (
    <div className="qcms-modeheader" data-testid="qcms-mode-header" data-mode={mode}>
      <span className="qcms-modeheader__name">{t(`shell.mode.${mode}.name`)}</span>
      {mode === "operations" && environment}
      {exit !== undefined && (
        <Link
          href={exit}
          className="qcms-modeheader__exit"
          data-testid="qcms-mode-exit"
          {...{ [LEAVE_EXEMPT_ATTRIBUTE]: "" }}
        >
          {t(`shell.mode.${mode}.exit`)}
        </Link>
      )}
    </div>
  );
}
