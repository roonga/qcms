import { linkStateKey } from "@/lib/forms/links";
import type { LinkState } from "@/lib/forms/types";
import { t } from "@/lib/i18n/en";

/**
 * The active / used / expired / revoked badge (task 034; screen contract "state `tag`").
 *
 * The same shape 032's `StatusTag` is, for the same reason: the kit has no tag component,
 * and this is app chrome rather than a new variant of a vendored control (ADR-22). Colours
 * come from the theme sheet's semantic tokens and nowhere else.
 *
 * **The state is always spelled out**, so colour is never the only signal (WCAG 1.4.1) and
 * the badge still works in high contrast, where the tints collapse toward the page
 * background and the border does the differentiating.
 */
export function LinkStateTag({ state }: { readonly state: LinkState }) {
  return (
    <span className={`qcms-tag qcms-tag--link-${state}`} data-state={state}>
      {t(linkStateKey(state))}
    </span>
  );
}
