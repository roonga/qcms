import {
  compilesUnderV as kernelCompilesUnderV,
  toVSafePattern as kernelToVSafePattern,
} from "@roonga/qcms-core";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { type A2UIStepDocument, A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { loadGoldenSteps } from "./test-support/golden.ts";
import { toVSafePattern } from "./v-safe-pattern.ts";

// Asserted by compiling the rendered attribute rather than snapshotting a string, so
// it tracks the real browser rule rather than a frozen expectation. A rejected pattern
// logs an error and drops native validation entirely, which trips the portal's
// browser-console gate.

/** Valid under `u`, a SyntaxError under `v`. */
const CORPUS_PATTERN = "^[A-Za-z][A-Za-z .,'-]{0,99}$";

/**
 * Roughly sixteen times the measured idle cost of rendering one golden step, which is
 * the headroom a loaded machine needs and no more, so a render that genuinely got an
 * order of magnitude slower per step still goes red.
 */
const MS_PER_GOLDEN_STEP = 1_500;

/** Scaled, so appending a golden step raises the budget with it. */
const CORPUS_TIMEOUT_MS = loadGoldenSteps().length * MS_PER_GOLDEN_STEP;

function compilesUnderV(value: string): boolean {
  try {
    new RegExp(value, "v");
    return true;
  } catch {
    return false;
  }
}

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
 * The first render initialises jsdom's document, React's test renderer and the
 * react-aria control tree, a cost the file pays once and which would otherwise land on
 * whichever test happens to render first.
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

  // Rewriting a working pattern risks perturbing the `&&` and `--` operators `v` gives
  // meaning to.
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

  // Each rewrite swaps a class literal for its escaped spelling, so the matched set is
  // unchanged.
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

  // A mid-class dash after a completed range is a literal under `u` but
  // indistinguishable from a range operator, so the attribute is dropped rather than
  // guessed at and the API remains the authority (R2).
  it.each(["^[a-z-0-9]+$", "^[a-z-.]+$"])(
    "omits a pattern it cannot provably normalize: %s",
    (hostile) => {
      expect(compilesUnderV(hostile)).toBe(false);
      expect(toVSafePattern(hostile)).toBeUndefined();
    },
  );

  // The semantics-preservation claim, tested rather than asserted.
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

  // The budget is scaled per step rather than flat, because this renders every golden
  // step through the real renderer, so its cost grows every time one is appended. A
  // flat number sat close enough to Vitest's 5s default to fail under parallel lanes.
  // Do not shave it back to one.
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
      expect(seen).toBeGreaterThan(0);
    },
    CORPUS_TIMEOUT_MS,
  );
});

// The renderer restates the kernel's rule rather than importing it, because this
// package must not pull the kernel into the client bundle, and a restatement is only
// safe while something proves the two still say the same thing. A test file may import
// the kernel; the shipped module may not.

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
    // Only the renderer takes `undefined`; the kernel is only handed one that exists.
    expect(toVSafePattern(undefined)).toBeUndefined();
  });
});
