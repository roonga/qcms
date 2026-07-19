import { describe, expect, it } from "vitest";

import {
  isCompleteFor,
  isLocaleCode,
  isLocalizedText,
  parseLocaleCode,
  parseLocalizedText,
  resolveText,
} from "./index.js";

/** Test helper: parse a locale we know is valid, or fail loudly. */
function locale(code: string) {
  const result = parseLocaleCode(code);
  if (!result.ok) {
    throw new Error(`test setup: ${code} should be a valid LocaleCode`);
  }
  return result.value;
}

/** Test helper: parse a LocalizedText we know is valid, or fail loudly. */
function text(value: unknown) {
  const result = parseLocalizedText(value);
  if (!result.ok) {
    throw new Error("test setup: value should be a valid LocalizedText");
  }
  return result.value;
}

describe("LocaleCode", () => {
  it("round-trips the BCP-47 subset: xx and xx-XX", () => {
    for (const valid of ["en", "de", "en-AU", "pt-BR"]) {
      expect(parseLocaleCode(valid)).toEqual({ ok: true, value: valid });
      expect(isLocaleCode(valid)).toBe(true);
    }
  });

  it("rejects the empty string with INVALID_LOCALE_CODE", () => {
    const result = parseLocaleCode("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_LOCALE_CODE");
    }
  });

  it("rejects shapes outside the subset", () => {
    for (const bad of ["EN", "eng", "en-au", "en_AU", "en-AUS", "e", "en-", 7, null]) {
      const result = parseLocaleCode(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_LOCALE_CODE");
      }
    }
  });
});

describe("LocalizedText", () => {
  it("round-trips a locale map unchanged", () => {
    const input = { en: "Date of birth", "de-DE": "Geburtsdatum" };
    const result = parseLocalizedText(input);
    expect(result).toEqual({ ok: true, value: input });
    expect(isLocalizedText(input)).toBe(true);
  });

  it("rejects an empty-string locale key with INVALID_LOCALIZED_TEXT", () => {
    const result = parseLocalizedText({ "": "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_LOCALIZED_TEXT");
    }
  });

  it("rejects empty translation values and non-record input", () => {
    for (const bad of [{ en: "" }, { EN: "shout" }, "en", 3, null, ["en"]]) {
      const result = parseLocalizedText(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_LOCALIZED_TEXT");
      }
    }
  });
});

describe("resolveText", () => {
  const map = text({ en: "Health", de: "Gesundheit" });

  it("returns the exact locale when present", () => {
    expect(resolveText(map, locale("de"), locale("en"))).toEqual({
      ok: true,
      value: "Gesundheit",
    });
  });

  it("falls back to the default locale", () => {
    expect(resolveText(map, locale("fr"), locale("en"))).toEqual({
      ok: true,
      value: "Health",
    });
  });

  it("does not fall back from region to bare language (deterministic subset)", () => {
    const result = resolveText(text({ en: "Hi" }), locale("de-DE"), locale("fr"));
    expect(result.ok).toBe(false);
  });

  it("returns LOCALIZED_TEXT_MISSING when neither locale resolves", () => {
    const result = resolveText(map, locale("fr"), locale("es"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LOCALIZED_TEXT_MISSING");
      expect(result.error.path).toEqual(["fr"]);
    }
  });
});

describe("isCompleteFor", () => {
  it("is true only for locales with a non-empty entry", () => {
    const map = text({ en: "Health" });
    expect(isCompleteFor(map, locale("en"))).toBe(true);
    expect(isCompleteFor(map, locale("de"))).toBe(false);
  });
});
