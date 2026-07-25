import { describe, expect, it } from "vitest";

import type { A2UIStepDocument } from "@qcms/ui";

import { missingRequiredEntries } from "./error-summary";

/**
 * Issue #21 (WCAG 3.3.1): every error-summary entry used to render the same
 * sentence, so all summary links had the same accessible name and a screen-reader
 * user could not tell which field each one jumped to. The property asserted here
 * is the one that matters, not the wording: with more than one missing required
 * question, each entry's message is DISTINCT and contains its own question's
 * label. The link text is the link's accessible name (a plain <a> with text and no
 * aria-label), and the real accessibility tree is asserted in the browser by
 * `e2e/a11y-error-summary.pw.ts`.
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

describe("missingRequiredEntries", () => {
  it("gives each entry a distinct message naming its own question", () => {
    const entries = missingRequiredEntries(stepDoc, ["q_full_name", "q_dob"]);

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
    const [entry] = missingRequiredEntries(stepDoc, ["q_full_name"]);
    expect(entry?.message).not.toContain("{label}");
    expect(entry?.message).toBe("Full name needs an answer.");
  });

  it("falls back to the unnamed message when the document carries no label", () => {
    // `website` is the honeypot: a named node the compiler gives no label.
    const entries = missingRequiredEntries(stepDoc, ["website", "q_unknown"]);

    for (const entry of entries) {
      expect(entry.message).toBe("This question needs an answer.");
      expect(entry.message).not.toContain("{");
    }
  });

  it("falls back for every entry when there is no step document", () => {
    const entries = missingRequiredEntries(null, ["q_full_name"]);
    expect(entries).toEqual([
      { questionId: "q_full_name", message: "This question needs an answer." },
    ]);
  });

  it("returns nothing when nothing is missing", () => {
    expect(missingRequiredEntries(stepDoc, [])).toEqual([]);
  });
});
