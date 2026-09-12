import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer, type A2UIStepDocument } from "./A2UIStepRenderer.tsx";

/**
 * A NumberField's `inputMode` is the SAME on the server render and on the client's
 * first render, for the number questions QCMS compiles (issue #151).
 *
 * The defect this suite guards: reloading a portal step that holds a NumberField
 * logged a React hydration attribute mismatch on every touch client, and the sole
 * differing attribute was `inputMode` - `decimal` from the client against `numeric`
 * from the server. `@react-aria/numberfield` chooses it from the resolved number
 * format AND from platform detection that reads `navigator`, which a server render
 * does not have, so a format admitting fraction digits made the two renders disagree.
 * `registry.tsx` now states `maximumFractionDigits: 0` for an integer-constrained
 * question (the `step: 1` the compiler emits for one), which removes the fraction
 * digits from the format and leaves every platform branch at `numeric`.
 *
 * Why this layer. The browser proof is `apps/portal/e2e/resume.pw.ts`, which reloads
 * such a step under the console gate and is the assertion the issue asked for; it can
 * only test the one question the kitchen-sink fixture holds, on the one platform the
 * `mobile-chromium` project emulates. jsdom can put the same adapter through both
 * renders for several platforms and both kinds of question in milliseconds, which is
 * what pins the RULE rather than the one case.
 *
 * How a server render is reproduced without a server. The only environment input to
 * the decision is `window.navigator`: react-aria's platform helpers return false for
 * every platform when `window.navigator == null`, which is exactly the branch Node
 * takes, so removing `navigator` for the duration of `renderToStaticMarkup` puts the
 * renderer in the server's position rather than merely approximating it. The client
 * renders under a navigator proxied to report a platform, because a real touch client
 * is where the two answers diverged.
 *
 * One caveat worth stating, because it is what makes the fractional marker below
 * useful beyond its own subject: react-aria memoizes its platform answers EXCEPT
 * under `NODE_ENV=test`, which is how these tests get to change platform between
 * renders. Were that memoization ever active here, every render in this file would
 * read the first platform probed, the fractional case would agree by accident, and
 * `it.fails` would report "expected to fail, but passed". So that marker is also this
 * suite's canary for its own mechanism.
 */

/** The Android user agent family the `mobile-chromium` Playwright project emulates. */
const ANDROID_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

/** react-aria reads `navigator.platform` (not the user agent) to recognise an iPhone. */
const IPHONE_PLATFORM = "iPhone";

const REAL_NAVIGATOR: Navigator = window.navigator;

/**
 * A `navigator` that reports the given overrides and delegates everything else to the
 * real one. A proxy rather than a spread: `userAgent` and `platform` are prototype
 * getters, so a spread copy would report neither.
 */
function navigatorReporting(overrides: Readonly<Record<string, string>>): Navigator {
  return new Proxy(REAL_NAVIGATOR, {
    get(target, property, receiver) {
      if (typeof property === "string" && property in overrides) return overrides[property];
      return Reflect.get(target, property, target) as unknown;
    },
  }) as Navigator;
}

/** Run `body` with `window.navigator` replaced, restoring it however `body` ends. */
function withNavigator<T>(replacement: Navigator | undefined, body: () => T): T {
  Object.defineProperty(window, "navigator", { value: replacement, configurable: true });
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
  } as A2UIStepDocument;
}

/**
 * The `inputMode` of the field's editable input. Exactly one input in the rendered
 * step carries the attribute (the NumberField's own hidden form input does not), so a
 * second match means the render changed shape and the assertion below would be
 * reading the wrong element.
 */
function soleInputMode(root: ParentNode): string | null {
  const withInputMode = Array.from(root.querySelectorAll("input[inputmode]"));
  expect(withInputMode).toHaveLength(1);
  return withInputMode[0]?.getAttribute("inputmode") ?? null;
}

/** What the server emits: no `navigator`, which is the branch Node takes. */
function serverInputMode(document_: A2UIStepDocument): string | null {
  const markup = withNavigator(undefined, () =>
    renderToStaticMarkup(<A2UIStepRenderer document={document_} />),
  );
  return soleInputMode(new DOMParser().parseFromString(markup, "text/html"));
}

/** What the client's first render produces on a device reporting `overrides`. */
function clientInputMode(
  document_: A2UIStepDocument,
  overrides: Readonly<Record<string, string>>,
): string | null {
  return withNavigator(navigatorReporting(overrides), () => {
    const { container } = render(<A2UIStepRenderer document={document_} />);
    return soleInputMode(container);
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
    expect(serverInputMode(INTEGER_QUESTION)).toBe("numeric");
  });

  it("an integer question reports the server's inputMode on an Android client", () => {
    expect(clientInputMode(INTEGER_QUESTION, { userAgent: ANDROID_USER_AGENT })).toBe(
      serverInputMode(INTEGER_QUESTION),
    );
  });

  it("an integer question reports the server's inputMode on an iPhone client", () => {
    expect(clientInputMode(INTEGER_QUESTION, { platform: IPHONE_PLATFORM })).toBe(
      serverInputMode(INTEGER_QUESTION),
    );
  });

  /**
   * The residual upstream defect, as a marker that arms itself rather than an
   * allowlist entry (#151 forbids silencing one).
   *
   * A question that admits fractions resolves `decimal` on a touch client against the
   * server's `numeric`, and nothing at this seam can pin it: the vendored control
   * takes a fixed prop list and forwards no `inputMode` to its `<Input>`,
   * react-aria's `useNumberField` overwrites any caller-supplied `inputMode` with its
   * computed one, and `packages/ui/src/components/a2ui/**` stays byte-identical to
   * upstream (ADR-22). Only a prop on the `<Input>` itself wins, because that is
   * where react-aria-components merges a caller's props over the field's context. So
   * the fix is an `inputMode` passthrough in the sibling a2-react-aria checkout plus a
   * pin move here.
   *
   * `it.fails` RUNS the body and requires it to fail, the same property
   * `apps/portal/e2e/resume.pw.ts` documents for `test.fail`: the day the passthrough
   * lands and this adapter uses it, this test passes and Vitest reds the run with
   * "Expected test to fail". Its limit is the same too - ANY failure satisfies it - so
   * the body holds one assertion and nothing else.
   */
  it.fails("a question that admits fractions does NOT agree yet (upstream)", () => {
    expect(clientInputMode(FRACTIONAL_QUESTION, { userAgent: ANDROID_USER_AGENT })).toBe(
      serverInputMode(FRACTIONAL_QUESTION),
    );
  });
});
