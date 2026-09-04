/**
 * Turning the generated `.env.example` into this deployment's `.env` (task 037).
 *
 * `.env.example` is generated from the API configuration schema, so it is the only
 * list of variables that cannot be out of date. This module fills it in rather than
 * carrying a second list: a variable added to the schema appears here automatically,
 * with its prose, and a variable removed stops appearing. There is no place to forget.
 *
 * Two rules, and they are the security-relevant part:
 *
 *   - **Key material is generated, never suggested.** Every mandatory variable the
 *     schema marks `secret` gets 32 random bytes from the platform CSPRNG. Nothing in
 *     this repository, this package or its templates contains a usable secret value,
 *     and a placeholder like `replace-with-a-strong-password` is exactly the thing
 *     operators leave in place.
 *   - **Nothing is invented for a non-secret blank.** A mandatory variable with no
 *     answer stays blank and is REPORTED, so the operator is told what is missing
 *     rather than handed a plausible wrong value.
 */

/** The marker line the generator writes above each assignment. */
const MARKER = /^# \(([^)]*)\)$/;

/** An assignment, commented out or not, with no value. */
const BLANK_ASSIGNMENT = /^(# )?([A-Z][A-Z0-9_]*)=$/;

/** A filled `.env`, and the mandatory variables the operator still has to answer. */
export interface FilledEnv {
  readonly text: string;
  readonly unresolved: readonly string[];
}

/** 32 random bytes as base64url: 43 characters, above every `>= 32` floor in the schema. */
export function generateSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Fill the generated example with this deployment's answers and fresh key material.
 *
 * @param example the rendered `.env.example` text
 * @param answers values the operator supplied, by variable name
 * @param secret how to make one secret; injectable so tests are deterministic
 */
export function fillEnv(
  example: string,
  answers: Readonly<Record<string, string>>,
  secret: () => string = generateSecret,
): FilledEnv {
  const lines = example.split("\n");
  const unresolved: string[] = [];
  let attributes: readonly string[] = [];

  const filled = lines.map((line) => {
    const marker = MARKER.exec(line);
    if (marker !== null) {
      attributes = (marker[1] ?? "").split(", ");
      return line;
    }
    const assignment = BLANK_ASSIGNMENT.exec(line);
    if (assignment === null) return line;

    const name = assignment[2] ?? "";
    const commented = assignment[1] !== undefined;
    const answer = answers[name];
    if (answer !== undefined) return `${name}=${answer}`;
    if (commented) return line;
    if (attributes.includes("secret")) return `${name}=${secret()}`;
    unresolved.push(name);
    return line;
  });

  return { text: filled.join("\n"), unresolved };
}
