import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { numberFieldAdmitsFractions } from "./registry.tsx";

/**
 * What a NumberField's `<input>` says about itself is the same on the server render and
 * on the client's first render, and where it is still not, a marker below says so.
 *
 * Reloading a portal step holding a NumberField logged a React hydration attribute
 * mismatch on every touch client: `useNumberField` chooses `inputMode` from the
 * resolved number format and from platform detection that reads `navigator`, which a
 * server render does not have, so a format admitting fraction digits made the two
 * renders disagree. The adapter now states `maximumFractionDigits: 0` for an
 * integer-constrained question, which leaves every platform branch at `numeric`.
 *
 * `aria-roledescription` on the same input comes from the same hook and the same
 * absent `navigator`, so the server emits it and an iOS client emits nothing. Both
 * residuals need the same upstream change and are held below as markers.
 *
 * jsdom is the only layer that can see this: no Playwright project here is WebKit or
 * iOS, and jsdom puts the same adapter through both renders for both kinds of question
 * in milliseconds, which pins the rule rather than the one case.
 *
 * A server render is reproduced by removing `navigator` for the duration of the static
 * render, because react-aria's platform helpers return false for every platform when
 * it is absent, which is exactly the branch Node takes.
 *
 * One caveat, which is what makes the markers useful beyond their own subjects:
 * react-aria memoizes its platform answers except under `NODE_ENV=test`, which is how
 * these tests change platform between renders. Were that memoization active here both
 * residual cases would agree by accident and the markers would fail, so they are also
 * this suite's canary for its own mechanism.
 */

/** The Android user agent family the mobile Playwright project emulates. */
const ANDROID_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** react-aria reads `navigator.platform` (not the user agent) to recognise an iPhone. */
const IPHONE_PLATFORM = "iPhone";

const REAL_NAVIGATOR: Navigator = window.navigator;

/**
 * Run `body` with the real navigator reporting `overrides`, restoring it however `body`
 * ends.
 *
 * An own property shadowing a prototype getter, rather than a substitute navigator
 * object: `userAgent` and `platform` are getters on jsdom's `Navigator.prototype` and
 * jsdom brand-checks their receiver, so neither a spread copy nor an object inheriting
 * from the real one survives contact with it.
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

/**
 * Run `body` with no `navigator` at all, restoring it however `body` ends, which is the
 * branch a Node render takes.
 */
function withoutNavigator<T>(body: () => T): T {
  Object.defineProperty(window, "navigator", { value: undefined, configurable: true });
  try {
    return body();
  } finally {
    Object.defineProperty(window, "navigator", { value: REAL_NAVIGATOR, configurable: true });
  }
}

/** One step document holding a single number question with the given compiled props. */
function numberStep(props: Readonly<Record<string, unknown>>): A2UIStepDocument {
  return {
    stepId: "stp_number",
    root: { type: "Form", children: [{ type: "NumberField", props }] },
  };
}

/**
 * The field's editable input. Exactly one input in the rendered step carries
 * `inputmode`, so a second match means the render changed shape and the assertions
 * below would be reading the wrong element.
 */
function soleInput(root: ParentNode): Element {
  const withInputMode = root.querySelectorAll("input[inputmode]");
  expect(withInputMode).toHaveLength(1);
  const [input] = withInputMode;
  return input;
}

/**
 * The two attributes whose value `useNumberField` derives from the environment, read
 * together because React compares every attribute in one pass, so either one differing
 * is the same logged mismatch.
 */
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

/** What the server emits: no `navigator`, which is the branch Node takes. */
function serverAttributes(document_: A2UIStepDocument): EnvironmentAttributes {
  const markup = withoutNavigator(() =>
    renderToStaticMarkup(<A2UIStepRenderer document={document_} />),
  );
  return attributesOf(new DOMParser().parseFromString(markup, "text/html"));
}

/** What the client's first render produces on a device reporting `overrides`. */
function clientAttributes(
  document_: A2UIStepDocument,
  overrides: Readonly<Record<string, string>>,
): EnvironmentAttributes {
  return withPlatform(overrides, () => {
    const { container } = render(<A2UIStepRenderer document={document_} />);
    return attributesOf(container);
  });
}

/** An integer question, exactly as the compiler emits one. */
const INTEGER_QUESTION = numberStep({
  label: "How many?",
  name: "q_accident_count",
  isRequired: true,
  minValue: 0,
  maxValue: 200,
  step: 1,
});

/** A question that admits fractions: the compiler emits no `step` for one. */
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
 * The two residuals, as markers that arm themselves rather than allowlist entries.
 *
 * Neither can be pinned from here, for one reason: the vendored control forwards a
 * fixed prop list, `useNumberField` sets both attributes after spreading a caller's
 * props, and the vendored sources stay byte-identical upstream (ADR-22). Only a prop on
 * the `<Input>` itself wins, which needs an upstream passthrough plus a pin move.
 *
 * `it.fails` runs the body and requires it to fail, so the day the passthrough lands
 * the body passes and the run goes red, and the marker has to be removed deliberately.
 * Any failure satisfies it, so each body holds one assertion and nothing else.
 */
describe("the residuals that need an upstream passthrough (issue #945)", () => {
  /**
   * A question that admits fractions resolves `decimal` on a touch client against the
   * server's `numeric`. No fixture form has such a question, so no browser spec reaches
   * it.
   */
  it.fails("a question that admits fractions does NOT agree on inputMode yet", () => {
    expect(clientAttributes(FRACTIONAL_QUESTION, { userAgent: ANDROID_USER_AGENT }).inputMode).toBe(
      serverAttributes(FRACTIONAL_QUESTION).inputMode,
    );
  });

  /**
   * `aria-roledescription` on the same input: `useNumberField` sets it unless the client
   * is iOS, so the server emits it and an iPhone client emits nothing. Android agrees
   * with the server, which is why no Chromium project can see it.
   */
  it.fails("an integer question does NOT agree on aria-roledescription on an iPhone", () => {
    expect(clientAttributes(INTEGER_QUESTION, { platform: IPHONE_PLATFORM }).roleDescription).toBe(
      serverAttributes(INTEGER_QUESTION).roleDescription,
    );
  });
});

/**
 * The helper's own contract at its edges. `step` is the only trace an integer constraint
 * leaves in the compiled props, so what counts as an integral step is the whole of the
 * rule. The renders above exercise `step: 1` and a missing step; these pin the edges
 * they do not reach, including a non-integral step an authored document could carry.
 */
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
