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
  "release",
];

/*
 * Releasing a withheld event is not the forms word docs/WORKSPACE_ACCESS.md section 5 keeps out
 * of card copy, and the screen control for it says release, so the card has to match it.
 */
const EXEMPT: Readonly<Record<string, readonly string[]>> = {
  release: ["agent.card.response.unflag.title", "membership.agentAudit.act.response.unflag"],
};

const CARD_PREFIXES: readonly string[] = [
  "agent.card.",
  "forms.assist.",
  "membership.agentAudit.act.",
];

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
      const allowed = EXEMPT[word] ?? [];
      const offenders = cardCopy()
        .filter(([key, text]) => {
          return !allowed.includes(key) && text.toLowerCase().includes(word.toLowerCase());
        })
        .map(([key]) => key);
      expect(offenders).toEqual([]);
    });
  }
});
