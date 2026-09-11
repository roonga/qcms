"use client";

import { announce } from "@/lib/announce";
import { type EntityIdKind } from "@/lib/entity-id";
import { t } from "@/lib/i18n/en";

/**
 * The copy control `plan/admin-design-contracts.md` §2 requires of an identifying column.
 *
 * Lifted, unchanged in behaviour and in looks, out of `components/forms/step-editor.tsx`,
 * where issue #572's pin row was the first column to grow one. It is its own module rather
 * than part of `components/entity-id.tsx` so that the id itself stays renderable from a
 * server component: this half needs a click handler and the clipboard, and the other half
 * needs neither.
 *
 * ## What the accessible name carries
 *
 * The entity and the value, never a bare "Copy" repeated down the column - the clause is
 * §2's and the reason is that a screen-reader user moving through a column of controls
 * hears the name and nothing else. The value it names is the value **on screen**, which
 * for an opaque id is the abbreviation (§2's own example is "Copy session id
 * ses_45cf6345"). What reaches the clipboard is always the whole id: the control exists
 * because the abbreviation is not a value anyone can paste.
 *
 * ## A button, not an anchor, and never inside one
 *
 * It does something rather than going somewhere, so §2's 2026-08-22 amendment applies and
 * it takes a `<button>`. Where the identifying cell also carries a row anchor, this sits
 * BESIDE the anchor rather than inside it - interactive content cannot nest - which is
 * what `EntityId` composes for its callers.
 *
 * ## JS-only, and the dependency §2 asks to keep visible
 *
 * A clipboard write needs script. §2 accepts that **because** the full id is reachable
 * without it: the detail routes head themselves with their own entity's whole id since
 * #510, and for the two tables with no detail route at all (links, webhooks) the whole
 * value is in the cell's own server-rendered markup - see `components/entity-id.tsx`.
 * Neither of those may become conditional on JavaScript.
 */
export function CopyEntityId({
  kind,
  value,
  display,
}: {
  readonly kind: EntityIdKind;
  readonly value: string;
  /** What the cell shows, which is what the control's name says it will copy. */
  readonly display: string;
}) {
  return (
    <button
      type="button"
      className="qcms-copyid"
      data-readonly-action="copy"
      aria-label={t(`ids.copy.${kind}`, { id: display })}
      onClick={() => {
        // The `?.` guards the whole chain, not just the property after it: optional
        // chaining short-circuits every call and member access to its right, so with no
        // `navigator.clipboard` (an insecure context, or an older engine) this expression
        // is `undefined` and `.then` is never evaluated. `void undefined` is fine.
        void navigator.clipboard?.writeText(value).then(
          () => {
            announce(t(`ids.copied.${kind}`, { id: display }));
          },
          () => {
            // A refused clipboard is not worth an error state: the value is already in
            // the cell's markup, so the operator can still select it by hand.
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
