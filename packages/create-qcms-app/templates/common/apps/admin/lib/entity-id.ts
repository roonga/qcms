/** Show derived IDs whole: a truncated slug can be another valid ID. Only random, uniformly long opaque IDs can be safely abbreviated. */

export type EntityIdKind = "session" | "link" | "webhook" | "form" | "question" | "group";

const OPAQUE_KINDS: readonly EntityIdKind[] = ["session", "link", "webhook"];

export function isOpaqueEntityKind(kind: EntityIdKind): boolean {
  return OPAQUE_KINDS.includes(kind);
}

export const ABBREVIATED_ID_LENGTH = 8;

/** Keep any hidden tail out of layout width; the entity-id component preserves it for accessibility. */
export interface SplitEntityId {
  readonly head: string;
  readonly tail: string;
}

/** Infer the prefix from the displayed value; unexpected or legacy values render whole rather than being cut at a guessed offset. */
export function splitEntityId(kind: EntityIdKind, value: string): SplitEntityId {
  if (!isOpaqueEntityKind(kind)) return { head: value, tail: "" };
  const underscore = value.indexOf("_");
  if (underscore < 0) return { head: value, tail: "" };
  const cut = underscore + 1 + ABBREVIATED_ID_LENGTH;
  return cut >= value.length
    ? { head: value, tail: "" }
    : { head: value.slice(0, cut), tail: value.slice(cut) };
}
