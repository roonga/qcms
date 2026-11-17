import { describe, expect, it } from "vitest";

import {
  FORMAT_PATTERNS,
  FORMAT_PATTERN_NAMES,
  type FormatPatternName,
} from "./format-patterns.js";
import { QuestionDefinition } from "./question-definition.js";
import {
  SAFE_PATTERN_MAX_LENGTH,
  checkSafePattern,
  classSetAmbiguity,
  compilesUnderV,
} from "./safe-pattern.js";

interface Corpus {
  readonly accepts: readonly string[];
  readonly rejects: readonly string[];
}

const CORPUS: Readonly<Record<FormatPatternName, Corpus>> = {
  email: {
    accepts: [
      "name@example.com",
      "first.last@example.co.uk",
      "user+tag@example.org",
      "a@b.co",
      "user_name@mail.example.museum",
      "ユーザー@例え.テスト",
    ],
    rejects: [
      "",
      "name",
      "name@",
      "@example.com",
      "name@example",
      "name @example.com",
      "name@exa mple.com",
      "name@@example.com",
      "name@example.c",
      "name@example.com\nsecond@example.com",
    ],
  },
  phone: {
    accepts: [
      "+61 2 9876 5432",
      "0298765432",
      "(02) 9876 5432",
      "+1-202-555-0143",
      "+442079460958",
      "0400 000 000",
      "+999 999 999 999 999",
    ],
    rejects: [
      "",
      "123456",
      "phone",
      "+61 2 9876 5432 ext 12",
      "1234567890123456",
      "++61298765432",
      "+61 2 9876 5432.",
      "02 9876 5432\n03 9876 5432",
    ],
  },
  "postcode-au": {
    accepts: ["3000", "0800", "2000", "6000", "0872"],
    rejects: ["", "300", "30000", "3o00", " 3000", "3000 ", "3000\n4000"],
  },
  "postcode-ca": {
    accepts: ["K1A 0B1", "K1A0B1", "k1a 0b1", "H0H 0H0", "V6Z 2H7"],
    rejects: [
      "",
      "D1A 0B1",
      "Z1A 0B1",
      "W1A 0B1",
      "K1D 0B1",
      "K1A 0B",
      "K1A  0B1",
      "K1A-0B1",
      "K1A 0B1\nK1A 0B2",
    ],
  },
  "postcode-gb": {
    accepts: [
      "SW1A 1AA",
      "EC1A 1BB",
      "M1 1AE",
      "B33 8TH",
      "CR2 6XH",
      "DN55 1PT",
      "W1A 0AX",
      "GIR 0AA",
      "sw1a 1aa",
      "M11AE",
    ],
    rejects: [
      "",
      "SW1A 1A",
      "SW1A 1A1",
      "SW1A  1AA",
      "12345",
      "SW1A-1AA",
      "SWW1A 1AA",
      "SW1A 1AA\nEC1A 1BB",
    ],
  },
  "postcode-us": {
    accepts: ["97204", "20500", "00501", "97204-1234", "20500-0003"],
    rejects: ["", "9720", "972045", "9720A", "97204-123", "97204 1234", "97204-", "97204\n20500"],
  },
};

describe("published format patterns", () => {
  it("names every entry exactly once, keyed by its own name", () => {
    expect([...FORMAT_PATTERN_NAMES]).toEqual([...new Set(FORMAT_PATTERN_NAMES)]);
    for (const name of FORMAT_PATTERN_NAMES) {
      expect(FORMAT_PATTERNS[name].name).toBe(name);
    }
    expect(Object.keys(FORMAT_PATTERNS).sort()).toEqual([...FORMAT_PATTERN_NAMES].sort());
  });

  it.each(FORMAT_PATTERN_NAMES)("%s is inside the engine's safe subset", (name) => {
    const { pattern } = FORMAT_PATTERNS[name];
    expect(checkSafePattern(pattern)).toBeUndefined();
    expect(pattern.length).toBeLessThanOrEqual(SAFE_PATTERN_MAX_LENGTH);
  });

  it.each(FORMAT_PATTERN_NAMES)("%s survives a browser's own pattern compiler", (name) => {
    const { pattern } = FORMAT_PATTERNS[name];
    expect(compilesUnderV(pattern)).toBe(true);
    expect(classSetAmbiguity(pattern)).toBeUndefined();
  });

  it.each(FORMAT_PATTERN_NAMES)("%s is anchored at both ends", (name) => {
    const { pattern } = FORMAT_PATTERNS[name];
    expect(pattern.startsWith("^")).toBe(true);
    expect(pattern.endsWith("$")).toBe(true);
  });

  it.each(FORMAT_PATTERN_NAMES)("%s parses as a shortText constraint", (name) => {
    const { pattern, maxLength, message } = FORMAT_PATTERNS[name];
    const parsed = QuestionDefinition.safeParse({
      questionId: "q_format",
      type: "shortText",
      label: { en: "Format" },
      constraints: { pattern, maxLength },
      messages: { pattern: { en: message } },
    });
    expect(parsed.success).toBe(true);
  });

  it.each(FORMAT_PATTERN_NAMES)("%s accepts its own example, within its own cap", (name) => {
    const { pattern, example, maxLength } = FORMAT_PATTERNS[name];
    expect(new RegExp(pattern, "u").test(example)).toBe(true);
    expect(example.length).toBeLessThanOrEqual(maxLength);
  });

  it.each(FORMAT_PATTERN_NAMES)("%s accepts its corpus of real values", (name) => {
    const { pattern, maxLength } = FORMAT_PATTERNS[name];
    const regex = new RegExp(pattern, "u");
    const refused = CORPUS[name].accepts.filter((value) => !regex.test(value));
    expect(refused).toEqual([]);
    const overCap = CORPUS[name].accepts.filter((value) => value.length > maxLength);
    expect(overCap).toEqual([]);
  });

  it.each(FORMAT_PATTERN_NAMES)("%s rejects its corpus of malformed values", (name) => {
    const regex = new RegExp(FORMAT_PATTERNS[name].pattern, "u");
    const admitted = CORPUS[name].rejects.filter((value) => regex.test(value));
    expect(admitted).toEqual([]);
  });

  it("states a message and an example for every entry", () => {
    for (const name of FORMAT_PATTERN_NAMES) {
      const entry = FORMAT_PATTERNS[name];
      expect(entry.example).not.toBe("");
      expect(entry.message.endsWith(".")).toBe(true);
      expect(entry.message).not.toContain(entry.pattern);
    }
  });

  it("holds a corpus for every entry", () => {
    for (const name of FORMAT_PATTERN_NAMES) {
      expect(CORPUS[name].accepts.length).toBeGreaterThanOrEqual(4);
      expect(CORPUS[name].rejects.length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("the phone pattern's digit count", () => {
  it("follows E.164: seven digits through fifteen, separators uncounted", () => {
    const regex = new RegExp(FORMAT_PATTERNS.phone.pattern, "u");
    for (let digits = 1; digits <= 20; digits += 1) {
      const value = `+${"9".repeat(digits)}`;
      expect(regex.test(value), `${String(digits)} digits`).toBe(digits >= 7 && digits <= 15);
    }
  });
});

describe("the safe subset's reach", () => {
  it("refuses WHATWG's own email expression, which is why the published one differs", () => {
    const backtick = "`";
    const whatwg =
      String.raw`^[a-zA-Z0-9.!#$%&'*+/=?^_` +
      backtick +
      String.raw`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`;
    expect(new RegExp(whatwg, "u")).toBeInstanceOf(RegExp);
    expect(checkSafePattern(whatwg)?.code).toBe("PATTERN_UNSUPPORTED");
  });
});
