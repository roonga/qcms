/**
 * Vetted `shortText` pattern constraints. Every entry is accepted by `checkSafePattern`
 * and compiles under the browser's `v` flag, so an author can take one unchanged.
 * `example` and `message` are author-facing English: the launch locale is the only one
 * (R7). Sources for each shape are in `docs/DOMAIN_SCHEMA.md` §2.2.
 */

export const FORMAT_PATTERN_NAMES = [
  "email",
  "phone",
  "postcode-au",
  "postcode-ca",
  "postcode-gb",
  "postcode-us",
] as const;

export type FormatPatternName = (typeof FORMAT_PATTERN_NAMES)[number];

/** `maxLength` is the companion length cap, not something the expression itself enforces. */
export interface FormatPattern {
  readonly name: FormatPatternName;
  readonly pattern: string;
  readonly maxLength: number;
  readonly example: string;
  readonly message: string;
}

export const FORMAT_PATTERNS: Readonly<Record<FormatPatternName, FormatPattern>> = {
  email: {
    name: "email",
    // WHATWG's own expression ends in `(?:...)*` over a group holding a quantifier, which the
    // safe subset refuses, so this checks the structure a typo breaks instead.
    pattern: String.raw`^[^@\s]+@[^@\s]+\.[^@\s]{2,}$`,
    maxLength: 254,
    example: "name@example.com",
    message: "Enter an email address, like name@example.com.",
  },
  phone: {
    name: "phone",
    pattern: String.raw`^\+?(?:[ \(\)\-]*\d){7,15}[ \(\)\-]*$`,
    maxLength: 24,
    example: "+61 2 9876 5432",
    message:
      "Enter a phone number of 7 to 15 digits. Spaces, brackets, hyphens and a leading plus are all fine.",
  },
  "postcode-au": {
    name: "postcode-au",
    pattern: String.raw`^\d{4}$`,
    maxLength: 4,
    example: "3000",
    message: "An Australian postcode is four digits.",
  },
  "postcode-ca": {
    name: "postcode-ca",
    // D, F, I, O, Q and U are never used, and W and Z never lead, so the excluded letters
    // catch the O-for-zero and I-for-one misreadings.
    pattern: String.raw`^[ABCEGHJ-NPRSTVXYabceghj-nprstvxy]\d[A-CEGHJ-NPRSTV-Za-ceghj-nprstv-z] ?\d[A-CEGHJ-NPRSTV-Za-ceghj-nprstv-z]\d$`,
    maxLength: 7,
    example: "K1A 0B1",
    message: "A Canadian postal code looks like K1A 0B1.",
  },
  "postcode-gb": {
    name: "postcode-gb",
    pattern: String.raw`^(?:[Gg][Ii][Rr] ?0[Aa]{2}|[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2})$`,
    maxLength: 8,
    example: "SW1A 1AA",
    message: "A UK postcode looks like SW1A 1AA.",
  },
  "postcode-us": {
    name: "postcode-us",
    pattern: String.raw`^\d{5}(?:-\d{4})?$`,
    maxLength: 10,
    example: "97204-1234",
    message: "A ZIP Code is five digits, or five digits, a hyphen and four more.",
  },
};
