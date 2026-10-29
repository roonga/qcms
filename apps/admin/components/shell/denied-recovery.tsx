import Link from "next/link";

import { t } from "@/lib/i18n/en";
import { landingPath, MY_ACCESS_PATH, type ShellCapabilities } from "@/lib/shell/modes";

/**
 * What a bookmark into an area the caller does not hold renders instead of the screen.
 *
 * It names nothing it was refused. The address already carries whatever identifier the
 * caller typed, so repeating a form or workspace NAME back is the leak: a refusal that
 * resolves an identifier to a title tells an outsider that it exists and what it is
 * called. The recovery offered is one of this caller's own areas, and My access, which
 * everybody holds.
 */
export function DeniedRecovery({ capabilities }: { readonly capabilities: ShellCapabilities }) {
  const recovery = landingPath(capabilities);

  return (
    <div className="flex flex-col gap-4" data-testid="qcms-denied-recovery">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-(--color-text)">{t("shell.denied.title")}</h1>
        <p className="text-sm text-(--color-text-muted)">{t("shell.denied.body")}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {recovery !== MY_ACCESS_PATH && (
          <li>
            <Link className="qcms-text-link" href={recovery}>
              {t("shell.denied.recover")}
            </Link>
          </li>
        )}
        <li>
          <Link className="qcms-text-link" href={MY_ACCESS_PATH}>
            {t("shell.denied.myAccess")}
          </Link>
        </li>
      </ul>
    </div>
  );
}
