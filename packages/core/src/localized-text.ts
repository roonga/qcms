import { z } from "zod";

import { err, ok, qcmsError, type Result } from "./errors.js";
import { parseWithCode } from "./internal/parse.js";

/**
 * Locale codes are a deliberate BCP-47 subset (ADR-11): a lowercase language
 * (`en`) or language-REGION (`en-AU`). Launch UX only ever writes/reads the
 * form's defaultLocale; the shape makes more languages a feature, not a
 * migration (full BCP-47 richness is out of scope until then).
 */
export const LocaleCode = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
  .brand<"LocaleCode">();
export type LocaleCode = z.infer<typeof LocaleCode>;

export function parseLocaleCode(value: unknown): Result<LocaleCode> {
  return parseWithCode(LocaleCode, "INVALID_LOCALE_CODE", "LocaleCode", value);
}
export function isLocaleCode(value: unknown): value is LocaleCode {
  return LocaleCode.safeParse(value).success;
}

/**
 * Every human-readable field is a locale map (ADR-11), e.g.
 * `{ "en": "Date of birth" }`. Publish validates completeness for the form's
 * defaultLocale only (invariant I3, task 008).
 */
export const LocalizedText = z.record(LocaleCode, z.string().min(1));
export type LocalizedText = z.infer<typeof LocalizedText>;

export function parseLocalizedText(value: unknown): Result<LocalizedText> {
  return parseWithCode(LocalizedText, "INVALID_LOCALIZED_TEXT", "LocalizedText", value);
}
export function isLocalizedText(value: unknown): value is LocalizedText {
  return LocalizedText.safeParse(value).success;
}

/**
 * Resolve a display string: exact locale → default locale → typed error.
 * No language-only fallback (`en-AU` does not fall back to `en`) - the launch
 * subset keeps resolution deterministic and dumb by design.
 */
export function resolveText(
  text: LocalizedText,
  locale: LocaleCode,
  defaultLocale: LocaleCode,
): Result<string> {
  const exact = text[locale];
  if (exact !== undefined) {
    return ok(exact);
  }
  const fallback = text[defaultLocale];
  if (fallback !== undefined) {
    return ok(fallback);
  }
  return err(
    qcmsError(
      "LOCALIZED_TEXT_MISSING",
      `LocalizedText has no entry for "${locale}" nor default "${defaultLocale}"`,
      [locale],
    ),
  );
}

/** True when the map carries a non-empty entry for the given locale. */
export function isCompleteFor(text: LocalizedText, locale: LocaleCode): boolean {
  const entry = text[locale];
  return entry !== undefined && entry.length > 0;
}
