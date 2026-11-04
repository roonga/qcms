import Link from "next/link";

import { CopyEntityId } from "@/components/copy-entity-id";
import { type EntityIdKind, isOpaqueEntityKind, splitEntityId } from "@/lib/entity-id";

/* Keep the full opaque id in hidden text so abbreviation does not remove selection, search, or accessible
   content. */
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
  readonly href?: string;
  /* Build the link name from the painted abbreviation so speech input can activate the text the operator
     sees. */
  readonly linkLabel?: (shown: string) => string;
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
        <Link className="qcms-text-link" href={href} aria-label={linkLabel?.(head)}>
          {id}
        </Link>
      )}
      {copy ? <CopyEntityId kind={kind} value={value} display={head} /> : null}
    </span>
  );
}
