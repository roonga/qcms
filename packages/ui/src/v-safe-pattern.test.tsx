import {
  compilesUnderV as kernelCompilesUnderV,
  toVSafePattern as kernelToVSafePattern,
} from "@roonga/qcms-core";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { type A2UIStepDocument, A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { loadGoldenSteps } from "./test-support/golden.ts";
import { toVSafePattern } from "./v-safe-pattern.ts";

/**
 * Issue #29: the browser compiles an HTML `pattern` attribute with the `v` flag,
 * whose character-class grammar rejects spellings that the `u` flag (what a
 * question's pattern is authored and validated against) accepts. A rejected
 * pattern logs "Pattern attribute value ... is not a valid regular expression"
 * and drops native validation entirely, which trips the portal browser-console
 * gate (task 045).
 *
 * The invariant under test: **every `pattern` value that reaches the DOM compiles
 * under `new RegExp(value, "v")`**, or is absent. It is asserted by actually
 * compiling the rendered attribute rather than by snapshotting a string, so the
 * test tracks the real browser rule instead of a frozen expectation.
 */

/** The corpus pattern from issue #29: valid under `u`, a SyntaxError under `v`. */
const CORPUS_PATTERN = "^[A-Za-z][A-Za-z .,'-]{0,99}$";

/**
 * The per-step allowance behind `CORPUS_TIMEOUT_MS`.
 *
 * Roughly sixteen times the measured idle cost of rendering one golden step (about
 * 90ms), which is the headroom a loaded machine needs and no more: the whole point
 * is a budget nobody has to revisit when a step is appended, not a number large
 * enough to hide a real performance regression. A corpus render that genuinely got
 * an order of magnitude slower per step should still go red here.
 */
const MS_PER_GOLDEN_STEP = 1_500;

/** Scaled to the corpus, so appending a golden step raises the budget with it. */
const CORPUS_TIMEOUT_MS = loadGoldenSteps().length * MS_PER_GOLDEN_STEP;

function compilesUnderV(value: string): boolean {
  try {
    new RegExp(value, "v");
    return true;
  } catch {
    return false;
  }
}

/** Renders one shortText control carrying `pattern` and returns the DOM attribute. */
function renderedPattern(pattern: string): string | null {
  const document: A2UIStepDocument = {
    stepId: "stp_pattern",
    root: {
      type: "Form",
      children: [
        {
          type: "TextField",
          props: { label: "Full name", name: "q_name", pattern, maxLength: 100 },
        },
      ],
    },
  };
  const { container } = render(<A2UIStepRenderer document={document} />);
  const input = container.querySelector("input");
  if (!input) throw new Error("no input rendered");
  return input.getAttribute("pattern");
}

/**
 * Pay for the first render once, before anything is timed against a budget.
 *
 * The first `render` in this file loads and initialises jsdom's document, React's
 * test renderer and the react-aria control tree behind `A2UIStepRenderer` - a cost
 * the file pays exactly once, and which lands on whichever test happens to render
 * first. Doing it here with room means no individual test carries a cost that is
 * not its own, and the corpus budget below is a claim about the corpus rather than
 * about test declaration order. Same shape and same reason as
 * `apps/admin/components/forms/pin-grid-ownership.test.tsx` (issue #603).
 */
beforeAll(() => {
  renderedPattern("^[0-9]{4}$");
}, 60_000);

describe("toVSafePattern (issue #29)", () => {
  it("the issue's corpus pattern really is v-hostile (the premise of this fix)", () => {
    expect(() => new RegExp(CORPUS_PATTERN, "u")).not.toThrow();
    expect(() => new RegExp(CORPUS_PATTERN, "v")).toThrow();
  });

  it("normalizes the corpus pattern to a v-compilable equivalent", () => {
    const safe = toVSafePattern(CORPUS_PATTERN);
    expect(safe).toBe("^[A-Za-z][A-Za-z .,'\\-]{0,99}$");
    expect(compilesUnderV(safe!)).toBe(true);
  });

  it("returns undefined for undefined (nothing to emit)", () => {
    expect(toVSafePattern(undefined)).toBeUndefined();
  });

  // A pattern the browser already accepts must be handed through byte-identical:
  // rewriting a working pattern risks perturbing the `&&`/`--` class-set operators
  // that `v` mode gives meaning to.
  it.each([
    "^[0-9]{4}$",
    "^[A-Za-z]{2,3}$",
    "^\\d{3}-\\d{4}$",
    "^(?:AU|NZ)$",
    "^[a-z0-9._%+]+@[a-z0-9.]+\\.[a-z]{2,}$",
    "^[\\-a-z]+$",
    "^[A-Z]-[0-9]$",
  ])("passes a v-safe pattern through unchanged: %s", (pattern) => {
    expect(compilesUnderV(pattern)).toBe(true);
    expect(toVSafePattern(pattern)).toBe(pattern);
  });

  // v-hostile constructs that ARE provably normalizable: each rewrite only swaps a
  // class literal for its escaped spelling, so the matched set is unchanged.
  it.each([
    ["trailing class dash", "^[a-z-]+$", "^[a-z\\-]+$"],
    ["leading class dash", "^[-a-z]+$", "^[\\-a-z]+$"],
    ["negated class leading dash", "^[^-a-z]+$", "^[^\\-a-z]+$"],
    ["dash after a class escape", "^[\\w-]+$", "^[\\w\\-]+$"],
    ["literal parentheses in a class", "^[(a)]$", "^[\\(a\\)]$"],
    ["literal braces in a class", "^[a{2}]$", "^[a\\{2\\}]$"],
    ["literal slash in a class", "^[a/b]$", "^[a\\/b]$"],
    ["literal pipe in a class", "^[a|b]$", "^[a\\|b]$"],
    ["literal open bracket in a class", "^[a[b]$", "^[a\\[b]$"],
    ["reserved double punctuator", "^[a!!b]$", "^[a\\!\\!b]$"],
    ["reserved double hash", "^[a##b]$", "^[a\\#\\#b]$"],
  ])("normalizes %s", (_name, hostile, expected) => {
    expect(compilesUnderV(hostile)).toBe(false);
    expect(toVSafePattern(hostile)).toBe(expected);
    expect(compilesUnderV(expected)).toBe(true);
  });

  // Where the rewrite is not provably safe, omit rather than guess: a mid-class
  // dash after a completed range is a literal under `u` but indistinguishable here
  // from a range operator, so it is left alone and the attribute is dropped. The
  // API remains the validation authority (R2).
  it.each(["^[a-z-0-9]+$", "^[a-z-.]+$"])(
    "omits a pattern it cannot provably normalize: %s",
    (hostile) => {
      expect(compilesUnderV(hostile)).toBe(false);
      expect(toVSafePattern(hostile)).toBeUndefined();
    },
  );

  // Differential check: the normalized pattern under `v` must accept and reject
  // exactly what the original accepted and rejected under `u`. This is the
  // semantics-preservation claim, tested rather than asserted.
  it("normalization preserves u-mode semantics", () => {
    const samples = [
      "",
      "A",
      "a1",
      "A_B",
      "A-",
      "-lead",
      "Ann-Marie O'Brien Jr.",
      "Zoe, Smith",
      "Ann  Marie",
      "a/b",
      "a|b",
      "a{2}",
      "(a)",
      "a!b",
      "a!!b",
      "a#b",
      "[a",
      "w-",
      "élodie",
    ];
    const hostile = [
      CORPUS_PATTERN,
      "^[a-z-]+$",
      "^[-a-z]+$",
      "^[^-a-z]+$",
      "^[\\w-]+$",
      "^[(a)]$",
      "^[a{2}]$",
      "^[a/b]$",
      "^[a|b]$",
      "^[a[b]$",
      "^[a!!b]$",
      "^[a##b]$",
    ];
    for (const pattern of hostile) {
      const safe = toVSafePattern(pattern);
      expect(safe, `expected ${pattern} to normalize`).toBeTypeOf("string");
      const original = new RegExp(pattern, "u");
      const rewritten = new RegExp(safe!, "v");
      for (const sample of samples) {
        expect(
          rewritten.test(sample),
          `${pattern} -> ${safe!} disagreed on ${JSON.stringify(sample)}`,
        ).toBe(original.test(sample));
      }
    }
  });
});

describe("rendered pattern attribute (issue #29)", () => {
  it("emits a v-compilable pattern for the corpus pattern", () => {
    const rendered = renderedPattern(CORPUS_PATTERN);
    expect(rendered).not.toBeNull();
    expect(compilesUnderV(rendered!)).toBe(true);
  });

  it("leaves an already v-safe pattern untouched in the DOM", () => {
    expect(renderedPattern("^[0-9]{4}$")).toBe("^[0-9]{4}$");
  });

  it("omits the attribute when the pattern cannot be made v-safe", () => {
    expect(renderedPattern("^[a-z-0-9]+$")).toBeNull();
  });

  // The whole append-only golden corpus (ADR-18) is the renderer's conformance
  // contract, and it is what the portal actually serves. Every `pattern` it puts
  // on the DOM must satisfy the invariant, which is what keeps the task 045
  // browser-console gate green without an allowlist entry.
  //
  // The budget below is CORPUS_TIMEOUT_MS rather than Vitest's 5s default, and
  // what it covers is the corpus: this test renders every golden step through the
  // real renderer, so its cost is a function of how many steps the corpus holds
  // and grows every time one is appended. Measured at about 1.8s for the 19
  // documents on an idle machine, which sat close enough to the 5s default to
  // fail in two forced runs out of five with three or four executor lanes in
  // flight (issue #603). Scaling the budget per step, rather than picking a
  // number that happens to pass today, is what keeps it honest as the corpus
  // grows: the next appended step raises the allowance with it. Do not shave it
  // back to a flat number.
  it(
    "emits only v-compilable patterns across the entire golden corpus",
    () => {
      const offenders: string[] = [];
      let seen = 0;
      for (const step of loadGoldenSteps()) {
        const { container } = render(
          <A2UIStepRenderer document={step.document} specVersion={step.specVersion} />,
        );
        for (const input of container.querySelectorAll("input[pattern]")) {
          const value = input.getAttribute("pattern")!;
          seen += 1;
          if (!compilesUnderV(value)) {
            offenders.push(`${step.version}/${step.form}/${step.stepId}: ${value}`);
          }
        }
      }
      expect(offenders).toEqual([]);
      // Guard against the assertion passing because nothing carried a pattern.
      expect(seen).toBeGreaterThan(0);
    },
    CORPUS_TIMEOUT_MS,
  );
});

/**
 * The two copies of the rule agree (issue #53).
 *
 * `@roonga/qcms-core` owns the authoring-time normalization, because the API's
 * question boundary refuses a v-invalid pattern and offers the rewrite in the
 * refusal. This module restates it rather than importing it, for the reason
 * `author-messages.ts` records for `ValidationMessageKey`: `@roonga/qcms-ui` is a
 * browser package that must not pull the kernel into the client bundle. A
 * restatement is only safe while something proves the two still say the same
 * thing, and this is that something - the same stance the round-trip suite
 * takes for the answer encodings.
 *
 * A `.test.tsx` may import `@roonga/qcms-core` (`import-surface.test.ts` says so);
 * the shipped module may not.
 */
describe("the kernel and the renderer normalize identically", () => {
  const CORPUS: readonly string[] = [
    CORPUS_PATTERN,
    "^[A-Z0-9][A-Z0-9-]{2,7}$",
    "^[a-z]{2,10}$",
    "^[a-z-]+$",
    "^[-a-z]+$",
    "^[a&&b]+$",
    "^[a!!b-]+$",
    "^[a-z-A]+$",
    "^[\\]\\-a-z^]{1,20}$",
    "^[(){}/|]+$",
    "^\\d{4}$",
    "",
  ];

  it.each(CORPUS)("agrees on whether a browser accepts %j", (pattern) => {
    expect(compilesUnderV(pattern)).toBe(kernelCompilesUnderV(pattern));
  });

  it.each(CORPUS)("agrees on the v-safe spelling of %j", (pattern) => {
    expect(toVSafePattern(pattern)).toBe(kernelToVSafePattern(pattern));
  });

  it("agrees that an absent pattern stays absent", () => {
    // Only the renderer takes `undefined`: it maps an absent prop to an absent
    // attribute. The kernel is only ever handed a pattern that exists.
    expect(toVSafePattern(undefined)).toBeUndefined();
  });
});
