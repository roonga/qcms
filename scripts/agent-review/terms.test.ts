import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  FORBIDDEN_TERMS,
  findForbiddenTerms,
  findIdentifiers,
  ID_PREFIXES,
  PROMPT_AVOID_WORDS,
  PROMPT_SOURCE,
  REVIEW_ONLY_TERMS,
  termPattern,
} from "./terms.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The prompt's own list, read as text: `apps/api` publishes `dist` and no script may import it. */
function promptAvoidWords(source: string): string[] | undefined {
  const literal = /export const AVOID_WORDS = \[(?<body>[^\]]*)\]/u.exec(source)?.groups?.["body"];
  return literal === undefined
    ? undefined
    : [...literal.matchAll(/"(?<word>[^"]+)"/gu)].map((found) => found[1] as string);
}

describe("the words the assistant may not say", () => {
  it("stays in step with the assistant prompt's own list", () => {
    const file = join(REPO_ROOT, PROMPT_SOURCE);
    expect(existsSync(file), `${PROMPT_SOURCE} has moved; point PROMPT_SOURCE at it`).toBe(true);

    const declared = promptAvoidWords(readFileSync(file, "utf8"));
    if (declared === undefined) return;
    expect([...declared].sort()).toEqual([...PROMPT_AVOID_WORDS].sort());
  });

  it("adds review-only words without folding them into the prompt's list", () => {
    expect(FORBIDDEN_TERMS).toEqual([...PROMPT_AVOID_WORDS, ...REVIEW_ONLY_TERMS]);
    for (const word of REVIEW_ONLY_TERMS) {
      expect(PROMPT_AVOID_WORDS).not.toContain(word);
    }
  });

  it("matches a builder prefix anywhere and an ordinary word only whole", () => {
    expect(termPattern("frm_").test("the form frm_abc")).toBe(true);
    expect(findForbiddenTerms("the slug is set")).toHaveLength(1);
    expect(findForbiddenTerms("progress was sluggish")).toHaveLength(0);
    expect(findForbiddenTerms("Operational state", ["operational"])).toHaveLength(1);
  });

  it("reads back the plain sentence it flagged", () => {
    const [hit] = findForbiddenTerms("I have minted the link for you.");

    expect(hit?.term).toBe("minted");
    expect(hit?.match).toBe("minted");
  });

  it("finds an identifier of every branded kind", () => {
    for (const prefix of ID_PREFIXES) {
      expect(findIdentifiers(`look at ${prefix}_larkmead_1 please`)).toHaveLength(1);
    }
    expect(findIdentifiers("the Phone number question")).toHaveLength(0);
  });
});
