import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { A2UIStepRenderer } from "./A2UIStepRenderer.tsx";
import { a11yOutline, axeViolations } from "./test-support/a11y.ts";
import { loadGoldenSteps } from "./test-support/golden.ts";

// The conformance contract (ADR-18, risk #3): every golden document, every spec
// generation, renders correctly. Cases are generated from the append-only
// corpus — v1 (task 012) and v2 (task 026, honeypot) — so a new golden file or
// generation is covered automatically.
const steps = loadGoldenSteps();
const cases = steps.map((step) => [`${step.version}/${step.form}/${step.stepId}`, step] as const);

describe("A2UIStepRenderer conformance over the golden corpus", () => {
  it("covers both spec generations present in the corpus (v1 + v2)", () => {
    expect(steps.length).toBeGreaterThan(0);
    expect(new Set(steps.map((s) => s.version))).toEqual(new Set(["v1", "v2"]));
  });

  it.each(cases)("renders %s and matches its accessibility tree", (_label, step) => {
    const { container } = render(
      <A2UIStepRenderer document={step.document} specVersion={step.specVersion} />,
    );
    expect(a11yOutline(container)).toMatchSnapshot();
  });

  it.each(cases)("has zero axe violations for %s", async (_label, step) => {
    const { container } = render(
      <A2UIStepRenderer document={step.document} specVersion={step.specVersion} />,
    );
    const violations = await axeViolations(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
