"use client";

import { announce } from "@/lib/announce";
import { type EntityIdKind } from "@/lib/entity-id";
import { t } from "@/lib/i18n/en";

/* Copy the whole id, and name the entity and value so controls remain distinguishable down a column. */
export function CopyEntityId({
  kind,
  value,
  display,
}: {
  readonly kind: EntityIdKind;
  readonly value: string;
  readonly display: string;
}) {
  return (
    <button
      type="button"
      className="qcms-iconbutton qcms-iconbutton--sm qcms-copyid"
      data-readonly-action="copy"
      aria-label={t(`ids.copy.${kind}`, { id: display })}
      onClick={() => {
        // Optional chaining must cover the whole call chain because clipboard is absent in insecure contexts.
        void navigator.clipboard?.writeText(value).then(
          () => {
            announce(t(`ids.copied.${kind}`, { id: display }));
          },
          () => {
            // Copy is optional: the full value remains selectable in the cell if the clipboard refuses.
          },
        );
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </svg>
    </button>
  );
}
