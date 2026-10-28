import type { A2UIStepDocument } from "@roonga/qcms-ui";
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
    expect(errorCodeOf({ error: { code: "UNSUPPORTED_SEMANTICS_VERSION" } })).toBe(
      "UNSUPPORTED_SEMANTICS_VERSION",
    );
    expect(errorCodeOf({ error: { code: "QUESTION_NOT_VISIBLE", details: {} } })).toBe(
      "QUESTION_NOT_VISIBLE",
    );
  });

  it("returns undefined rather than guessing, for a body carrying no code", () => {
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
    expect(authorMessageFor(messages.get("q_plate"), "minLength")).toBeUndefined();
    expect(authorMessageFor(messages.get("q_odometer"), "min")).toBeUndefined();
  });

  it("returns undefined for a constraint no author can decorate", () => {
    expect(authorMessageFor(messages.get("q_plate"), "encoding")).toBeUndefined();
    expect(authorMessageFor(messages.get("q_plate"), "options")).toBeUndefined();
  });

  it("returns undefined when the API named no constraint", () => {
    expect(authorMessageFor(messages.get("q_plate"), undefined)).toBeUndefined();
  });

  it("rejects prototype-chain keys: an inherited property is not an authored message", () => {
    for (const key of ["toString", "constructor", "valueOf", "__proto__", "hasOwnProperty"]) {
      expect(authorMessageFor(messages.get("q_plate"), key), key).toBeUndefined();
    }
  });

  it("never returns a non-string, whatever key it is handed", () => {
    for (const key of ["toString", "constructor", "valueOf", "__proto__"]) {
      const result = authorMessageFor(messages.get("q_plate"), key);
      expect(typeof result, key).toBe("undefined");
    }
  });
});

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
    expect(new Set(entries.map((entry) => entry.message)).size).toBe(entries.length);
  });

  it("uses the default sentence for a question with no `required` message", () => {
    const entries = missingRequiredEntries(stepDoc, ["q_odometer"], VISIBLE);
    expect(entries[0]?.message).toBe("Odometer needs an answer.");
  });

  it("ignores a message for another constraint: only `required` reaches the summary", () => {
    const entries = missingRequiredEntries(stepDoc, ["q_plate"], VISIBLE);
    expect(entries[0]?.message).not.toContain("ABC-123");
  });

  it("names a label-less question by position, never by a bare message", () => {
    const entries = missingRequiredEntries(stepDoc, ["website"], VISIBLE);
    expect(entries[0]?.message).toBe("Question 4: This question needs an answer.");
  });
});
