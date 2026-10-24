import { z } from "zod";

import { LocalizedText } from "./localized-text.js";

/**
 * Author-supplied validation messages (ADR-32). Presentation payload only: the
 * kernel stays the validation authority and keeps emitting its stable codes, so
 * nothing here is ever evaluated.
 *
 * The fallback is defined at the edit level, where a blank field means inherit
 * the default, which is why this module has no "default" entry: an absent key
 * is the inheritance.
 */

/**
 * The constraint keys an author may decorate. These are what an author writes
 * on the definition, which is why the set is not {@link ValidationConstraint}:
 * `required` is here although presence is a flow concern rather than a value
 * one, while `encoding` and `options` are not, because no author wrote a
 * constraint to produce them and there is nothing to decorate.
 */
export const ValidationMessageKey = z.enum([
  "required",
  "minLength",
  "maxLength",
  "pattern",
  "min",
  "max",
  "integer",
  "minSelected",
  "maxSelected",
]);
export type ValidationMessageKey = z.infer<typeof ValidationMessageKey>;

/**
 * The canonical key order. Every projection of a message map iterates this
 * array rather than the authored object's own key order, so the compiled
 * document is a function of content and not of the order an editor wrote the
 * JSON in (ADR-18: the golden corpus byte-compares it).
 */
export const VALIDATION_MESSAGE_KEYS: readonly ValidationMessageKey[] =
  ValidationMessageKey.options;

/**
 * The optional per-constraint message map on a question definition. An unknown
 * key is a parse error rather than a message that silently never shows, and an
 * absent key inherits the portal default.
 *
 * Locale completeness is a publish concern rather than a parse one (I3).
 *
 * `partialRecord` rather than `record`, because a `z.record` over an enum key is
 * exhaustive in Zod 4, which would make authoring one message mean authoring
 * all of them.
 */
export const ValidationMessages = z.partialRecord(ValidationMessageKey, LocalizedText);
export type ValidationMessages = z.infer<typeof ValidationMessages>;
