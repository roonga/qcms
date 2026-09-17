import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";
import { numberFieldAdmitsFractions } from "./registry.tsx";

/**
 * What a NumberField's `<input>` says about itself is the SAME on the server render and
 * on the client's first render, for the number questions QCMS compiles (issue #151), and
 * where it is still NOT the same, a marker here says so (issue #945).
 *
 * The defect this suite guards: reloading a portal step that holds a NumberField logged a
 * React hydration attribute mismatch on every touch client, and the differing attribute
 * was `inputMode` - `decimal` from the client against `numeric` from the server.
 * `useNumberField` chooses it from the resolved number format AND from platform detection
 * that reads `navigator`, which a server render does not have, so a format admitting
 * fraction digits made the two renders disagree. `registry.tsx` now states
 * `maximumFractionDigits: 0` for an integer-constrained question (the `step: 1` the
 * compiler emits for one), which removes the fraction digits from the format and leaves
 * every platform branch at `numeric`.
 *
 * `inputMode` is not the only attribute on that input whose value the environment decides,
 * which is why this file reads two. `aria-roledescription` comes from the same hook and
 * the same absent `navigator` (set unless `isIOS()`), so the server emits "Number field"
 * and an iOS client emits nothing, for the very integer question the fix above settles.
 * Both residuals need the same upstream change and are held below as `it.fails` markers,
 * tracked by #945.
 *
 * Why this layer. The browser proof is `apps/portal/e2e/resume.pw.ts`, which reloads such
 * a step under the console gate and is the assertion the issue asked for; it can only test
 * the one question the kitchen-sink fixture holds, on the platforms the Chromium projects
 * emulate. No project in `playwright.config.ts` is WebKit or iOS, so the iOS-only
 * difference is not observable there AT ALL, and a jsdom platform override is the only
 * place this repository can see it today. jsdom also puts the same adapter through both
 * renders for both kinds of question in milliseconds, which is what pins the RULE rather
 * than the one case.
 *
 * How a server render is reproduced without a server. The only environment input to these
 * decisions is `window.navigator`: react-aria's platform helpers return false for every
 * platform when `window.navigator == null`, which is exactly the branch Node takes, so
 * removing `navigator` for the duration of `renderToStaticMarkup` puts the renderer in the
 * server's position rather than merely approximating it. The client renders with the real
 * navigator reporting an overridden platform, because a real device is where the two
 * answers diverge.
 *
 * One caveat worth stating, because it is what makes the markers below useful beyond their
 * own subjects: react-aria memoizes its platform answers EXCEPT under `NODE_ENV=test`,
 * which is how these tests get to change platform between renders. Were that memoization
 * ever active here, every render in this file would read the first platform probed, both
 * residual cases would agree by accident, and Vitest would red the run with "Expect test
 * to fail". So the markers are also this suite's canary for its own mechanism.
 */

/** The Android user agent family the `mobile-chromium` Playwright project emulates. */
const ANDROID_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** react-aria reads `navigator.platform` (not the user agent) to recognise an iPhone. */
const IPHONE_PLATFORM = "iPhone";

const REAL_NAVIGATOR: Navigator = window.navigator;

/**
 * Run `body` with the REAL navigator reporting `overrides`, restoring it however `body`
 * ends.
 *
 * An own property shadowing a prototype getter, rather than a substitute navigator
 * object. `userAgent` and `platform` are getters on jsdom's `Navigator.prototype` and
 * jsdom brand-checks their receiver, so neither a spread copy (which would report
 * neither) nor an object inheriting from the real one (`'get platform' called on an
 * object that is not a valid instance of Navigator`) survives contact with it. Defining
 * the property on the genuine navigator and deleting it afterwards leaves every other
 * read exactly as it was.
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
 * Run `body` with no `navigator` at all, restoring it however `body` ends. react-aria's
 * platform helpers return false for every platform when `window.navigator == null`,
 * which is the branch a Node render takes.
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
 * `inputmode` (the NumberField's own hidden form input does not), so a second match
 * means the render changed shape and the assertions below would be reading the wrong
 * element.
 */
function soleInput(root: ParentNode): Element {
  const withInputMode = root.querySelectorAll("input[inputmode]");
  expect(withInputMode).toHaveLength(1);
  const [input] = withInputMode;
  return input;
}

/**
 * The two attributes on that input whose value `useNumberField` derives from the
 * environment, read together because they are one hydration question rather than two:
 * React compares every attribute of the element in one pass, so either one differing
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

/** An integer question, exactly as `a2ui-compiler` emits one (kitchen sink's "How many?"). */
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
 * The two residuals, as markers that arm themselves rather than allowlist entries (#151
 * forbids silencing one), tracked by issue #945.
 *
 * Neither can be pinned from here, and the reason is one reason for both: the vendored
 * control takes a fixed prop list and forwards only `placeholder` and `className` to its
 * `<Input>`; react-aria's `useNumberField` spreads a caller's props and THEN sets both
 * `inputMode` and `aria-roledescription` from its own computation; and
 * `packages/ui/src/components/a2ui/**` stays byte-identical to upstream (ADR-22). Only a
 * prop on the `<Input>` itself wins, because that is where react-aria-components merges a
 * caller's props over the field's context. So both need the same upstream passthrough in
 * the sibling a2-react-aria checkout plus a pin move here, which is what #945 asks for.
 *
 * `it.fails` RUNS the body and requires it to fail. The day the passthrough lands and this
 * adapter uses it, the body passes and Vitest reds the run with "Expect test to fail", so
 * the marker has to be removed deliberately. Its limit is the same as the Playwright
 * marker this file replaced: ANY failure satisfies it, so each body holds one assertion
 * and nothing else.
 */
describe("the residuals that need an upstream passthrough (issue #945)", () => {
  /**
   * A question that ADMITS fractions resolves `decimal` on a touch client against the
   * server's `numeric`. No fixture form has such a question, so no browser spec can reach
   * it; this is the only layer that observes it at all.
   */
  it.fails("a question that admits fractions does NOT agree on inputMode yet", () => {
    expect(clientAttributes(FRACTIONAL_QUESTION, { userAgent: ANDROID_USER_AGENT }).inputMode).toBe(
      serverAttributes(FRACTIONAL_QUESTION).inputMode,
    );
  });

  /**
   * `aria-roledescription` on the SAME input, for the very integer question the fix above
   * settles: `useNumberField` sets it to "Number field" unless `isIOS()`, so the server
   * emits it and an iPhone client emits nothing. Android agrees with the server, which is
   * why it prints as unchanged context in the browser log and why no Chromium project in
   * `playwright.config.ts` can see it. Every iOS reload of that step still logs the
   * mismatch this repository's gates cannot reach, and that is the half #945 carries.
   */
  it.fails("an integer question does NOT agree on aria-roledescription on an iPhone", () => {
    expect(clientAttributes(INTEGER_QUESTION, { platform: IPHONE_PLATFORM }).roleDescription).toBe(
      serverAttributes(INTEGER_QUESTION).roleDescription,
    );
  });
});

/**
 * The helper's own contract, at its two documented edges.
 *
 * `step` is the only trace an integer constraint leaves in the compiled props, so what
 * counts as an integral step is the whole of the rule the adapter applies. The jsdom
 * renders above exercise `step: 1` and a missing step; these pin the edges those renders
 * do not reach, including a non-integral step that nothing compiles today but an authored
 * document could carry.
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
