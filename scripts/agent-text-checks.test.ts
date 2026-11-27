import { describe, expect, it } from "vitest";

import {
  findForbiddenTerms,
  findIdentifiers,
  firstSentence,
  openingFault,
  selfClaims,
  stripSpeakerLabel,
} from "./agent-text-checks.mjs";

describe("the opening sentence a reply may not use", () => {
  it("names filler before the answer", () => {
    expect(openingFault("Sure, happy to help. The form has three steps.")).toBe(
      "the reply opens with filler instead of the result",
    );
  });

  it("allows one short clause naming the look-up", () => {
    expect(
      openingFault(
        "I'm checking the question library.\n\nThere was nothing to reuse, so all five questions are new.",
      ),
    ).toBeNull();
  });

  it("refuses an opener that hangs a second clause off the look-up", () => {
    expect(
      openingFault("I'm checking the library before I draft the form.\n\nAll five are new."),
    ).toBe("the look-up opener narrates the plan instead of naming the look-up in one clause");
  });

  it("refuses an opener with no answer under it", () => {
    expect(openingFault("Let me check the question library.")).toBe(
      "the reply announces a look-up and never gives the answer",
    );
  });

  it("refuses an opener longer than one short clause", () => {
    const opener =
      "I will look at every single published question in this workspace library right now.";

    expect(openingFault(`${opener}\n\nThere are four.`)).toContain("one short clause is allowed");
  });

  it("passes a reply that opens with the result", () => {
    expect(openingFault("The form has three steps and one rule.")).toBeNull();
  });
});

describe("the acts a reply may not claim for itself", () => {
  it("reads back the claim and where it sits", () => {
    const reply = "I have created the form for you.";

    expect(selfClaims(reply)).toEqual([{ match: "I have created", index: 0 }]);
  });

  it("finds every claim in order", () => {
    const claims = selfClaims("I added the step. Then I published it.");

    expect(claims.map((claim) => claim.match)).toEqual(["I added", "I published"]);
    expect(claims[0]?.index).toBeLessThan(claims[1]?.index ?? 0);
  });

  it("leaves a reply that only proposes alone", () => {
    expect(selfClaims("The card on your screen creates the form when you confirm it.")).toEqual([]);
  });
});

describe("the reply the checks read", () => {
  it("takes the opening sentence", () => {
    expect(firstSentence("One. Two.")).toBe("One.");
  });

  it("drops a speaker heading the harness copied in", () => {
    expect(stripSpeakerLabel("ASSISTANT\n\nThe form has three steps.")).toBe(
      "The form has three steps.",
    );
  });
});

describe("the words and identifiers both layers read", () => {
  it("reaches the term checks through this one module", () => {
    expect(findForbiddenTerms("the slug is set")).toHaveLength(1);
    expect(findIdentifiers("look at frm_larkmead please")).toHaveLength(1);
  });
});
