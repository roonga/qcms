import {
  FORMAT_PATTERNS as KERNEL_FORMATS,
  FORMAT_PATTERN_NAMES as KERNEL_NAMES,
} from "@roonga/qcms-core";
import { describe, expect, it } from "vitest";

import { t } from "../i18n/en.ts";

import {
  FORMAT_PATTERNS,
  FORMAT_PATTERN_NAMES,
  formatPatternNamed,
  withFormatPattern,
} from "./format-patterns.ts";
import type { QuestionDefinitionView } from "./types.ts";

const SHORT_TEXT: QuestionDefinitionView = {
  questionId: "q_contact",
  type: "shortText",
  label: { en: "Contact" },
};

describe("the admin's restated format set", () => {
  it("is the kernel's published set, entry for entry and field for field", () => {
    expect([...FORMAT_PATTERN_NAMES]).toEqual([...KERNEL_NAMES]);
    expect(FORMAT_PATTERNS.map((format) => format.name)).toEqual([...KERNEL_NAMES]);
    for (const format of FORMAT_PATTERNS) {
      expect(format).toEqual(KERNEL_FORMATS[format.name]);
    }
  });

  it("names every format on screen, so a new kernel entry cannot arrive unlabelled", () => {
    for (const name of FORMAT_PATTERN_NAMES) {
      expect(t(`questions.format.${name}`)).not.toBe("");
    }
  });

  it("finds an entry by name and nothing by an unknown one", () => {
    expect(formatPatternNamed("postcode-au")?.pattern).toBe(String.raw`^\d{4}$`);
    expect(formatPatternNamed("postcode-xx")).toBeUndefined();
    expect(formatPatternNamed(null)).toBeUndefined();
  });
});

describe("applying a named format", () => {
  it("writes the pattern, its length cap and its matching message together", () => {
    const patch = withFormatPattern(SHORT_TEXT, "email");
    expect(patch.constraints?.pattern).toBe(String.raw`^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$`);
    expect(patch.constraints?.maxLength).toBe(254);
    expect(patch.messages?.pattern).toEqual({
      en: "Enter an email address, like name@example.com.",
    });
  });

  it("writes every entry's own cap, and nothing else carries one", () => {
    for (const format of FORMAT_PATTERNS) {
      const patch = withFormatPattern(SHORT_TEXT, format.name);
      expect(patch.constraints?.maxLength, format.name).toBe(format.maxLength);
      expect(patch.constraints?.minLength, format.name).toBeUndefined();
    }
  });

  it("replaces a cap left behind by an earlier format, which would refuse valid values", () => {
    const tightened = withFormatPattern(SHORT_TEXT, "postcode-au");
    expect(tightened.constraints?.maxLength).toBe(4);

    const widened = withFormatPattern(
      { ...SHORT_TEXT, constraints: tightened.constraints },
      "email",
    );
    expect(widened.constraints?.maxLength).toBe(254);
  });

  it("keeps the other constraints and the other messages, taking over only the cap", () => {
    const patch = withFormatPattern(
      {
        ...SHORT_TEXT,
        required: true,
        constraints: { minLength: 3, maxLength: 120, pattern: "^old$" },
        messages: { required: { en: "Say something." }, pattern: { en: "Old wording." } },
      },
      "phone",
    );
    expect(patch.constraints).toEqual({
      minLength: 3,
      maxLength: 24,
      pattern: String.raw`^\+?(?:[ \(\)\-]*\d){7,15}[ \(\)\-]*$`,
    });
    expect(patch.messages).toEqual({
      required: { en: "Say something." },
      pattern: {
        en: "Enter a phone number of 7 to 15 digits. Spaces, brackets, hyphens and a leading plus are all fine.",
      },
    });
  });

  it("patches nothing for an unknown name", () => {
    expect(withFormatPattern(SHORT_TEXT, "postcode-xx")).toEqual({});
    expect(withFormatPattern(SHORT_TEXT, null)).toEqual({});
  });

  it("orders the written messages canonically, whatever order they arrived in", () => {
    const patch = withFormatPattern(
      { ...SHORT_TEXT, messages: { maxLength: { en: "Too long." } } },
      "postcode-au",
    );
    expect(Object.keys(patch.messages ?? {})).toEqual(["maxLength", "pattern"]);
  });
});
