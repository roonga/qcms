import Link from "next/link";

import { CopyEntityId } from "@/components/copy-entity-id";
import { type EntityIdKind, isOpaqueEntityKind, splitEntityId } from "@/lib/entity-id";

/**
 * The identifying cell of an admin table: one id, rendered the one way (issue #582).
 *
 * `plan/admin-design-contracts.md` §2 and its two amendments say what that way is, and
 * `lib/entity-id.ts` carries the rule that decides which of them a given kind takes. This
 * component exists so that the decision is taken once rather than per table: before it,
 * nine tables each wrote their own `<code className="qcms-link-id">{row.someId}</code>`
 * and every one of them rendered the whole value, which is what #582 is about.
 *
 * ## Where the rest of an abbreviated id goes, and why it is not dropped
 *
 * An opaque id shows its type prefix plus eight characters. The remainder is still in the
 * markup, inside `.qcms-visually-hidden`, so it costs no width and is not lost:
 *
 * - **Assistive technology reads the whole value.** The clipped span is in the
 *   accessibility tree, so the row header announces `ses_45cf6345…` in full rather than
 *   naming a row by a string that identifies nothing.
 * - **A selection copies the whole value.** Clipped text is still selected text, so
 *   dragging across the cell and pressing copy yields the id, not the abbreviation. That
 *   is the no-JavaScript half of §2's copy affordance, and it is what makes the rule
 *   satisfiable on the links and webhooks tables, which have no detail route to carry the
 *   full id the way `/responses/[sessionId]` does.
 * - **Nothing on screen looks like data that is not.** The cut is silent: no ellipsis
 *   (§2 forbids one, and the links POC's drawn `lnk_3d9b…771f` is the shape it forbids),
 *   and the abbreviation is honest because an opaque id is uniformly long.
 *
 * Rendering the tail is therefore not a trick to satisfy a text assertion. It is the
 * answer to "where does the full id live when the column may not show it", which §2 asks
 * every prefix-rendering column to have.
 *
 * ## Composition, rather than a cell that guesses
 *
 * Three shapes exist across the tables and all three are props here: an id that is the
 * row's anchor (`href`), an id beside an anchor on some other cell, and an id with a copy
 * control. The copy control is a sibling of the anchor and never a child of it, because
 * interactive content cannot nest.
 */
export function EntityId({
  kind,
  value,
  href,
  linkLabel,
  copy = isOpaqueEntityKind(kind),
  className,
}: {
  readonly kind: EntityIdKind;
  readonly value: string;
  /** Where this row goes, when the id itself is the row's anchor. */
  readonly href?: string;
  /** The anchor's accessible name, which names the destination rather than the bare id. */
  readonly linkLabel?: string;
  /**
   * Whether the cell carries a copy control. Required by §2 for an opaque id, because the
   * abbreviation is not a pasteable value; "welcome" rather than required for a derived
   * one, which is rendered whole.
   */
  readonly copy?: boolean;
  readonly className?: string;
}) {
  const { head, tail } = splitEntityId(kind, value);
  const id = (
    <code className="qcms-entityid__value">
      {head}
      {tail === "" ? null : <span className="qcms-visually-hidden">{tail}</span>}
    </code>
  );
  return (
    <span className={className === undefined ? "qcms-entityid" : `qcms-entityid ${className}`}>
      {href === undefined ? (
        id
      ) : (
        <Link className="qcms-text-link" href={href} aria-label={linkLabel}>
          {id}
        </Link>
      )}
      {copy ? <CopyEntityId kind={kind} value={value} display={head} /> : null}
    </span>
  );
}
