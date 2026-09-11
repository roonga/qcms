import { describe, expect, it } from "vitest";

import {
  ABBREVIATED_ID_LENGTH,
  type EntityIdKind,
  isOpaqueEntityKind,
  splitEntityId,
} from "./entity-id.ts";

/**
 * The rule that decides how an identifying column renders (issue #582).
 *
 * `plan/admin-design-contracts.md` §2 is two rulings, and the property that chooses between
 * them is minting convention: an opaque id is random bytes and uniformly long, so a shorter
 * one is self-evidently a prefix; a derived id is minted from author-written text, so a
 * prefix of one is a valid id of the same kind and cannot be told from data.
 *
 * The cases below are written out rather than derived from the module, for the reason
 * `lib/measure.test.ts` writes its POC numbers out: a table that agrees with itself proves
 * nothing.
 */

const OPAQUE: readonly EntityIdKind[] = ["session", "link", "webhook"];
const DERIVED: readonly EntityIdKind[] = ["form", "question"];

describe("which ids are abbreviated", () => {
  it("abbreviates the kinds minted as random bytes", () => {
    for (const kind of OPAQUE) expect(isOpaqueEntityKind(kind)).toBe(true);
  });

  it("renders whole the kinds minted from the author's own text", () => {
    for (const kind of DERIVED) expect(isOpaqueEntityKind(kind)).toBe(false);
  });

  it("covers every kind, so a new one cannot arrive undecided", () => {
    // The union is the enumeration: a kind added to `EntityIdKind` and to neither list
    // above fails here, which is the one-line decision this split is meant to be.
    const decided: readonly EntityIdKind[] = [...OPAQUE, ...DERIVED];
    const all: readonly EntityIdKind[] = ["session", "link", "webhook", "form", "question"];
    expect([...decided].sort((a, b) => a.localeCompare(b))).toEqual(
      [...all].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe("splitting an opaque id", () => {
  const SESSION = "ses_45cf634512ab9f0e77c1d2e3f4a5b6c7";

  it("shows the type prefix and eight characters, which is §2's own example", () => {
    expect(splitEntityId("session", SESSION).head).toBe("ses_45cf6345");
    expect(ABBREVIATED_ID_LENGTH).toBe(8);
  });

  it("keeps every remaining character, because the cell still has to carry the value", () => {
    const { head, tail } = splitEntityId("session", SESSION);
    expect(head + tail).toBe(SESSION);
    expect(tail).not.toBe("");
  });

  it("adds no ellipsis, which §2 forbids outright", () => {
    expect(splitEntityId("link", "lnk_3d9b8f2a1c9d4e07b31a")).toEqual({
      head: "lnk_3d9b8f2a",
      tail: "1c9d4e07b31a",
    });
  });

  it("renders a short value whole rather than cutting at a guessed offset", () => {
    // Fixtures and older deployments both produce these. Nothing is hidden, so nothing has
    // to be recovered.
    expect(splitEntityId("webhook", "whk_one")).toEqual({ head: "whk_one", tail: "" });
    expect(splitEntityId("session", "ses_45cf6345")).toEqual({ head: "ses_45cf6345", tail: "" });
  });

  it("renders a value with no type prefix whole, rather than cutting at character eight", () => {
    expect(splitEntityId("session", "45cf634512ab9f0e")).toEqual({
      head: "45cf634512ab9f0e",
      tail: "",
    });
  });
});

describe("splitting a derived id", () => {
  it("never cuts one, however long it is", () => {
    // The collision the 2026-08-21 amendment argues from: cut to prefix-plus-8 this is
    // `q_accident`, a string that could perfectly well be another question in the form.
    expect(splitEntityId("question", "q_accident_count")).toEqual({
      head: "q_accident_count",
      tail: "",
    });
    expect(splitEntityId("form", "frm_life_insurance_2026")).toEqual({
      head: "frm_life_insurance_2026",
      tail: "",
    });
  });
});
