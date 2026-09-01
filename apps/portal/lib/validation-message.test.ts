import type { A2UIStepDocument } from "@qcms/ui";
import { describe, expect, it } from "vitest";

import { missingRequiredEntries } from "./error-summary";
import {
  authorMessageFor,
  defaultAnswerMessage,
  errorCodeOf,
  errorDetailsOf,
  firstAnswerRejection,
  type AnswerRejection,
} from "./validation-message";
import { messagesOf, questionMessages } from "./visible";

/**
 * Author-supplied validation messages at the portal seam (task 048, ADR-32).
 *
 * Two properties carry the feature and both are asserted here: the wording is
 * chosen **per constraint** (an author who overrode `pattern` still gets the
 * default for `minLength`), and the error summary stays **label-anchored** so two
 * questions carrying identical custom text still have distinct accessible names
 * (WCAG 3.3.1, the criterion issue #21 established). The browser tree itself is
 * asserted by `e2e/a11y-error-summary.pw.ts`.
 */

/**
 * A step whose two required questions carry the SAME custom `required` message -
 * the case the distinctness guarantee exists for - plus a third question with a
 * per-constraint mix, and the honeypot (a named node with no label and no
 * messages).
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
          { type: "Text", props: { as: "h2" }, children: "About the vehicle" },
          {
            type: "TextField",
            props: {
              name: "q_plate",
              label: "Registration plate",
              messages: { required: "Check the paperwork", pattern: "Looks like ABC-123" },
            },
          },
          {
            type: "TextField",
            props: {
              name: "q_vin",
              label: "VIN",
              messages: { required: "Check the paperwork" },
            },
          },
          { type: "NumberField", props: { name: "q_odometer", label: "Odometer" } },
          { type: "Honeypot", props: { name: "website", ariaHidden: true } },
        ],
      },
    ],
  },
} as unknown as A2UIStepDocument;

/**
 * The API's visible set for that step, in document order. The summary reads it
 * only for the ordinal a label-less entry is named by (issue #326); the honeypot
 * is in it here so that fallback has a position to use, which the real visible
 * set would not give it.
 */
const VISIBLE = ["q_plate", "q_vin", "q_odometer", "website"];

describe("questionMessages", () => {
  it("reads the author messages off the control nodes, keyed by questionId", () => {
    const messages = questionMessages(stepDoc);
    expect([...messages.keys()]).toEqual(["q_plate", "q_vin"]);
    expect(messages.get("q_plate")).toEqual({
      required: "Check the paperwork",
      pattern: "Looks like ABC-123",
    });
  });

  it("leaves a question the author did not decorate out of the map entirely", () => {
    expect(questionMessages(stepDoc).has("q_odometer")).toBe(false);
  });

  it("treats a null document as no messages (a completed flow needs no special case)", () => {
    expect(messagesOf(null).size).toBe(0);
  });
});

describe("firstAnswerRejection", () => {
  it("reads the constraint and message off the API's typed 422 detail", () => {
    expect(
      firstAnswerRejection({
        errors: [{ code: "PATTERN_MISMATCH", constraint: "pattern", message: "no match" }],
      }),
    ).toEqual({ constraint: "pattern", message: "no match" });
  });

  it("takes the first error only: one message per field", () => {
    expect(
      firstAnswerRejection({
        errors: [
          { constraint: "minLength", message: "too short" },
          { constraint: "pattern", message: "no match" },
        ],
      })?.constraint,
    ).toBe("minLength");
  });

  it("degrades to undefined for any other shape rather than throwing", () => {
    expect(firstAnswerRejection(undefined)).toBeUndefined();
    expect(firstAnswerRejection(null)).toBeUndefined();
    expect(firstAnswerRejection("nope")).toBeUndefined();
    expect(firstAnswerRejection({ errors: "nope" })).toBeUndefined();
    expect(firstAnswerRejection({ errors: [] })).toBeUndefined();
    expect(firstAnswerRejection({ errors: [{}] })).toEqual({
      constraint: undefined,
      message: undefined,
    });
  });

  it("treats an empty message as absent, so the default catalog entry wins", () => {
    expect(firstAnswerRejection({ errors: [{ message: "" }] })?.message).toBeUndefined();
  });
});

describe("errorDetailsOf", () => {
  it("unwraps the BFF error envelope the portal fetches", () => {
    expect(errorDetailsOf({ error: { code: "ANSWER_INVALID", details: { errors: [] } } })).toEqual({
      errors: [],
    });
  });

  it("returns undefined for anything that is not that envelope", () => {
    expect(errorDetailsOf(undefined)).toBeUndefined();
    expect(errorDetailsOf({})).toBeUndefined();
    expect(errorDetailsOf({ error: "boom" })).toBeUndefined();
  });
});

describe("errorCodeOf", () => {
  it("reads the API's typed code out of the same BFF envelope (issue #743)", () => {
    // The code is what separates a permanent refusal from a transient one: the
    // flow branches on UNSUPPORTED_SEMANTICS_VERSION to reload into the terminal
    // screen instead of inviting a retry that cannot succeed. The status alone
    // will not do it - 409 is also how a stale post of a hidden question is
    // refused, and that one is recoverable.
    expect(errorCodeOf({ error: { code: "UNSUPPORTED_SEMANTICS_VERSION" } })).toBe(
      "UNSUPPORTED_SEMANTICS_VERSION",
    );
    expect(errorCodeOf({ error: { code: "QUESTION_NOT_VISIBLE", details: {} } })).toBe(
      "QUESTION_NOT_VISIBLE",
    );
  });

  it("returns undefined rather than guessing, for a body carrying no code", () => {
    // A 502 the BFF wrote itself, an unparseable payload, a code that is not a
    // string: the caller has to fall through to its generic failure handling, so
    // an absent code must never read as a match.
    expect(errorCodeOf(undefined)).toBeUndefined();
    expect(errorCodeOf({})).toBeUndefined();
    expect(errorCodeOf({ error: "boom" })).toBeUndefined();
    expect(errorCodeOf({ error: { details: {} } })).toBeUndefined();
    expect(errorCodeOf({ error: { code: 409 } })).toBeUndefined();
  });
});

describe("authorMessageFor", () => {
  const messages = questionMessages(stepDoc);

  it("returns the author's wording for a constraint they decorated", () => {
    expect(authorMessageFor(messages.get("q_plate"), "pattern")).toBe("Looks like ABC-123");
  });

  it("returns undefined per constraint, so the default wording applies to the rest", () => {
    // Same question, a constraint the author did not decorate.
    expect(authorMessageFor(messages.get("q_plate"), "minLength")).toBeUndefined();
    // A question the author did not decorate at all.
    expect(authorMessageFor(messages.get("q_odometer"), "min")).toBeUndefined();
  });

  it("returns undefined for a constraint no author can decorate", () => {
    // `encoding` and `options` report a value that is not a legal answer of the
    // question's type at all; there is no authored constraint behind them.
    expect(authorMessageFor(messages.get("q_plate"), "encoding")).toBeUndefined();
    expect(authorMessageFor(messages.get("q_plate"), "options")).toBeUndefined();
  });

  it("returns undefined when the API named no constraint", () => {
    expect(authorMessageFor(messages.get("q_plate"), undefined)).toBeUndefined();
  });

  /**
   * Issue #324. `AUTHORABLE_KEYS` is a plain object literal, so it inherits from
   * `Object.prototype`; the membership test used to be `in`, which walks that
   * chain and answered true for every one of these. The constraint string comes
   * off a validation-error payload, so it is untrusted input reaching a *type
   * predicate* - a hit narrowed it to `keyof AuthorMessages` and the lookup
   * returned an inherited function or object typed as `string`.
   *
   * These cases exist so the fix cannot be quietly simplified back: `in` and
   * `Object.hasOwn` are interchangeable for every authorable key, and differ only
   * here.
   */
  it("rejects prototype-chain keys: an inherited property is not an authored message", () => {
    for (const key of ["toString", "constructor", "valueOf", "__proto__", "hasOwnProperty"]) {
      expect(authorMessageFor(messages.get("q_plate"), key), key).toBeUndefined();
    }
  });

  it("never returns a non-string, whatever key it is handed", () => {
    // The observable half of the same defect: `messages["toString"]` is a
    // function, which survived the `=== undefined || === ""` filter and reached
    // React (or `String(value)` interpolation) typed as `string`.
    for (const key of ["toString", "constructor", "valueOf", "__proto__"]) {
      const result = authorMessageFor(messages.get("q_plate"), key);
      expect(typeof result, key).toBe("undefined");
    }
  });
});

/**
 * The two portal paths agree on the wording of a refused answer (issue #322).
 *
 * This is the property that was violated, and it is asserted here rather than in
 * the browser suite because the browser cannot reach it. The constraints whose
 * default wording differs are `minLength` and `pattern`, and the compiler forwards
 * both to the control as native `minlength` / `pattern` attributes: with JavaScript
 * off, the browser's own constraint validation blocks the whole-step submit, so the
 * API is never asked to refuse the value and the no-JS message never renders. (The
 * same trap `e2e/author-messages.pw.ts` already records for `maxLength`.) So the
 * one layer where both resolutions are observable at once is this one.
 *
 * Each path is modelled by the expression its own source composes, not by a shared
 * helper standing in for both, so a change to either composition shows up here as a
 * disagreement rather than being absorbed:
 *
 * - hydrated (`components/step-flow.tsx`): authored, else the shared default.
 * - no-JS: `app/s/[sessionId]/step/route.ts` resolves the shared default and
 *   `components/native-step.tsx` lets the authored wording override it.
 */
describe("the hydrated and no-JS paths resolve one message", () => {
  const CATALOG = "That answer is not valid.";

  /** `components/step-flow.tsx`: both halves in one place, after the 422 is read. */
  function hydrated(authored: string | undefined, rejection: AnswerRejection | undefined): string {
    return authored ?? defaultAnswerMessage(rejection, CATALOG);
  }

  /** The BFF route's default, then `native-step`'s per-constraint override. */
  function noJs(authored: string | undefined, rejection: AnswerRejection | undefined): string {
    const routeDefault = defaultAnswerMessage(rejection, CATALOG);
    return authored ?? routeDefault;
  }

  const KERNEL = "Answer must be at least 3 characters";
  const AUTHORED = "A plate is at least 3 characters";

  const cases: readonly {
    readonly name: string;
    readonly authored: string | undefined;
    readonly rejection: AnswerRejection | undefined;
    readonly expected: string;
  }[] = [
    {
      name: "the author decorated this constraint",
      authored: AUTHORED,
      rejection: { constraint: "minLength", message: KERNEL },
      expected: AUTHORED,
    },
    {
      name: "the author left this constraint alone",
      authored: undefined,
      rejection: { constraint: "minLength", message: KERNEL },
      expected: KERNEL,
    },
    {
      name: "an unauthorable constraint the kernel still worded",
      authored: undefined,
      rejection: { constraint: "encoding", message: "Answer must be a finite number" },
      expected: "Answer must be a finite number",
    },
    {
      name: "a 422 with no readable rejection at all",
      authored: undefined,
      rejection: undefined,
      expected: CATALOG,
    },
    {
      name: "a rejection naming a constraint but carrying no message",
      authored: undefined,
      rejection: { constraint: "pattern", message: undefined },
      expected: CATALOG,
    },
  ];

  it.each(cases)("agree when $name", ({ authored, rejection, expected }) => {
    expect(hydrated(authored, rejection)).toBe(noJs(authored, rejection));
    expect(hydrated(authored, rejection)).toBe(expected);
  });

  it("prefers the kernel's specific wording over the generic catalog entry", () => {
    // The regression itself, stated as one line: before #322 the hydrated path
    // returned CATALOG here, so turning JavaScript ON made the message vaguer.
    expect(defaultAnswerMessage({ constraint: "minLength", message: KERNEL }, CATALOG)).toBe(
      KERNEL,
    );
  });
});

describe("missingRequiredEntries with author messages", () => {
  it("keeps entries distinct when two questions carry IDENTICAL custom text", () => {
    const entries = missingRequiredEntries(stepDoc, ["q_plate", "q_vin"], VISIBLE);
    expect(entries.map((entry) => entry.message)).toEqual([
      "Registration plate: Check the paperwork",
      "VIN: Check the paperwork",
    ]);
    // The property, not the wording: one accessible name per entry.
    expect(new Set(entries.map((entry) => entry.message)).size).toBe(entries.length);
  });

  it("uses the default sentence for a question with no `required` message", () => {
    const entries = missingRequiredEntries(stepDoc, ["q_odometer"], VISIBLE);
    expect(entries[0]?.message).toBe("Odometer needs an answer.");
  });

  it("ignores a message for another constraint: only `required` reaches the summary", () => {
    // q_plate carries a `pattern` message too; the summary is about presence.
    const entries = missingRequiredEntries(stepDoc, ["q_plate"], VISIBLE);
    expect(entries[0]?.message).not.toContain("ABC-123");
  });

  it("names a label-less question by position, never by a bare message", () => {
    // The honeypot is the real-world shape: a named node with no label. A bare
    // custom message here could produce two indistinguishable entries, and so
    // could the constant that stood here before issue #326.
    const entries = missingRequiredEntries(stepDoc, ["website"], VISIBLE);
    expect(entries[0]?.message).toBe("Question 4: This question needs an answer.");
  });
});
