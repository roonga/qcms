import { t } from "@/lib/i18n/en";
import type { QuestionStatus } from "@/lib/questions/types";

/**
 * The draft / published / deprecated badge (task 032; screen contract "status `tag`").
 *
 * A plain span rather than a kit component, because the kit has no tag: this is app
 * chrome in the same family as the topbar and the nav underline, not a new variant of a
 * vendored control, so it carries no risk of becoming a second design language (ADR-22).
 * Its colours come from the theme sheet's semantic tokens and nowhere else.
 *
 * **The status is always spelled out.** Colour is the secondary signal, never the only
 * one (WCAG 1.4.1), which also means the same component works unchanged in high contrast
 * where the palette collapses. The screen contract's a11y note asks for exactly this.
 */
export function StatusTag({ status }: { readonly status: QuestionStatus }) {
  return (
    <span className={`qcms-tag qcms-tag--${status}`} data-status={status}>
      {t(`questions.status.${status}`)}
    </span>
  );
}
