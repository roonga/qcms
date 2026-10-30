import Link from "next/link";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n/en";
import {
  exitMode,
  landingPathForMode,
  type FocusedShellMode,
  type ShellCapabilities,
} from "@/lib/shell/modes";

/**
 * A focused mode's own header, in place of the application navigation.
 *
 * The normal menus are absent rather than disabled: a focused mode must never reveal
 * navigation the caller cannot use, and a disabled menu still names the areas.
 *
 * Operations is the only mode with an environment, so it is the only header that carries
 * the chip: Normal mode has no environment context at all, and an indicator on a screen
 * whose reads are environment-agnostic would be a claim the screen cannot support.
 */
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
      {/* No Exit for a caller with nowhere else: a link back to an area they do not hold
          would name it and then refuse. */}
      {exit !== undefined && (
        <Link href={exit} className="qcms-modeheader__exit" data-testid="qcms-mode-exit">
          {t(`shell.mode.${mode}.exit`)}
        </Link>
      )}
    </div>
  );
}
