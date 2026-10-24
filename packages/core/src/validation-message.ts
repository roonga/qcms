import { z } from "zod";

import { LocalizedText } from "./localized-text.js";

/**
 * The constraint keys an author may decorate (ADR-32). Not
 * {@link ValidationConstraint}: `required` is here although presence is a flow
 * concern, and the codes no author wrote a constraint for are not, there being
 * nothing to decorate. An absent key is the inheritance, so there is no
 * "default" entry.
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
 * The canonical key order every projection of a message map iterates, so the
 * compiled document is a function of content rather than of authoring order
 * (ADR-18, byte-compared by the golden corpus).
 */
export const VALIDATION_MESSAGE_KEYS: readonly ValidationMessageKey[] =
  ValidationMessageKey.options;

/**
 * An unknown key is a parse error rather than a message that silently never
 * shows; locale completeness is a publish concern (I3). `partialRecord` because
 * a `z.record` over an enum key is exhaustive, which would make authoring one
 * message mean authoring all of them.
 */
export const ValidationMessages = z.partialRecord(ValidationMessageKey, LocalizedText);
export type ValidationMessages = z.infer<typeof ValidationMessages>;
