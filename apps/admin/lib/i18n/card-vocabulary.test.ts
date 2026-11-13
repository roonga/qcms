import { describe, expect, it } from "vitest";

import { messages } from "./en.ts";

/*
 * The assistant's own prose is held to this vocabulary by the API's system prompt. A card is
 * written by the admin rather than by the model, so the same words have to be kept out here.
 */
const BUILDER_WORDS: readonly string[] = [
  "frm_",
  "q_",
  "stp_",
  "rul_",
  "opt_",
  "grp_",
  "lnk_",
  "slug",
  "minted",
  "pinnable",
  "unpinned",
  "unpublished",
  "draft v1",
  "BFF",
];

const CARD_PREFIXES: readonly string[] = ["agent.card.", "forms.assist."];

function cardCopy(): readonly (readonly [string, string])[] {
  return Object.entries(messages).filter(([key]) =>
    CARD_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

describe("the words a card uses", () => {
  it("covers the card catalogue", () => {
    expect(cardCopy().length).toBeGreaterThan(80);
  });

  for (const word of BUILDER_WORDS) {
    it(`never says ${word}`, () => {
      const offenders = cardCopy()
        .filter(([, text]) => text.toLowerCase().includes(word.toLowerCase()))
        .map(([key]) => key);
      expect(offenders).toEqual([]);
    });
  }
});
