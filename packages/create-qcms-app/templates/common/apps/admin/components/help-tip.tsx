import { useId, type ReactNode } from "react";

import { t } from "@/lib/i18n/en";

/* Help that is worth keeping but not worth a line of its own: a "?" that opens on hover or focus. */
export function HelpTip({ children }: { readonly children: ReactNode }) {
  const id = useId();
  return (
    <span className="qcms-helptip">
      <button
        type="button"
        className="qcms-helptip__button"
        aria-label={t("help.label")}
        aria-describedby={id}
      >
        ?
      </button>
      <span role="tooltip" id={id} className="qcms-helptip__body">
        {children}
      </span>
    </span>
  );
}
