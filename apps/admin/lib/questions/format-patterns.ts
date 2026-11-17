import { withMessage } from "./definition.ts";
import type { QuestionDefinitionView } from "./types.ts";

// Restated rather than imported: the admin runs no kernel code (R2), and the bundle carries no
// kernel module. format-patterns.test.ts fails the moment this drifts from @roonga/qcms-core.
export const FORMAT_PATTERN_NAMES = [
  "email",
  "phone",
  "postcode-au",
  "postcode-ca",
  "postcode-gb",
  "postcode-nz",
  "postcode-us",
] as const;

export type FormatPatternName = (typeof FORMAT_PATTERN_NAMES)[number];

export interface FormatPattern {
  readonly name: FormatPatternName;
  readonly pattern: string;
  readonly maxLength: number;
  readonly example: string;
  readonly message: string;
}

export const FORMAT_PATTERNS: readonly FormatPattern[] = [
  {
    name: "email",
    pattern: String.raw`^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$`,
    maxLength: 254,
    example: "name@example.com",
    message: "Enter an email address, like name@example.com.",
  },
  {
    name: "phone",
    pattern: String.raw`^\+?(?:[ \(\)\-]*\d){7,15}[ \(\)\-]*$`,
    maxLength: 24,
    example: "+61 2 9876 5432",
    message:
      "Enter a phone number of 7 to 15 digits. Spaces, brackets, hyphens and a leading plus are all fine.",
  },
  {
    name: "postcode-au",
    pattern: String.raw`^\d{4}$`,
    maxLength: 4,
    example: "3000",
    message: "An Australian postcode is four digits.",
  },
  {
    name: "postcode-ca",
    pattern: String.raw`^[ABCEGHJ-NPRSTVXYabceghj-nprstvxy]\d[A-CEGHJ-NPRSTV-Za-ceghj-nprstv-z] ?\d[A-CEGHJ-NPRSTV-Za-ceghj-nprstv-z]\d$`,
    maxLength: 7,
    example: "K1A 0B1",
    message: "A Canadian postal code looks like K1A 0B1.",
  },
  {
    name: "postcode-gb",
    pattern: String.raw`^(?:[Gg][Ii][Rr] ?0[Aa]{2}|[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2})$`,
    maxLength: 8,
    example: "SW1A 1AA",
    message: "A UK postcode looks like SW1A 1AA.",
  },
  {
    name: "postcode-nz",
    pattern: String.raw`^\d{4}$`,
    maxLength: 4,
    example: "6011",
    message: "A New Zealand postcode is four digits.",
  },
  {
    name: "postcode-us",
    pattern: String.raw`^\d{5}(?:-\d{4})?$`,
    maxLength: 10,
    example: "97204-1234",
    message: "A ZIP Code is five digits, or five digits, a hyphen and four more.",
  },
];

export function formatPatternNamed(name: string | null): FormatPattern | undefined {
  return FORMAT_PATTERNS.find((format) => format.name === name);
}

// An unknown name patches nothing, so a stale selection cannot clear an author's own pattern. The
// length cap travels with the expression, because a cap left behind from an earlier format would
// refuse values the new pattern accepts.
export function withFormatPattern(
  definition: QuestionDefinitionView,
  name: string | null,
): Partial<QuestionDefinitionView> {
  const format = formatPatternNamed(name);
  if (format === undefined) return {};
  return {
    constraints: {
      ...(definition.constraints ?? {}),
      pattern: format.pattern,
      maxLength: format.maxLength,
    },
    messages: withMessage(definition.messages ?? {}, "pattern", format.message),
  };
}
