import { describe, expect, it } from "vitest";

import type { A2UIErrors, A2UIStepDocument } from "@qcms/ui";

import { errorSummaryEntries, missingRequiredEntries } from "./error-summary";

/**
 * Issue #21 (WCAG 3.3.1): every error-summary entry used to render the same
 * sentence, so all summary links had the same accessible name and a screen-reader
 * user could not tell which field each one jumped to. The property asserted here
 * is the one that matters, not the wording: with more than one missing required
 * question, each entry's message is DISTINCT and identifies its own question. The
 * link text is the link's accessible name (a plain <a> with text and no
 * aria-label), and the real accessibility tree is asserted in the browser by
 * `e2e/a11y-error-summary.pw.ts`.
 *
 * Issue #326 is the same property for a question the document carried NO label
 * for, which both paths got wrong in opposite directions: the hydrated summary
 * emitted a constant (every label-less entry identical), the no-JS summary
 * emitted the bare per-field message (two questions sharing one authored message
 * identical). Both are now named by POSITION, and both compositions live in this
 * module, so the assertions below cover both paths at once.
 *
 * The kitchen-sink first step: two required questions, plus the honeypot, which is
 * a named node with no label (the missing-label fallback's real-world shape).
 */
const stepDoc = {
  stepId: "stp_about",
  root: {
    type: "Form",
    children: [
      {
        type: "Flex",
        props: { direction: "column" },
        children: [
          { type: "Text", props: { as: "h2" }, children: "About you" },
          { type: "TextField", props: { name: "q_full_name", label: "Full name" } },
          { type: "DatePicker", props: { name: "q_dob", label: "Date of birth" } },
          { type: "Honeypot", props: { name: "website", ariaHidden: true } },
        ],
      },
    ],
  },
} as unknown as A2UIStepDocument;

const VISIBLE = ["q_full_name", "q_dob"];

/**
 * The issue #326 shape, built deliberately because the admin UI cannot author it
 * (`trimLocalized` collapses a whitespace-only label and the save then fails, so
 * it takes an authenticated author calling the authoring API directly).
 *
 * Two label-less questions on one step - one with a blank label, one with an
 * empty one - carrying the SAME author `required` message (which ADR-32 permits).
 * That is the single fixture both defects are visible in: a constant would name
 * the pair identically, and so would the bare authored message.
 *
 * Three things about the layout are load-bearing:
 *  - the label-less pair sits at visible positions 2 and 4, so a summary-INDEX
 *    implementation (which would say 1 and 2) fails these assertions;
 *  - `q_hidden` sits between them in the document but is absent from the visible
 *    set, so a whole-DOCUMENT-order implementation (which would say 5 for the
 *    last one) also fails;
 *  - the two labelled questions are unaffected, so the labelled composition is
 *    still pinned in the same fixture.
 */
const AUTHORED = "Check the vehicle paperwork";

const labelLessDoc = {
  stepId: "stp_mixed",
  root: {
    type: "Form",
    children: [
      { type: "TextField", props: { name: "q_full_name", label: "Full name" } },
      {
        type: "TextField",
        props: { name: "q_blank_b", label: "  ", messages: { required: AUTHORED } },
      },
      { type: "TextField", props: { name: "q_hidden", label: "Hidden follow-up" } },
      { type: "DatePicker", props: { name: "q_dob", label: "Date of birth" } },
      {
        type: "TextField",
        props: { name: "q_blank_d", label: "", messages: { required: AUTHORED } },
      },
    ],
  },
} as unknown as A2UIStepDocument;

/** The API's visible set for that step: `q_hidden` is not in it. */
const labelLessVisible = ["q_full_name", "q_blank_b", "q_dob", "q_blank_d"];

/** Only the two label-less questions are errored, so summary index != position. */
const labelLessMissing = ["q_blank_b", "q_blank_d"];
const labelLessErrors: A2UIErrors = { q_blank_b: AUTHORED, q_blank_d: AUTHORED };

describe("missingRequiredEntries", () => {
  it("gives each entry a distinct message naming its own question", () => {
    const entries = missingRequiredEntries(stepDoc, ["q_full_name", "q_dob"], VISIBLE);

    expect(entries.map((entry) => entry.questionId)).toEqual(["q_full_name", "q_dob"]);
    expect(entries[0]?.message).toContain("Full name");
    expect(entries[1]?.message).toContain("Date of birth");
    // The defect this guards: identical messages for every entry.
    expect(new Set(entries.map((entry) => entry.message)).size).toBe(entries.length);
    // A question's message names only its own field.
    expect(entries[0]?.message).not.toContain("Date of birth");
    expect(entries[1]?.message).not.toContain("Full name");
  });

  it("leaves no unresolved placeholder in a named message", () => {
    const [entry] = missingRequiredEntries(stepDoc, ["q_full_name"], VISIBLE);
    expect(entry?.message).not.toContain("{label}");
    expect(entry?.message).toBe("Full name needs an answer.");
  });

  it("names a label-less question by its position, never by a constant", () => {
    // `website` is the honeypot: a named node the compiler gives no label. Here it
    // is in the visible set, so it has a place on the page to be counted to.
    const entries = missingRequiredEntries(
      stepDoc,
      ["website"],
      ["q_full_name", "q_dob", "website"],
    );
    expect(entries[0]?.message).toBe("Question 3: This question needs an answer.");
    expect(entries[0]?.message).not.toContain("{");
  });

  it("falls back to the unnamed sentence only for a question with no position at all", () => {
    // Neither in the document nor in the visible set: nothing is rendered for it,
    // so there is no field on the page to count to. Neither caller can produce
    // this - the flow intersects `missingRequired` with the visible set first.
    const entries = missingRequiredEntries(stepDoc, ["q_unknown"], VISIBLE);
    expect(entries[0]?.message).toBe("This question needs an answer.");
  });

  it("positions from the visible set when there is no step document to walk", () => {
    const entries = missingRequiredEntries(null, ["q_dob"], VISIBLE);
    expect(entries).toEqual([
      { questionId: "q_dob", message: "Question 2: This question needs an answer." },
    ]);
  });

  it("returns nothing when nothing is missing", () => {
    expect(missingRequiredEntries(stepDoc, [], VISIBLE)).toEqual([]);
  });
});

/**
 * Issue #326, hydrated path. Before the fix these two entries were both
 * "This question needs an answer.": one accessible name for two links.
 */
describe("missingRequiredEntries with label-less questions (issue #326)", () => {
  it("gives two label-less questions DIFFERENT accessible names", () => {
    const names = missingRequiredEntries(labelLessDoc, labelLessMissing, labelLessVisible).map(
      (entry) => entry.message,
    );
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("numbers them by their place among the VISIBLE questions, not in the summary", () => {
    const entries = missingRequiredEntries(labelLessDoc, labelLessMissing, labelLessVisible);
    // Visible order is q_full_name, q_blank_b, q_dob, q_blank_d.
    expect(entries.map((entry) => entry.message)).toEqual([
      `Question 2: ${AUTHORED}`,
      `Question 4: ${AUTHORED}`,
    ]);
    // Summary-index naming would have said 1 and 2; document-order naming (which
    // counts the hidden question) would have said 5 for the second.
    expect(entries[0]?.message).not.toContain("Question 1");
    expect(entries[1]?.message).not.toContain("Question 5");
  });

  it("leaves the labelled entries in the same step label-anchored", () => {
    const entries = missingRequiredEntries(
      labelLessDoc,
      ["q_full_name", "q_blank_b"],
      labelLessVisible,
    );
    expect(entries[0]?.message).toBe("Full name needs an answer.");
    expect(entries[1]?.message).toBe(`Question 2: ${AUTHORED}`);
  });
});

/**
 * Issue #326, no-JS path (task 044). Before the fix these two entries were both
 * the bare authored message: one accessible name for two links, by the opposite
 * route - too specific to be generic, where the hydrated path was too generic to
 * be specific.
 */
describe("errorSummaryEntries", () => {
  it("gives two label-less questions DIFFERENT accessible names", () => {
    const names = errorSummaryEntries(labelLessDoc, labelLessErrors, labelLessVisible).map(
      (entry) => entry.message,
    );
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("numbers them by their place among the VISIBLE questions, not in the summary", () => {
    const entries = errorSummaryEntries(labelLessDoc, labelLessErrors, labelLessVisible);
    expect(entries.map((entry) => entry.message)).toEqual([
      `Question 2: ${AUTHORED}`,
      `Question 4: ${AUTHORED}`,
    ]);
    expect(entries[0]?.message).not.toContain("Question 1");
    expect(entries[1]?.message).not.toContain("Question 5");
  });

  it("keeps a labelled entry label-anchored, with the resolved message as the body", () => {
    const entries = errorSummaryEntries(
      labelLessDoc,
      { q_full_name: "That answer is not valid." },
      labelLessVisible,
    );
    expect(entries).toEqual([
      { questionId: "q_full_name", message: "Full name: That answer is not valid." },
    ]);
  });

  it("keeps the anchor target and the route's order", () => {
    const entries = errorSummaryEntries(labelLessDoc, labelLessErrors, labelLessVisible);
    expect(entries.map((entry) => entry.questionId)).toEqual(["q_blank_b", "q_blank_d"]);
  });

  it("drops an entry with no message, and returns nothing for an empty error map", () => {
    expect(errorSummaryEntries(labelLessDoc, { q_full_name: undefined }, labelLessVisible)).toEqual(
      [],
    );
    expect(errorSummaryEntries(labelLessDoc, {}, labelLessVisible)).toEqual([]);
  });

  it("keeps a hidden question's own label when the route somehow errors on it", () => {
    const entries = errorSummaryEntries(labelLessDoc, { q_hidden: AUTHORED }, labelLessVisible);
    expect(entries[0]?.message).toBe(`Hidden follow-up: ${AUTHORED}`);
  });

  it("falls back to the bare message only when the question has no position at all", () => {
    // In neither the document nor the visible set: no label to read and no field
    // on the page to count to. The route cannot produce it - the API raises
    // errors against questions it just served.
    const entries = errorSummaryEntries(labelLessDoc, { q_absent: AUTHORED }, labelLessVisible);
    expect(entries[0]?.message).toBe(AUTHORED);
  });
});
