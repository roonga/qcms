import { describe, expect, it } from "vitest";

import type { A2UIErrors, A2UIStepDocument } from "@roonga/qcms-ui";

import {
  errorSummaryEntries,
  missingOnStep,
  missingRequiredEntries,
  orderedEntries,
  refusalsOnStep,
  requiredFieldErrors,
  stepSummaryEntries,
} from "./error-summary";

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
    expect(new Set(entries.map((entry) => entry.message)).size).toBe(entries.length);
    expect(entries[0]?.message).not.toContain("Date of birth");
    expect(entries[1]?.message).not.toContain("Full name");
  });

  it("leaves no unresolved placeholder in a named message", () => {
    const [entry] = missingRequiredEntries(stepDoc, ["q_full_name"], VISIBLE);
    expect(entry?.message).not.toContain("{label}");
    expect(entry?.message).toBe("Full name needs an answer.");
  });

  it("names a label-less question by its position, never by a constant", () => {
    const entries = missingRequiredEntries(
      stepDoc,
      ["website"],
      ["q_full_name", "q_dob", "website"],
    );
    expect(entries[0]?.message).toBe("Question 3: This question needs an answer.");
    expect(entries[0]?.message).not.toContain("{");
  });

  it("falls back to the unnamed sentence only for a question with no position at all", () => {
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
    expect(entries.map((entry) => entry.message)).toEqual([
      `Question 2: ${AUTHORED}`,
      `Question 4: ${AUTHORED}`,
    ]);
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
    const entries = errorSummaryEntries(labelLessDoc, { q_absent: AUTHORED }, labelLessVisible);
    expect(entries[0]?.message).toBe(AUTHORED);
  });
});

describe("the no-JS missing-required narrowing (issue #920)", () => {
  it("keeps only questions visible on the step being drawn", () => {
    expect(missingOnStep(["q_dob", "q_accident_count"], VISIBLE, {})).toEqual(["q_dob"]);
  });

  it("leaves a question that already carries the API's own refusal", () => {
    expect(missingOnStep(["q_full_name", "q_dob"], VISIBLE, { q_dob: "Too late" })).toEqual([
      "q_full_name",
    ]);
  });

  it("de-duplicates, so a forged repeat cannot draw one question twice", () => {
    expect(missingOnStep(["q_dob", "q_dob", "q_full_name", "q_dob"], VISIBLE, {})).toEqual([
      "q_dob",
      "q_full_name",
    ]);
    expect(missingOnStep(["q_full_name", "q_dob", "q_full_name"], VISIBLE, {})).toEqual([
      "q_full_name",
      "q_dob",
    ]);
  });

  it("is inert for a forged set naming questions that are not on the page", () => {
    expect(missingOnStep(["q_not_here", "__proto__"], VISIBLE, {})).toEqual([]);
    expect(missingOnStep([], VISIBLE, {})).toEqual([]);
  });

  it("gives the field slot the same wording the summary link uses", () => {
    const missing = ["q_dob"];
    expect(requiredFieldErrors(stepDoc, missing)).toEqual({
      q_dob: "This question needs an answer.",
    });
    expect(missingRequiredEntries(stepDoc, missing, VISIBLE)).toEqual([
      { questionId: "q_dob", message: "Date of birth needs an answer." },
    ]);
  });

  it("prefers the author's own `required` message in the field slot (ADR-32)", () => {
    const authoredDoc = {
      stepId: "stp_about",
      root: {
        type: "Form",
        children: [
          {
            type: "DatePicker",
            props: {
              name: "q_dob",
              label: "Date of birth",
              messages: { required: "We need your date of birth." },
            },
          },
        ],
      },
    } as unknown as A2UIStepDocument;
    expect(requiredFieldErrors(authoredDoc, ["q_dob"])).toEqual({
      q_dob: "We need your date of birth.",
    });
  });

  it("orders a mixed summary the way the fields are asked, not the way it was composed", () => {
    const gap = missingRequiredEntries(stepDoc, ["q_full_name"], VISIBLE);
    const refusal = errorSummaryEntries(stepDoc, { q_dob: "Too late" }, VISIBLE);
    expect(orderedEntries([...refusal, ...gap], VISIBLE).map((e) => e.questionId)).toEqual([
      "q_full_name",
      "q_dob",
    ]);
  });

  it("sorts an entry outside the visible set last, and is stable within a rank", () => {
    const entries = [
      { questionId: "q_absent", message: "a" },
      { questionId: "q_dob", message: "b" },
      { questionId: "q_absent", message: "c" },
    ];
    expect(orderedEntries(entries, VISIBLE).map((e) => e.message)).toEqual(["b", "a", "c"]);
  });
});

describe("the shared step summary (local UX list P7)", () => {
  it("lists a refused answer beside a missing one, in the order the fields are asked", () => {
    const refused: A2UIErrors = { q_dob: "Enter a real date" };
    const entries = stepSummaryEntries(
      stepDoc,
      refused,
      missingOnStep(["q_full_name", "q_dob"], VISIBLE, refused),
      VISIBLE,
    );
    expect(entries).toEqual([
      { questionId: "q_full_name", message: "Full name needs an answer." },
      { questionId: "q_dob", message: "Date of birth: Enter a real date" },
    ]);
  });

  it("names a refused required question once, by its refusal", () => {
    const refused: A2UIErrors = { q_full_name: "Use letters only" };
    const entries = stepSummaryEntries(
      stepDoc,
      refused,
      missingOnStep(["q_full_name"], VISIBLE, refused),
      VISIBLE,
    );
    expect(entries).toEqual([
      { questionId: "q_full_name", message: "Full name: Use letters only" },
    ]);
  });

  it("is empty when nothing is refused or missing", () => {
    expect(stepSummaryEntries(stepDoc, {}, [], VISIBLE)).toEqual([]);
  });

  it("keeps only the refusals on the step being drawn", () => {
    const errors: A2UIErrors = {
      q_full_name: "Use letters only",
      q_elsewhere: "Refused on another step",
      q_dob: undefined,
    };
    expect(refusalsOnStep(errors, VISIBLE)).toEqual({ q_full_name: "Use letters only" });
    expect(refusalsOnStep({}, VISIBLE)).toEqual({});
  });
});
