import Link from "next/link";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";
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
}: {
  readonly mode: FocusedShellMode;
  readonly capabilities: ShellCapabilities;
  readonly environment?: ReactNode;
}) {
  const leavingFor = exitMode(mode, capabilities);
  const exit = leavingFor === undefined ? undefined : landingPathForMode(leavingFor);

  return (
    <div className="qcms-modeheader" data-testid="qcms-mode-header" data-mode={mode}>
      <span className="qcms-modeheader__name">{t(`shell.mode.${mode}.name`)}</span>
      {mode === "operations" && environment}
      {exit !== undefined && (
        <Link href={exit} className="qcms-modeheader__exit" data-testid="qcms-mode-exit">
          {t(`shell.mode.${mode}.exit`)}
        </Link>
      )}
    </div>
  );
}
