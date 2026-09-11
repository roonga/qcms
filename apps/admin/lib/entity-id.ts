/**
 * How an identifying id is rendered in a table cell (issue #582).
 *
 * `plan/admin-design-contracts.md` §2 governs this, and it takes two rulings to state:
 *
 * - **2026-08-20.** An identifying column renders a type prefix plus 8 characters
 *   (`ses_45cf6345`), monospace and tabular, never the full id and never an ellipsis,
 *   with a copy control whose accessible name carries the entity and the value.
 * - **2026-08-21.** That holds for **opaque** ids and inverts for **derived** ones.
 *   A derived id renders **whole**: truncating one produces a string that is itself a
 *   valid id of the same kind, so the abbreviation cannot be told from data.
 *
 * ## The property that decides which rule a prefix takes, and why it is read from the
 * minting code rather than from the prefix list
 *
 * The contract states the distinguishing property as minting convention, because
 * `packages/core/src/ids.ts:14` mints every brand from one `idPattern` factory: `q_` and
 * `ses_` are the same grammar, so the type cannot carry the difference. An **opaque** id
 * is minted as random bytes and is uniformly long, so a shorter one is self-evidently a
 * prefix. A **derived** id is minted from author-written text and has no length
 * convention at all, so a prefix of one is indistinguishable from a whole one.
 *
 * Applying that property to what the code actually mints puts **`frm_` with the derived
 * ids**, which is not where issue #582's body or the §2 amendment's own examples put it:
 * both list `frm_` alongside `ses_` and `lnk_` as opaque. The minting says otherwise -
 * `apps/admin/lib/forms/draft.ts`'s `formIdFromSlug` builds a form id out of the slug the
 * author typed, exactly as `q_` is built out of a question's, and the API's own OpenAPI
 * examples are `frm_intake` and `frm_signup`. So `frm_intake_2026` cut to prefix-plus-8 is
 * `frm_inta`, a string that could perfectly well be another form in the same deployment -
 * the harm the anti-truncation clause exists to prevent. The examples in the contract are
 * illustrations of a property; the property is what is applied here, and the divergence is
 * stated in the PR body rather than absorbed silently.
 *
 * `whk_` is the other prefix the amendment does not name. It is minted as 16 random hex
 * bytes (`apps/api/src/features/webhooks/handler.ts`), which is the opaque convention
 * exactly, so it takes the opaque rule.
 */

/** Every entity whose id an admin table renders in an identifying cell. */
export type EntityIdKind = "session" | "link" | "webhook" | "form" | "question";

/**
 * The kinds minted as random bytes, uniformly long.
 *
 * Read as: a shorter value of this kind is self-evidently a prefix, so abbreviating one
 * cannot be mistaken for data. Every other kind is minted from author-written text and
 * renders whole.
 */
const OPAQUE_KINDS: readonly EntityIdKind[] = ["session", "link", "webhook"];

/** Whether this kind's ids are opaque, and therefore abbreviated in a table cell. */
export function isOpaqueEntityKind(kind: EntityIdKind): boolean {
  return OPAQUE_KINDS.includes(kind);
}

/** The number of characters after the type prefix that §2 renders (`ses_45cf6345`). */
export const ABBREVIATED_ID_LENGTH = 8;

/**
 * An id split into the part a cell shows and the part it does not.
 *
 * `tail` is empty whenever the whole value is shown - a derived id, or an opaque one no
 * longer than the abbreviation. A caller that renders the tail at all must render it
 * where it takes no width: see `components/entity-id.tsx` for why it is rendered rather
 * than dropped.
 */
export interface SplitEntityId {
  readonly head: string;
  readonly tail: string;
}

/**
 * Split `value` at the type prefix plus {@link ABBREVIATED_ID_LENGTH} characters.
 *
 * The prefix is taken from the value rather than from the kind, because the value is what
 * is on screen: a row whose id does not carry the prefix this kind mints (a fixture, or a
 * value from an older deployment) is shown whole rather than cut at a guessed offset.
 * Nothing here validates an id - that is `packages/core/src/ids.ts`'s job, and a table
 * renders what the API returned whatever shape it is in.
 */
export function splitEntityId(kind: EntityIdKind, value: string): SplitEntityId {
  if (!isOpaqueEntityKind(kind)) return { head: value, tail: "" };
  const underscore = value.indexOf("_");
  if (underscore < 0) return { head: value, tail: "" };
  const cut = underscore + 1 + ABBREVIATED_ID_LENGTH;
  return cut >= value.length
    ? { head: value, tail: "" }
    : { head: value.slice(0, cut), tail: value.slice(cut) };
}
