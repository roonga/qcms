import { linkStateKey } from "@/lib/forms/links";
import type { LinkState } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

export function LinkStateTag({ state }: { readonly state: LinkState }) {
  return (
    <span className={`qcms-tag qcms-tag--link-${state}`} data-state={state}>
      {t(linkStateKey(state))}
    </span>
  );
}
