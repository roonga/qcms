import { z } from "zod";

import { err, ok, qcmsError, type Result } from "./errors.js";
import { parseWithCode } from "./internal/parse.js";

/** A deliberate BCP-47 subset: a language, optionally with a region (ADR-11). */
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

/** Publish validates completeness for the form's default locale only (I3). */
export const LocalizedText = z.record(LocaleCode, z.string().min(1));
export type LocalizedText = z.infer<typeof LocalizedText>;

export function parseLocalizedText(value: unknown): Result<LocalizedText> {
  return parseWithCode(LocalizedText, "INVALID_LOCALIZED_TEXT", "LocalizedText", value);
}
export function isLocalizedText(value: unknown): value is LocalizedText {
  return LocalizedText.safeParse(value).success;
}

/**
 * Exact locale, then default locale, then a typed error. No language-only
 * fallback, deliberately, so resolution stays deterministic.
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

export function isCompleteFor(text: LocalizedText, locale: LocaleCode): boolean {
  const entry = text[locale];
  return entry !== undefined && entry.length > 0;
}
