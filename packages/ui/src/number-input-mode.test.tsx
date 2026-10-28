import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { numberFieldAdmitsFractions } from "./registry.tsx";

// `useNumberField` chooses `inputMode` from the format and from platform detection that reads `navigator`, so a
// server render disagreed. A server render is reproduced by removing `navigator`; react-aria skips memoizing
// platform answers only under NODE_ENV=test, so the markers below also canary that mechanism.

const ANDROID_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** react-aria reads `navigator.platform`, not the user agent, to recognise an iPhone. */
const IPHONE_PLATFORM = "iPhone";

const REAL_NAVIGATOR: Navigator = window.navigator;

/**
 * An own property shadowing a prototype getter, rather than a substitute navigator:
 * jsdom brand-checks the receiver of `userAgent` and `platform`, so neither a spread
 * copy nor an object inheriting from the real one survives contact with it.
 */
function withPlatform<T>(overrides: Readonly<Record<string, string>>, body: () => T): T {
  for (const [property, value] of Object.entries(overrides)) {
    Object.defineProperty(REAL_NAVIGATOR, property, { value, configurable: true });
  }
  try {
    return body();
  } finally {
    for (const property of Object.keys(overrides)) {
      Reflect.deleteProperty(REAL_NAVIGATOR, property);
    }
  }
}

/** No `navigator` at all, which is the branch a Node render takes. */
function withoutNavigator<T>(body: () => T): T {
  Object.defineProperty(window, "navigator", { value: undefined, configurable: true });
  try {
    return body();
  } finally {
    Object.defineProperty(window, "navigator", { value: REAL_NAVIGATOR, configurable: true });
  }
}

function numberStep(props: Readonly<Record<string, unknown>>): A2UIStepDocument {
  return {
    stepId: "stp_number",
    root: { type: "Form", children: [{ type: "NumberField", props }] },
  };
}

/**
 * Exactly one input carries `inputmode`, so a second match means the render changed
 * shape and the assertions below would be reading the wrong element.
 */
function soleInput(root: ParentNode): Element {
  const withInputMode = root.querySelectorAll("input[inputmode]");
  expect(withInputMode).toHaveLength(1);
  const [input] = withInputMode;
  return input;
}

/** Read together, because React compares every attribute in one pass. */
interface EnvironmentAttributes {
  readonly inputMode: string | null;
  readonly roleDescription: string | null;
}

function attributesOf(root: ParentNode): EnvironmentAttributes {
  const input = soleInput(root);
  return {
    inputMode: input.getAttribute("inputmode"),
    roleDescription: input.getAttribute("aria-roledescription"),
  };
}

function serverAttributes(document_: A2UIStepDocument): EnvironmentAttributes {
  const markup = withoutNavigator(() =>
    renderToStaticMarkup(<A2UIStepRenderer document={document_} />),
  );
  return attributesOf(new DOMParser().parseFromString(markup, "text/html"));
}

function clientAttributes(
  document_: A2UIStepDocument,
  overrides: Readonly<Record<string, string>>,
): EnvironmentAttributes {
  return withPlatform(overrides, () => {
    const { container } = render(<A2UIStepRenderer document={document_} />);
    return attributesOf(container);
  });
}

const INTEGER_QUESTION = numberStep({
  label: "How many?",
  name: "q_accident_count",
  isRequired: true,
  minValue: 0,
  maxValue: 200,
  step: 1,
});

const FRACTIONAL_QUESTION = numberStep({
  label: "Litres per 100 km",
  name: "q_consumption",
  isRequired: true,
  minValue: 0,
  maxValue: 30,
});

describe("a NumberField's inputMode survives hydration", () => {
  it("an integer question reports numeric from the server", () => {
    expect(serverAttributes(INTEGER_QUESTION).inputMode).toBe("numeric");
  });

  it("an integer question reports the server's inputMode on an Android client", () => {
    expect(clientAttributes(INTEGER_QUESTION, { userAgent: ANDROID_USER_AGENT }).inputMode).toBe(
      serverAttributes(INTEGER_QUESTION).inputMode,
    );
  });

  it("an integer question reports the server's inputMode on an iPhone client", () => {
    expect(clientAttributes(INTEGER_QUESTION, { platform: IPHONE_PLATFORM }).inputMode).toBe(
      serverAttributes(INTEGER_QUESTION).inputMode,
    );
  });
});

/**
 * Markers that arm themselves rather than allowlist entries. Neither can be pinned until upstream passes the
 * attribute through (ADR-22). `it.fails` requires the body to fail, so a fix turns the run red; each body
 * holds one assertion.
 */
describe("the residuals that need an upstream passthrough (issue #945)", () => {
  /** No fixture form has such a question, so no browser spec reaches it. */
  it.fails("a question that admits fractions does NOT agree on inputMode yet", () => {
    expect(clientAttributes(FRACTIONAL_QUESTION, { userAgent: ANDROID_USER_AGENT }).inputMode).toBe(
      serverAttributes(FRACTIONAL_QUESTION).inputMode,
    );
  });

  /** Set unless the client is iOS, so no Chromium project can see the difference. */
  it.fails("an integer question does NOT agree on aria-roledescription on an iPhone", () => {
    expect(clientAttributes(INTEGER_QUESTION, { platform: IPHONE_PLATFORM }).roleDescription).toBe(
      serverAttributes(INTEGER_QUESTION).roleDescription,
    );
  });
});

// `step` is the only trace an integer constraint leaves in the compiled props, so what
// counts as an integral one is the whole of the rule. These are the edges the renders
// above do not reach, including a non-integral step an authored document could carry.

describe("numberFieldAdmitsFractions", () => {
  it.each([
    { step: undefined, admits: true, why: "no step at all is the compiler's fractional shape" },
    { step: 1, admits: false, why: "step 1 is what an integer constraint compiles to" },
    { step: 5, admits: false, why: "any integral step reaches integers only" },
    { step: 0.5, admits: true, why: "a fractional step admits fractions by construction" },
    { step: Number.NaN, admits: true, why: "a non-finite step is not an integral one" },
  ])("$why", ({ step, admits }) => {
    expect(numberFieldAdmitsFractions(step)).toBe(admits);
  });
});
