import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
  it("emits only v-compilable patterns across the entire golden corpus", () => {
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
  });
});
