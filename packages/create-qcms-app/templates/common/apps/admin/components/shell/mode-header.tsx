import Link from "next/link";

import { t } from "@/lib/i18n/en";
import { exitPath, type FocusedShellMode, type ShellCapabilities } from "@/lib/shell/modes";

/**
 * A focused mode's own header, in place of the application navigation.
 *
 * The normal menus are absent rather than disabled: a focused mode must never reveal
 * navigation the caller cannot use, and a disabled menu still names the areas.
 */
export function ModeHeader({
  mode,
  capabilities,
}: {
  readonly mode: FocusedShellMode;
  readonly capabilities: ShellCapabilities;
}) {
  const exit = exitPath(mode, capabilities);

  return (
    <div className="qcms-modeheader" data-testid="qcms-mode-header" data-mode={mode}>
      <span className="qcms-modeheader__name">{t(`shell.mode.${mode}.name`)}</span>
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
